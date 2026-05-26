from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
from typing import List

app = FastAPI()

model: SentenceTransformer = None


@app.on_event("startup")
def load_model():
    global model
    model = SentenceTransformer("paraphrase-multilingual-MiniLM-L12-v2")


class EmbedRequest(BaseModel):
    texts: List[str]


@app.get("/health")
def health():
    if model is None:
        return JSONResponse(status_code=503, content={"ok": False, "reason": "model not loaded"})
    return {"ok": True}


@app.post("/embed")
def embed(req: EmbedRequest):
    if not req.texts:
        return {"embeddings": []}
    if model is None:
        return JSONResponse(status_code=503, content={"error": "model not loaded"})
    embeddings = model.encode(req.texts, normalize_embeddings=True)
    return {"embeddings": embeddings.tolist()}
