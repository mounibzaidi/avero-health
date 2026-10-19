"""MedGuides service: Collecte (search, source PDFs), the topic registry and its checks, and the quote check of a fiche."""

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import checks, crawl, registry
from .settings import env

app = FastAPI(title="MedGuides API")
app.add_middleware(CORSMiddleware, allow_origins=env().get("CORS_ORIGINS", "http://localhost:3000").split(","), allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(httpx.TransportError)
def supabase_unreachable(_request, exc: httpx.TransportError) -> JSONResponse:
    """Supabase too slow or unreachable (after one retry): a clear 503 the dashboard can show, not a crash without
    CORS headers that the browser reports as "API unreachable"."""
    return JSONResponse(status_code=503, content={"detail": f"Supabase is not answering ({type(exc).__name__}): try again in a moment"})
app.include_router(crawl.router)
app.include_router(registry.router)
app.include_router(checks.router)


@app.get("/health")
def health():
    return {"ok": True}
