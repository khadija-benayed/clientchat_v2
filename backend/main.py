import base64
import io
import json
import math
import os
import re
import time
import traceback
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sentence_transformers import SentenceTransformer
from supabase import create_client, Client
import anthropic
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

# ── Model loading ─────────────────────────────────────────────────────────────
model: Optional[SentenceTransformer] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    print("Loading sentence-transformers model...")
    model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")
    print("Model loaded.")
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_api_key(request: Request, call_next):
    if request.method == "OPTIONS" or request.url.path == "/health":
        return await call_next(request)
    cors = {"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*"}
    if API_KEY and request.headers.get("X-Api-Key") != API_KEY:
        return JSONResponse({"error": "unauthorized"}, status_code=401, headers=cors)
    try:
        return await call_next(request)
    except Exception as e:
        print(f"Unhandled exception: {e}\n{traceback.format_exc()}")
        return JSONResponse({"error": "internal server error"}, status_code=500, headers=cors)

# ── Environment variables ─────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
ANTHROPIC_KEY = os.environ["ANTHROPIC_KEY"]
GOOGLE_SA_KEY = os.environ.get("GOOGLE_SA_KEY")  # JSON string
API_KEY = os.environ.get("API_KEY", "")
if not API_KEY:
    print("WARNING: API_KEY not set — authentication check disabled")

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
claude = anthropic.Anthropic(api_key=ANTHROPIC_KEY)

# ── Cost calculation ──────────────────────────────────────────────────────────
_RATES: dict[str, tuple[float, float]] = {
    "claude-sonnet-4-6": (0.000003, 0.000015),
    "claude-haiku-4-5-20251001": (0.00000025, 0.00000125),
}


def calculate_cost(model_id: str, usage: Optional[dict]) -> float:
    if not usage:
        return 0.0
    in_rate, out_rate = _RATES.get(model_id, _RATES["claude-sonnet-4-6"])
    return usage.get("input_tokens", 0) * in_rate + usage.get("output_tokens", 0) * out_rate


# ── Embedding (local, zero timeout) ──────────────────────────────────────────
def embed_texts(texts: list[str]) -> list[list[float]]:
    if model is None:
        raise RuntimeError("Model not loaded")
    embeddings = model.encode(texts, normalize_embeddings=True)
    return embeddings.tolist()


# ── Chunking ──────────────────────────────────────────────────────────────────
def chunk_text(text: str, max_chars: int = 400, overlap: int = 80) -> list[str]:
    """
    Splits text into chunks preserving sentence boundaries.
    Priority: paragraph breaks → sentence ends → character limit.
    max_chars=400 ≈ 100 tokens (MiniLM-L12 limit).
    """
    normalized = re.sub(r"\r\n|\r", "\n", text).strip()
    if not normalized:
        return []

    segments: list[str] = []
    for para in re.split(r"\n{2,}", normalized):
        p = para.strip()
        if not p:
            continue
        if len(p) <= max_chars:
            segments.append(p)
        else:
            buf = ""
            for sent in re.split(r"(?<=[.!?])\s+", p):
                candidate = (buf + " " + sent) if buf else sent
                if len(candidate) > max_chars and buf:
                    segments.append(buf.strip())
                    buf = sent
                else:
                    buf = candidate
            if buf.strip():
                segments.append(buf.strip())

    chunks: list[str] = []
    current = ""
    for seg in segments:
        joined = (current + "\n\n" + seg) if current else seg
        if len(joined) > max_chars and current:
            chunks.append(current)
            tail = current[-overlap:]
            m = re.search(r"(?<=[.!?])\s", tail)
            overlap_text = tail[m.end() :] if m else tail
            current = (overlap_text + "\n\n" + seg) if overlap_text else seg
        else:
            current = joined

    if current.strip():
        chunks.append(current.strip())

    return chunks if chunks else [normalized[:max_chars]]


def chunk_csv(text: str, lines_per_chunk: int = 5) -> list[str]:
    """Chunks CSV by row groups, repeating the header in every chunk."""
    lines = text.split("\n")
    if len(lines) <= 1:
        return [lines[0]] if lines[0] else []
    header = lines[0]
    chunks: list[str] = []
    for i in range(1, len(lines), lines_per_chunk):
        block = [l for l in lines[i : i + lines_per_chunk] if l.strip()]
        if block:
            chunks.append(header + "\n" + "\n".join(block))
    return chunks


