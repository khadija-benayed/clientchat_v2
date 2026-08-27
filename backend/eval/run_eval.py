"""Banc d'éval léger du chat. Lance : python backend/eval/run_eval.py
Variables d'env requises :
  BACKEND_URL  — URL racine du backend (ex: https://xxx.run.app/)
  EVAL_JWT     — token Bearer (copié depuis la session navigateur : DevTools > Network >
                 une requête > en-tête Authorization, sans le préfixe 'Bearer ')

Flags :
  --judge   Active la phase 2 : LLM-juge sémantique en plus des checks exacts.
            Requiert expected_points (answer) ou should_abstain (abstain) dans testset.json.
"""
import argparse, os, json, sys, requests

BACKEND_URL = os.environ["BACKEND_URL"]
JWT = os.environ["EVAL_JWT"]

SYSTEM = ("Tu es l'assistant projet de l'équipe sur ce client. Réponds à partir des informations "
          "fournies et dis « je ne trouve pas cette information » si elle n'y est pas.")

ABSTAIN_MARKERS = [
    "je ne trouve pas", "pas dans les", "aucune information", "ne dispose pas",
    "je ne sais pas", "pas mentionn", "n'est pas précis", "pas d'information",
]

# Seuils de passage phase 2
THRESHOLDS = {
    "correctness":        0.5,
    "faithful":           0.7,
    "abstained_properly": 0.5,
    "fabricated":         0.3,  # doit être INFÉRIEUR à ce seuil
}

def ask(question, client_id, mmr_threshold=None, inject_threshold=None):
    """Appelle le chat (SSE) et renvoie (reply_text, [source_names], debug, injected_context)."""
    payload = {"message": question, "client_id": client_id,
               "system": SYSTEM, "chat_history": [], "debug": True}
    if mmr_threshold is not None:
        payload["mmr_threshold"] = mmr_threshold
    if inject_threshold is not None:
        payload["inject_threshold"] = inject_threshold
    resp = requests.post(
        BACKEND_URL,
        headers={"Authorization": f"Bearer {JWT}", "Content-Type": "application/json"},
        json=payload,
        stream=True, timeout=180,
    )
    if not resp.ok:
        try:
            err = resp.json().get("error", resp.text[:120])
        except Exception:
            err = resp.text[:120]
        raise RuntimeError(f"HTTP {resp.status_code}: {err}")
    tokens, sources, debug, injected_context = [], [], None, ""
    for line in resp.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        try:
            evt = json.loads(line[6:])
        except json.JSONDecodeError:
            continue
        t = evt.get("type")
        if t == "token":
            tokens.append(evt.get("text", ""))
        elif t == "done":
            if evt.get("reply_text"):
                tokens = [evt["reply_text"]]
            sources = [s.get("source_name", "") for s in evt.get("sources", [])]
            debug = evt.get("debug")
            injected_context = evt.get("injected_context", "")
    return "".join(tokens), sources, debug, injected_context

def call_judge(question, context, response, expected_points, mode):
    """Appelle l'action eval_judge et retourne le dict de scores."""
    resp = requests.post(
        BACKEND_URL,
        headers={"Authorization": f"Bearer {JWT}", "Content-Type": "application/json"},
        json={
            "action": "eval_judge",
            "question": question,
            "context": context,
            "response": response,
            "expected_points": expected_points,
            "mode": mode,
        },
        timeout=60,
    )
    if not resp.ok:
        raise RuntimeError(f"eval_judge HTTP {resp.status_code}: {resp.text[:120]}")
    return resp.json()

def score_case(case, reply, sources):
    low = reply.lower()
    checks = {}
    if case.get("must_contain"):
        checks["must_contain"] = all(s.lower() in low for s in case["must_contain"])
    if case.get("expected_source"):
        checks["source_recall"] = any(case["expected_source"].lower() in s.lower() for s in sources)
    if case.get("should_abstain"):
        checks["abstention"] = any(m in low for m in ABSTAIN_MARKERS)
    return checks

def score_judge(case, reply, injected_context):
    """Phase 2 : appelle le LLM-juge et retourne les scores sémantiques."""
    mode = "abstain" if case.get("should_abstain") else "answer"
    expected_points = case.get("expected_points", [])
    try:
        verdict = call_judge(
            question=case["question"],
            context=injected_context,
            response=reply,
            expected_points=expected_points,
            mode=mode,
        )
    except Exception as e:
        return {"judge_error": str(e)[:80]}, None, None

    scores = {}
    reasoning = verdict.get("reasoning", "")
    reasoning_len = len(reasoning)
    if mode == "answer":
        scores["correctness"] = verdict.get("correctness")
        scores["faithful"]    = verdict.get("faithful")
    else:
        scores["abstained_properly"] = verdict.get("abstained_properly")
        scores["fabricated"]         = verdict.get("fabricated")
    return scores, reasoning, reasoning_len

