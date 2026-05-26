from fastapi import FastAPI
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
    return {"ok": True}


@app.post("/embed")
def embed(req: EmbedRequest):
    if not req.texts:
        return {"embeddings": []}
    embeddings = model.encode(req.texts, normalize_embeddings=True)
    return {"embeddings": embeddings.tolist()}