# ── Google Drive ──────────────────────────────────────────────────────────────
def get_drive_service() -> tuple:
    """Returns (drive_service, sa_email). Raises ValueError if GOOGLE_SA_KEY missing."""
    if not GOOGLE_SA_KEY:
        raise ValueError("GOOGLE_SA_KEY manquante")
    sa_info = json.loads(GOOGLE_SA_KEY)
    creds = service_account.Credentials.from_service_account_info(
        sa_info,
        scopes=["https://www.googleapis.com/auth/drive.readonly"],
    )
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)
    return drive, sa_info.get("client_email", "")


def export_drive_file(drive, file_id: str, file_name: str, mime_type: str) -> Optional[dict]:
    """
    Exports a Drive file to text/csv/pdf.
    PDFs are returned as __PDF_BASE64__<b64> for Claude extraction downstream.
    Returns None for unsupported types (images, videos, etc.).
    """
    try:
        if mime_type == "application/vnd.google-apps.spreadsheet":
            req = drive.files().export_media(fileId=file_id, mimeType="text/csv")
            export_type, is_binary = "csv", False
        elif mime_type in (
            "application/vnd.google-apps.document",
            "application/vnd.google-apps.presentation",
        ):
            req = drive.files().export_media(fileId=file_id, mimeType="text/plain")
            export_type, is_binary = "txt", False
        elif mime_type == "application/pdf":
            req = drive.files().get_media(fileId=file_id)
            export_type, is_binary = "pdf", True
        else:
            return None

        buf = io.BytesIO()
        downloader = MediaIoBaseDownload(buf, req)
        done = False
        while not done:
            _, done = downloader.next_chunk()

        if is_binary:
            content = "__PDF_BASE64__" + base64.b64encode(buf.getvalue()).decode()
        else:
            content = buf.getvalue().decode("utf-8", errors="replace")[:20_000]

        return {"filename": file_name, "type": export_type, "content": content}
    except Exception as e:
        print(f"Export error for {file_name}: {e}")
        return None


def _list_files_recursive(
    drive, folder_id: str, visited: set, max_files: int, total_ref: list
) -> list:
    """Recursively lists all non-folder files in a Drive folder with pagination."""
    if folder_id in visited or total_ref[0] >= max_files:
        return []
    visited.add(folder_id)

    all_items = []
    page_token = None
    while True:
        params = {
            "q": f"'{folder_id}' in parents and trashed = false",
            "fields": "nextPageToken,files(id,name,mimeType,modifiedTime)",
            "pageSize": 100,
            "supportsAllDrives": True,
            "includeItemsFromAllDrives": True,
        }
        if page_token:
            params["pageToken"] = page_token
        result = drive.files().list(**params).execute()
        all_items.extend(result.get("files", []))
        page_token = result.get("nextPageToken")
        if not page_token:
            break

    files = [f for f in all_items if f["mimeType"] != "application/vnd.google-apps.folder"]
    sub_folders = [f for f in all_items if f["mimeType"] == "application/vnd.google-apps.folder"]
    total_ref[0] += len(files)

    sub_files = []
    for sf in sub_folders:
        if total_ref[0] >= max_files:
            break
        sub_files.extend(_list_files_recursive(drive, sf["id"], visited, max_files, total_ref))

    return files + sub_files


def _type_priority(mime_type: str) -> int:
    if mime_type == "application/vnd.google-apps.spreadsheet":
        return 0
    if mime_type == "application/vnd.google-apps.document":
        return 1
    if mime_type == "application/vnd.google-apps.presentation":
        return 2
    if mime_type == "application/pdf":
        return 3
    return 4


def _parse_modified(f: dict) -> datetime:
    try:
        return datetime.fromisoformat(f.get("modifiedTime", "").replace("Z", "+00:00"))
    except Exception:
        return datetime.min.replace(tzinfo=None)


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"ok": True, "model_loaded": model is not None}


@app.post("/")
async def dispatcher(request: Request):
    body = await request.json()
    action = body.get("action")

    if action == "summarize_session":
        return await summarize_session(body)
    if action == "read_drive_folder":
        return await read_drive_folder(body)
    if action == "list_drive_metadata":
        return await list_drive_metadata(body)
    if action == "export_single_file":
        return await export_single_file(body)
    if action == "generate_brief":
        return await generate_brief(body)
    if action == "index_source":
        return await index_source(body)
    if action == "delete_source_chunks":
        return await delete_source_chunks(body)
    if action == "save_to_kb":
        return await save_to_kb(body)
    return await chat(body)


