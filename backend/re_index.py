#!/usr/bin/env python3
"""
re_index.py — Re-indexation complète des documents après migration du modèle d'embedding.

Usage:
    python re_index.py                    # Tous les clients ayant un drive_folder_id
    python re_index.py <client_uuid>      # Un client spécifique

Variables d'env requises:
    SUPABASE_URL         URL du projet Supabase
    SUPABASE_SERVICE_KEY Clé service role Supabase (accès complet)
    BACKEND_URL          URL du backend Cloud Run
                         (ex: https://clientchat-v2-xxxxxx-ew.a.run.app)

Variables d'env optionnelles (une seule suffit pour l'auth backend):
    BACKEND_API_KEY      Clé legacy transmise via l'en-tête X-Api-Key
    BACKEND_JWT          JWT Supabase transmis via Authorization: Bearer

ORDRE D'EXECUTION OBLIGATOIRE:
    1. Appliquer supabase/migration_768.sql dans l'éditeur SQL Supabase
    2. Déployer le backend (git push origin main → Cloud Build → mpnet-base-v2)
    3. Exécuter ce script : python backend/re_index.py
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional


# ── Helpers env ──────────────────────────────────────────────────────────────

def _require_env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if not val:
        print(f"[ERREUR] Variable d'env manquante : {name}", file=sys.stderr)
        sys.exit(1)
    return val


def _auth_headers() -> dict:
    api_key = os.environ.get("BACKEND_API_KEY", "").strip()
    jwt = os.environ.get("BACKEND_JWT", "").strip()
    if api_key:
        return {"X-Api-Key": api_key}
    if jwt:
        return {"Authorization": f"Bearer {jwt}"}
    return {}


# ── Supabase REST (stdlib only) ───────────────────────────────────────────────

def _sb_headers(service_key: str) -> dict:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Accept": "application/json",
    }


def sb_fetch(sb_url: str, service_key: str, table: str, params: dict = None) -> list:
    qs = ("?" + urllib.parse.urlencode(params)) if params else ""
    req = urllib.request.Request(
        f"{sb_url}/rest/v1/{table}{qs}",
        headers=_sb_headers(service_key),
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


def sb_delete_all_chunks(sb_url: str, service_key: str, client_id: str) -> None:
    """Supprime tous les document_chunks d'un client (toutes source_types confondus)."""
    qs = f"?client_id=eq.{urllib.parse.quote(client_id)}"
    req = urllib.request.Request(
        f"{sb_url}/rest/v1/document_chunks{qs}",
        method="DELETE",
        headers=_sb_headers(service_key),
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        resp.read()


# ── SSE sync_drive streaming ──────────────────────────────────────────────────

def stream_sync(backend_url: str, auth_headers: dict, client_id: str, folder_id: str) -> bool:
    """
    Déclenche l'action sync_drive (SSE) et stream la progression vers stdout.
    Retourne True si l'événement 'done' est reçu sans erreurs critiques.

    incremental=False : force le re-traitement de tous les fichiers Drive,
    même ceux dont la date de modification n'a pas changé. Nécessaire ici car
    les chunks ont été supprimés à l'étape précédente.
    """
    payload = json.dumps({
        "action": "sync_drive",
        "client_id": client_id,
        "folder_id": folder_id,
        "incremental": False,
        "resume": False,
    }).encode()

    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        **auth_headers,
    }
    req = urllib.request.Request(backend_url, data=payload, headers=headers)

    # timeout=30 : le backend envoie des heartbeats toutes les 5 s pendant les
    # opérations longues (download, embed). 30 s sans données = backend bloqué.
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data: "):
                    continue
                try:
                    ev = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue

                status = ev.get("status", "")
                progress = ev.get("progress", "")
                total = ev.get("total", "")

                if status == "heartbeat":
                    print(f"    ... {progress}/{total}", flush=True)

                elif status == "done":
                    ok = ev.get("ok", 0)
                    errors = ev.get("errors", 0)
                    cached = ev.get("cached", 0)
                    skipped = ev.get("skipped", 0)
                    purged = ev.get("purged", 0)
                    print(
                        f"    -> ok={ok} cached={cached} "
                        f"skipped={skipped} errors={errors} purged={purged}",
                        flush=True,
                    )
                    return errors == 0

                elif status == "error":
                    fname = ev.get("file", "?")
                    err = ev.get("error", "")
                    print(f"    [ERREUR fichier] {fname}: {err}", flush=True)

                elif status == "timeout":
                    fname = ev.get("file", "?")
                    print(f"    [TIMEOUT] {fname} [{progress}/{total}]", flush=True)

                elif status in ("ok", "cached", "skipped", "empty"):
                    label = {"ok": "OK", "cached": "CACHE", "skipped": "SKIP", "empty": "VIDE"}[status]
                    fname = ev.get("file", "")
                    chunks_info = f" ({ev['chunks']} chunks)" if ev.get("chunks") else ""
                    print(f"    [{label}] [{progress}/{total}] {fname}{chunks_info}", flush=True)

    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        print(f"    [HTTP {exc.code}] {body[:300]}", file=sys.stderr)
        return False
    except urllib.error.URLError as exc:
        print(f"    [Connexion] {exc.reason}", file=sys.stderr)
        return False
    except TimeoutError:
        print("    [TIMEOUT] Aucune donnée reçue pendant 30 s — backend inactif ?", file=sys.stderr)
        return False
    except Exception as exc:
        print(f"    [Erreur inattendue] {exc}", file=sys.stderr)
        return False

    print("    [ATTENTION] Flux SSE terminé sans événement 'done'", file=sys.stderr)
    return False


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    target_id: Optional[str] = sys.argv[1].strip() if len(sys.argv) > 1 else None

    sb_url = _require_env("SUPABASE_URL")
    service_key = _require_env("SUPABASE_SERVICE_KEY")
    backend_url = _require_env("BACKEND_URL").rstrip("/")
    auth = _auth_headers()

    if not auth:
        print(
            "[ATTENTION] Aucune variable BACKEND_API_KEY ni BACKEND_JWT trouvée.\n"
            "            Le backend n'accepte les requêtes non-authentifiées qu'en dev.",
            file=sys.stderr,
        )

    # Récupération des clients
    params = {"select": "id,name,drive_folder_id"}
    if target_id:
        params["id"] = f"eq.{target_id}"

    try:
        clients = sb_fetch(sb_url, service_key, "clients", params)
    except Exception as exc:
        print(f"[ERREUR] Impossible de récupérer les clients Supabase : {exc}", file=sys.stderr)
        sys.exit(1)

    # Seuls les clients avec un dossier Drive configuré peuvent être re-indexés
    eligible = [c for c in clients if c.get("drive_folder_id", "").strip()]

    if not eligible:
        if target_id:
            print(
                f"[ERREUR] Client {target_id} introuvable ou sans drive_folder_id.",
                file=sys.stderr,
            )
        else:
            print("[INFO] Aucun client avec drive_folder_id configuré.", file=sys.stderr)
        sys.exit(1)

    print(f"\nRe-indexation : {len(eligible)} client(s)\n")

    total_ok = 0
    total_fail = 0

    for idx, client in enumerate(eligible, 1):
        cid = client["id"]
        name = client.get("name", cid)
        folder_id = client["drive_folder_id"]

        print(f"[{idx}/{len(eligible)}] {name}  ({cid})")

        # Suppression des chunks existants (embeddings 384-dim obsolètes)
        print("    Suppression des chunks existants...", end=" ", flush=True)
        try:
            sb_delete_all_chunks(sb_url, service_key, cid)
            print("OK", flush=True)
        except Exception as exc:
            print(f"\n    [ERREUR] Suppression impossible : {exc}", file=sys.stderr)
            total_fail += 1
            continue

        # Déclenchement du sync Drive (SSE, incremental=False)
        print(f"    Sync Drive (folder={folder_id})...", flush=True)
        t0 = time.time()
        success = stream_sync(backend_url, auth, cid, folder_id)
        elapsed = time.time() - t0

        if success:
            print(f"    Re-indexation terminée en {elapsed:.0f}s\n")
            total_ok += 1
        else:
            print(
                f"    Re-indexation ECHOUEE ({elapsed:.0f}s) — "
                "relancez le script pour ce client une fois le problème résolu.\n",
                file=sys.stderr,
            )
            total_fail += 1

    print("=" * 56)
    print(f"Résultat : {total_ok} OK  /  {total_fail} erreur(s)")
    if total_fail:
        sys.exit(1)


if __name__ == "__main__":
    main()
