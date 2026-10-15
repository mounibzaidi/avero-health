"""MedGuides service: Collecte (search, source PDFs), the topic registry and its checks; the quote check and brand matcher join it (step 10)."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import checks, crawl, registry

app = FastAPI(title="MedGuides API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])
app.include_router(crawl.router)
app.include_router(registry.router)
app.include_router(checks.router)


@app.get("/health")
def health():
    return {"ok": True}