# ── summarize_session ─────────────────────────────────────────────────────────
async def summarize_session(body: dict):
    client_id = body.get("client_id")
    history = body.get("history", [])

    if not client_id or not history:
        return JSONResponse({"error": "client_id et history requis"}, status_code=400)

    history_text = "\n".join(
        f"{'Utilisateur' if m['role'] == 'u' else 'Assistant'} : {m['text']}"
        for m in history
    )

    response = claude.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=600,
        system="Tu es un assistant qui résume des sessions de travail de manière factuelle et concise. Tu reçois un historique de conversation et tu produis un résumé structuré.",
        messages=[{
            "role": "user",
            "content": (
                "Résume cette session en 5 points max : décisions prises, infos importantes, "
                "actions à faire. Format : liste à tirets, sois factuel et concis. Ne mets pas de titre.\n\n"
                "Session :\n" + history_text
            ),
        }],
    )
    summary_text = response.content[0].text if response.content else ""

    try:
        sb.table("session_summaries").insert({"client_id": client_id, "summary_text": summary_text}).execute()
    except Exception as e:
        return JSONResponse({"saved": False, "summary": summary_text, "error": str(e)})

    # CC-208 — Index summary in document_chunks (source_type='session') for semantic search
    try:
        embedding = embed_texts([summary_text])[0]
        session_source_name = f"Session du {time.strftime('%Y-%m-%d')}"
        sb.table("document_chunks").delete().match({"client_id": client_id, "source_type": "session"}).execute()
        sb.table("document_chunks").insert({
            "client_id": client_id,
            "source_type": "session",
            "source_name": session_source_name,
            "chunk_text": summary_text,
            "embedding": embedding,
        }).execute()
    except Exception as e:
        print(f"CC-208 index session error (non bloquant): {e}")

    return {"saved": True, "summary": summary_text}


# ── read_drive_folder ─────────────────────────────────────────────────────────
async def read_drive_folder(body: dict):
    folder_id = body.get("folder_id") or body.get("message")
    if not folder_id:
        return JSONResponse({"error": "folder_id requis"}, status_code=400)

    try:
        drive, sa_email = get_drive_service()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    total_ref = [0]
    all_files = _list_files_recursive(drive, folder_id, set(), 500, total_ref)

    if not all_files:
        return {
            "files": [],
            "message": f"Aucun fichier trouvé. Vérifie que le dossier est partagé avec {sa_email}.",
        }

    all_files.sort(key=lambda f: (_type_priority(f["mimeType"]), -_parse_modified(f).timestamp()))

    results = []
    for f in all_files[:200]:
        r = export_drive_file(drive, f["id"], f["name"], f["mimeType"])
        if r:
            results.append({**r, "driveId": f["id"], "modifiedTime": f.get("modifiedTime", "")})

    return {"files": results, "sa_email": sa_email}


# ── list_drive_metadata ───────────────────────────────────────────────────────
async def list_drive_metadata(body: dict):
    """Lightweight metadata-only listing — no file content download."""
    folder_id = body.get("folder_id")
    if not folder_id:
        return JSONResponse({"error": "folder_id requis"}, status_code=400)

    try:
        drive, sa_email = get_drive_service()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    total_ref = [0]
    all_files = _list_files_recursive(drive, folder_id, set(), 500, total_ref)

    meta_files = [
        {
            "id": f["id"],
            "name": f["name"],
            "mimeType": f["mimeType"],
            "modifiedTime": f.get("modifiedTime", ""),
        }
        for f in all_files
    ]
    return {"files": meta_files, "sa_email": sa_email}


# ── export_single_file ────────────────────────────────────────────────────────
async def export_single_file(body: dict):
    file_id = body.get("file_id")
    mime_type = body.get("mime_type")
    file_name = body.get("file_name") or file_id

    if not file_id or not mime_type:
        return JSONResponse({"error": "file_id et mime_type requis"}, status_code=400)

    try:
        drive, _ = get_drive_service()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    result = export_drive_file(drive, file_id, file_name, mime_type)
    if not result:
        return JSONResponse(
            {"error": f"Type de fichier non supporté ou export échoué : {mime_type}"},
            status_code=400,
        )

    return {"file": {**result, "driveId": file_id}}


