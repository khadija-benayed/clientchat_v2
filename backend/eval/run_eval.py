"""Banc d'éval léger du chat. Lance : python backend/eval/run_eval.py
Variables d'env requises :
  BACKEND_URL  — URL racine du backend (ex: https://xxx.run.app/)
  EVAL_JWT     — token Bearer (copié depuis la session navigateur : DevTools > Network >
                 une requête > en-tête Authorization, sans le préfixe 'Bearer ')
"""
import os, json, sys, requests

BACKEND_URL = os.environ["BACKEND_URL"]
JWT = os.environ["EVAL_JWT"]

SYSTEM = ("Tu es l'assistant projet de l'équipe sur ce client. Réponds à partir des informations "
          "fournies et dis « je ne trouve pas cette information » si elle n'y est pas.")

ABSTAIN_MARKERS = [
    "je ne trouve pas", "pas dans les", "aucune information", "ne dispose pas",
    "je ne sais pas", "pas mentionn", "n'est pas précis", "pas d'information",
]

def ask(question, client_id):
    """Appelle le chat (SSE) et renvoie (reply_text, [source_names], debug)."""
    resp = requests.post(
        BACKEND_URL,
        headers={"Authorization": f"Bearer {JWT}", "Content-Type": "application/json"},
        json={"message": question, "client_id": client_id,
              "system": SYSTEM, "chat_history": [], "debug": True},
        stream=True, timeout=180,
    )
    if not resp.ok:
        try:
            err = resp.json().get("error", resp.text[:120])
        except Exception:
            err = resp.text[:120]
        raise RuntimeError(f"HTTP {resp.status_code}: {err}")
    tokens, sources, debug = [], [], None
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
    return "".join(tokens), sources, debug

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

def main():
    here = os.path.dirname(__file__)
    with open(os.path.join(here, "testset.json"), encoding="utf-8") as f:
        cases = json.load(f)

    rows, agg = [], {}
    for c in cases:
        try:
            reply, sources, debug = ask(c["question"], c["client_id"])
        except Exception as e:
            rows.append((c["id"], {"ERROR": False}, str(e)[:120], None))
            continue
        checks = score_case(c, reply, sources)
        for k, v in checks.items():
            agg.setdefault(k, []).append(v)
        rows.append((c["id"], checks, reply[:80], debug))

    print("\n=== DÉTAIL ===")
    for cid, checks, preview, debug in rows:
        flags = " ".join(f"{k}={'OK' if v else 'KO'}" for k, v in checks.items())
        print(f"  [{cid}] {flags}   « {preview}… »")
        if checks and not all(checks.values()) and debug:
            print(f"  --- TRACE {cid} ---")
            for d in debug:
                mark = "✓INJ" if d["injected"] else "    "
                print(f"    {mark} rr={d['rerank_score']:+.3f} fin={d['final_score']:+.3f} {d['source_name'][:50]}")

    print("\n=== SCORECARD ===")
    for k, vals in sorted(agg.items()):
        rate = sum(vals) / len(vals) if vals else 0
        print(f"  {k:14s} : {rate:.0%}  ({sum(vals)}/{len(vals)})")

    fails = [cid for cid, checks, _, _d in rows if checks and not all(checks.values())]
    if fails:
        print(f"\n  À investiguer : {', '.join(fails)}")

if __name__ == "__main__":
    main()
