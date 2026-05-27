import os
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from fastembed import TextEmbedding
from typing import List

app = FastAPI()

model: TextEmbedding = None

CACHE_DIR = os.path.join(os.path.dirname(__file__), "fastembed_cache")
MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"


@app.on_event("startup")
def load_model():
    global model
    model = TextEmbedding(MODEL_NAME, cache_dir=CACHE_DIR)


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
    embeddings = list(model.embed(req.texts))
    return {"embeddings": [e.tolist() for e in embeddings]}