def judge_pass(metric, value):
    """True si le score passe le seuil (fabricated : inférieur au seuil)."""
    if value is None:
        return False
    if metric == "fabricated":
        return value < THRESHOLDS["fabricated"]
    return value >= THRESHOLDS.get(metric, 0.5)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--judge", action="store_true", help="Active la phase 2 LLM-juge")
    parser.add_argument("--inject-threshold", type=float, default=None,
                        help="Override du seuil d'injection (logit brut du cross-encoder). "
                             "Defaut backend : -1.0, ou -2.0 pour une question compte-rendu. "
                             "Balayer -2 / -4 / -6 / -8 et comparer source_recall (cas answer) "
                             "ET abstention (cas abstain) : baisser le seuil gagne du rappel et "
                             "perd de l'abstention, l'optimum est un compromis à mesurer.")
    parser.add_argument("--mmr-threshold", type=float, default=None,
                        help="Override MMR similarity threshold (ex: 1.01 pour désactiver, 0.90 pour plus strict)")
    args = parser.parse_args()

    here = os.path.dirname(__file__)
    with open(os.path.join(here, "testset.json"), encoding="utf-8") as f:
        cases = json.load(f)

    if args.mmr_threshold is not None:
        print(f"  [MMR override] mmr_threshold={args.mmr_threshold}")
    if args.inject_threshold is not None:
        print(f"  [seuil injection override] inject_threshold={args.inject_threshold}")

    rows, agg, judge_agg = [], {}, {}
    for i, c in enumerate(cases):
        print(f"[{i+1}/{len(cases)}] {c['id']} ...", end=" ", flush=True)
        try:
            reply, sources, debug, injected_context = ask(c["question"], c["client_id"],
                                                          mmr_threshold=args.mmr_threshold,
                                                          inject_threshold=args.inject_threshold)
        except Exception as e:
            print("ERROR")
            rows.append((c["id"], {}, {}, None, None, None, f"[ERROR] {str(e)[:110]}"))
            continue

        checks = score_case(c, reply, sources)
        for k, v in checks.items():
            agg.setdefault(k, []).append(v)

        judge_scores, reasoning, reasoning_len = {}, None, None
        if args.judge:
            judge_scores, reasoning, reasoning_len = score_judge(c, reply, injected_context)
            for k, v in judge_scores.items():
                if v is not None and not isinstance(v, str):
                    judge_agg.setdefault(k, []).append(judge_pass(k, v))

        p1 = " ".join(f"{k}={'✓' if v else '✗'}" for k, v in checks.items())
        p2_parts = []
        for k, v in judge_scores.items():
            if v is not None and isinstance(v, (int, float)):
                p2_parts.append(f"{k}={'✓' if judge_pass(k,v) else '✗'}({v:.2f})")
        p2 = " ".join(p2_parts)
        print(f"{p1}{'  |judge| ' + p2 if p2 else ''}")
        rows.append((c["id"], checks, judge_scores, reasoning, reasoning_len, debug, reply[:80]))

    print("\n=== DÉTAIL ===")
    for cid, checks, judge_scores, reasoning, reasoning_len, debug, preview in rows:
        flags = " ".join(f"{k}={'OK' if v else 'KO'}" for k, v in checks.items())
        judge_err = isinstance(judge_scores.get("judge_error"), str)
        if judge_scores and not judge_err:
            jflags = " ".join(
                f"{k}={'OK' if judge_pass(k, v) else 'KO'}({float(v):.2f})"
                for k, v in judge_scores.items()
                if v is not None and isinstance(v, (int, float))
            )
            if jflags:
                flags = f"{flags}  |judge| {jflags}" if flags else f"|judge| {jflags}"
        print(f"  [{cid}] {flags}   « {preview}… »")
        if judge_scores and judge_err:
            print(f"  judge_error: {judge_scores['judge_error']}")
        if reasoning:
            print(f"  reasoning: {reasoning[:120]}")
        if reasoning_len is not None:
            print(f"  reasoning_len: {reasoning_len} chars")
        if checks and not all(checks.values()) and debug:
            print(f"  --- TRACE {cid} ---")
            for d in debug:
                if "mmr_dropped" in d:
                    print(f"    MMR thr={d['mmr_threshold']} dropped={d['mmr_dropped']}")
                    continue
                mark = "✓INJ" if d["injected"] else "    "
                print(f"    {mark} rr={d['rerank_score']:+.3f} fin={d['final_score']:+.3f} {d['source_name'][:50]}")

    print("\n=== SCORECARD ===")
    print("  -- Phase 1 (exact) --")
    for k, vals in sorted(agg.items()):
        rate = sum(vals) / len(vals) if vals else 0
        print(f"  {k:20s} : {rate:.0%}  ({sum(vals)}/{len(vals)})")
    if judge_agg:
        print("  -- Phase 2 (LLM-juge) --")
        for k, vals in sorted(judge_agg.items()):
            rate = sum(vals) / len(vals) if vals else 0
            thr = f"{'<' if k == 'fabricated' else '>='}{THRESHOLDS[k]}"
            print(f"  {k:20s} : {rate:.0%}  ({sum(vals)}/{len(vals)})  seuil {thr}")

    fails = [cid for cid, checks, _, _r, _rl, _d, _p in rows if checks and not all(checks.values())]
    if fails:
        print(f"\n  À investiguer (phase 1) : {', '.join(fails)}")

if __name__ == "__main__":
    main()
