"""MedGuides service: Collecte (search, source PDFs), the topic registry and its checks, the quote check of a fiche, and
fiche generation from a guideline PDF (fichegen)."""

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import checks, crawl, registry
from .fichegen import routes as fichegen

app = FastAPI(title="MedGuides API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"], allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(httpx.TransportError)
def supabase_unreachable(_request, exc: httpx.TransportError) -> JSONResponse:
    """Supabase too slow or unreachable (after one retry): a clear 503 the dashboard can show, not a crash without
    CORS headers that the browser reports as "service injoignable"."""
    return JSONResponse(status_code=503, content={"detail": f"Supabase ne répond pas ({type(exc).__name__}) : réessayez dans un instant"})
app.include_router(crawl.router)
app.include_router(registry.router)
app.include_router(checks.router)
app.include_router(fichegen.router)


@app.get("/health")
def health():
    return {"ok": True}