# ── generate_brief ────────────────────────────────────────────────────────────
async def generate_brief(body: dict):
    client_id = body.get("client_id")
    docs_content = body.get("docs_content", [])

    if not client_id or not docs_content:
        return JSONResponse(
            {"error": "client_id et docs_content (array non vide) requis"}, status_code=400
        )

    TOKEN_BUDGET = 96_000  # ~24k tokens — fits 15-20 docs in Sonnet 4.6 200k window
    total_chars = 0
    doc_blocks = []
    for doc in docs_content:
        block = f"### {doc['filename']}\n{doc['content']}"
        if total_chars + len(block) > TOKEN_BUDGET:
            break
        doc_blocks.append(block)
        total_chars += len(block)

    docs_text = "\n\n---\n\n".join(doc_blocks)
    brief_prompt = (
        "À partir de ces documents, génère une fiche client JSON avec exactement ces champs :\n"
        "- secteur (string)\n"
        "- enjeux_principaux (array de strings, max 5)\n"
        "- kpis (array de strings, max 5)\n"
        "- equipe (array de strings)\n"
        "- historique (string, 2-3 phrases)\n"
        "- notes (string)\n\n"
        "Réponds UNIQUEMENT avec le JSON valide, sans texte autour, sans markdown.\n\n"
        "Documents :\n\n" + docs_text
    )

    response = claude.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1000,
        messages=[{"role": "user", "content": brief_prompt}],
    )
    raw_text = response.content[0].text if response.content else ""
    cleaned = re.sub(r"^```(?:json)?\s*", "", raw_text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*```\s*$", "", cleaned).strip()

    try:
        brief = json.loads(cleaned)
    except Exception:
        print(f"generate_brief: JSON invalide reçu de Claude : {raw_text[:200]}")
        return JSONResponse(
            {"error": "Génération échouée — Claude n'a pas retourné un JSON valide. Réessaie."},
            status_code=422,
        )

    expected_keys = ["secteur", "enjeux_principaux", "kpis", "equipe", "historique", "notes"]
    missing = [k for k in expected_keys if k not in brief]
    if missing:
        return JSONResponse(
            {"error": f"Génération incomplète — champs manquants : {', '.join(missing)}. Réessaie."},
            status_code=422,
        )

    try:
        sb.table("clients").update({"context": json.dumps(brief)}).eq("id", client_id).execute()
    except Exception as e:
        return {"brief": brief, "saved": False, "error": str(e)}

    return {"brief": brief, "saved": True}


# ── index_source ──────────────────────────────────────────────────────────────
async def index_source(body: dict):
    """
    Chunks + embeds (local) + upserts document chunks.
    start_chunk > 0 is a no-op: local embedding processes all chunks in one batch.
    """
    client_id = body.get("client_id")
    source_type = body.get("source_type")
    source_name = body.get("source_name")
    source_id = body.get("source_id")
    content = body.get("content", "")

    if not source_name or not source_type or not content:
        return JSONResponse(
            {"error": "Paramètres requis : source_type, source_name, content."}, status_code=400
        )
    if not isinstance(content, str) or not content.strip():
        return JSONResponse({"error": "content est vide ou invalide."}, status_code=400)

    # If start_chunk > 0, everything was already processed in the first call
    start_chunk = body.get("start_chunk") or 0
    if start_chunk > 0:
        return {"chunks_created": 0, "has_more": False, "total_chunks": 0}

    text_content = content

    # PDF base64 → extract text via Claude (native PDF support)
    if text_content.startswith("__PDF_BASE64__"):
        pdf_b64 = text_content[len("__PDF_BASE64__"):]
        try:
            pdf_response = claude.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=4000,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "document",
                            "source": {"type": "base64", "media_type": "application/pdf", "data": pdf_b64},
                        },
                        {
                            "type": "text",
                            "text": (
                                "Extrais tout le texte de ce document de manière fidèle et complète. "
                                "Inclus les titres, sous-titres, tableaux (format texte), listes et corps de texte. "
                                "Ne résume pas — retranscris le contenu intégral."
                            ),
                        },
                    ],
                }],
            )
            text_content = pdf_response.content[0].text if pdf_response.content else ""
            if not text_content.strip():
                raise ValueError("Extraction PDF vide")
        except Exception as e:
            return JSONResponse({"error": f"Extraction PDF échouée : {e}"}, status_code=502)

    is_csv = source_type == "sheet" or (source_name or "").endswith(".csv")
    chunks = chunk_csv(text_content) if is_csv else chunk_text(text_content)

    if not chunks:
        return JSONResponse(
            {"error": "Aucun chunk généré — contenu trop court ou vide."}, status_code=400
        )

    # Embed all at once — local model, zero timeout risk
    embeddings = embed_texts(chunks)

    # Delete old chunks before inserting (source_id stable key for Drive, source_name fallback)
    try:
        del_q = sb.table("document_chunks").delete()
        if source_id:
            del_q.match({"client_id": client_id or None, "source_id": source_id}).execute()
        else:
            del_q.match({"client_id": client_id or None, "source_name": source_name}).execute()
    except Exception as e:
        print(f"index_source: delete anciens chunks error (non bloquant): {e}")

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = [
        {
            "client_id": client_id or None,
            "source_type": source_type,
            "source_name": source_name,
            **({"source_id": source_id} if source_id else {}),
            "chunk_text": chunk,
            "embedding": emb,
            "last_indexed_at": now,
        }
        for chunk, emb in zip(chunks, embeddings)
    ]

    try:
        sb.table("document_chunks").insert(rows).execute()
    except Exception as e:
        return JSONResponse({"error": f"Erreur insertion chunks : {e}"}, status_code=500)

    # Log in embedding_logs
    try:
        tokens_estimated = sum(math.ceil(len(c) / 4) for c in chunks)
        sb.table("embedding_logs").insert({
            "client_id": client_id or None,
            "source_name": source_name,
            "chunks_count": len(chunks),
            "tokens_estimated": tokens_estimated,
        }).execute()
    except Exception as e:
        print(f"index_source: embedding_logs insert error (non bloquant): {e}")

    return {"chunks_created": len(chunks), "has_more": False, "total_chunks": len(chunks)}


# ── delete_source_chunks ──────────────────────────────────────────────────────
async def delete_source_chunks(body: dict):
    client_id = body.get("client_id")
    source_name = body.get("source_name")
    source_type_filter = body.get("source_type_filter")

    try:
        if source_type_filter and isinstance(source_type_filter, list):
            q = sb.table("document_chunks").delete()
            if client_id:
                q = q.eq("client_id", client_id)
            q.in_("source_type", source_type_filter).execute()
        elif source_name:
            q = sb.table("document_chunks").delete().eq("source_name", source_name)
            if client_id:
                q = q.eq("client_id", client_id)
            q.execute()
        else:
            return JSONResponse(
                {"error": "source_name ou source_type_filter requis."}, status_code=400
            )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    return {"deleted": True}


# ── save_to_kb ────────────────────────────────────────────────────────────────
async def save_to_kb(body: dict):
    title = body.get("title")
    kb_content = body.get("content")
    source_client = body.get("source_client")
    tags = body.get("tags", [])
    saved_by = body.get("saved_by")

    if not title or not kb_content:
        return JSONResponse({"error": "title et content requis."}, status_code=400)

    try:
        res = (
            sb.table("agency_knowledge")
            .insert({
                "title": title,
                "content": kb_content,
                "source_client": source_client or None,
                "tags": tags or [],
                "saved_by": saved_by or None,
            })
            .select("id")
            .single()
            .execute()
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    return {"saved": True, "id": res.data["id"]}


# ── chat (default) ────────────────────────────────────────────────────────────
async def chat(body: dict):
    message = body.get("message", "")
    system = body.get("system", "")
    client_id = body.get("client_id")
    chat_history = body.get("chat_history", [])
    file_data = body.get("file")
    message_type = body.get("message_type", "chat")

    # task_action → Haiku + 1500 tokens; chat → Sonnet + 5000 tokens
    chat_model = "claude-haiku-4-5-20251001" if message_type == "task_action" else "claude-sonnet-4-6"
    max_tokens = 1500 if message_type == "task_action" else 5000

    # RAG pipeline
    system_with_rag = system
    sources_used: list[dict] = []

    if message:
        try:
            query_emb = embed_texts([message])[0]
            result = sb.rpc("match_chunks", {
                "query_embedding": query_emb,
                "match_count": 8,
                "p_client_id": client_id,
            }).execute()
            chunks = result.data or []

            if chunks:
                HIGH_THRESHOLD = 0.62
                LOW_THRESHOLD = 0.35
                MAX_INJECT = 6
                MIN_INJECT = 2
                high_q = [c for c in chunks if c["similarity"] >= HIGH_THRESHOLD]
                if len(high_q) >= MIN_INJECT:
                    to_inject = high_q[:MAX_INJECT]
                else:
                    low_q = [c for c in chunks if c["similarity"] >= LOW_THRESHOLD]
                    to_inject = low_q[:MIN_INJECT]

                doc_chunks = [c for c in to_inject if c["source_type"] != "session"]
                session_chunks = [c for c in to_inject if c["source_type"] == "session"]

                if doc_chunks:
                    doc_block = "\n\n".join(
                        f"— {c['source_name']}\n{c['chunk_text']}" for c in doc_chunks
                    )
                    system_with_rag += (
                        "\n\n[Documents pertinents]\nIMPORTANT : quand tu utilises une information "
                        "issue de ces extraits, cite le nom du fichier source entre parenthèses, "
                        "ex : *(source : NomDuFichier)*.\n\n" + doc_block
                    )
                    sources_used = [
                        {
                            "source_name": c["source_name"],
                            "source_type": c["source_type"],
                            "preview": c["chunk_text"][:120],
                        }
                        for c in doc_chunks
                    ]

                if session_chunks:
                    sess_block = "\n\n".join(
                        f"— {c['source_name']}\n{c['chunk_text']}" for c in session_chunks
                    )
                    system_with_rag += (
                        "\n\n[Historique pertinent]\nExtraits de sessions passées liés à la question. "
                        "Utilise-les pour enrichir ta réponse mais ne les cite pas avec *(source : ...)* "
                        "— ils font partie de l'historique des échanges, pas des documents de référence."
                        "\n\n" + sess_block
                    )
            else:
                system_with_rag += (
                    "\n\n[Disponibilité des documents]\nAucun extrait pertinent trouvé dans les documents "
                    "indexés pour cette question. Si tu ne trouves pas l information dans la fiche client "
                    "ou le contexte disponible, dis-le explicitement à l utilisateur plutôt que d estimer "
                    "ou d inventer."
                )
        except Exception as e:
            print(f"RAG pipeline error (non bloquant): {e}")
            print(traceback.format_exc())

    # Build user content — multimodal if file attached
    system_final = system_with_rag
    if file_data and file_data.get("data") and file_data.get("mediaType"):
        allowed_types = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"]
        if file_data["mediaType"] not in allowed_types:
            return JSONResponse(
                {"error": f"Type de fichier non supporté : {file_data['mediaType']}"},
                status_code=400,
            )
        system_final += (
            "\n\nL'utilisateur t'a partagé un fichier. Extrais les informations clés : "
            "type de document, points importants, données chiffrées, actions suggérées."
        )
        file_block = (
            {"type": "document", "source": {"type": "base64", "media_type": file_data["mediaType"], "data": file_data["data"]}}
            if file_data["mediaType"] == "application/pdf"
            else {"type": "image", "source": {"type": "base64", "media_type": file_data["mediaType"], "data": file_data["data"]}}
        )
        user_content = [file_block, {"type": "text", "text": message or "Analyse ce fichier."}]
    else:
        user_content = message

    # Build multi-turn messages — history must start with user
    raw_hist = list(chat_history)
    while raw_hist and raw_hist[0]["role"] == "a":
        raw_hist.pop(0)

    messages_for_claude = [
        {"role": "user" if m["role"] == "u" else "assistant", "content": m["text"]}
        for m in raw_hist
    ] + [{"role": "user", "content": user_content}]

    response = claude.messages.create(
        model=chat_model,
        max_tokens=max_tokens,
        system=system_final,
        messages=messages_for_claude,
    )

    usage = {
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }

    # Log usage — non-blocking
    try:
        sb.table("usage_logs").insert({
            "client_id": client_id or None,
            "model": chat_model,
            "message_type": message_type,
            "tokens_input": usage["input_tokens"],
            "tokens_output": usage["output_tokens"],
            "cost_usd": calculate_cost(chat_model, usage),
        }).execute()
    except Exception as e:
        print(f"usage_logs insert error (non bloquant): {e}")

    text = response.content[0].text if response.content else ""
    return {"text": text, "sources_used": sources_used}
