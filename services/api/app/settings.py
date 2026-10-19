"""Settings from the environment (a host's variables), else the repo-root .env.local (names in .env.example). Never logged."""

import os
import sys
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CRAWLER = ROOT / "services" / "crawler"
# The crawler's cache (a writable folder: AVERO_DOWNLOADS, /tmp on Vercel); the Storage bucket is the source of truth.
DOWNLOADS = Path(os.environ.get("AVERO_DOWNLOADS") or CRAWLER / "downloads")
# The crawler runs in its own venv when there is one (Crawl4AI and Playwright for HAS pages); else, as on Vercel, in
# this service's Python, with this process's import path so it finds the same packages.
ON_VERCEL = bool(os.environ.get("VERCEL"))
_VENV = CRAWLER / ".venv" / "bin" / "python"
CRAWLER_PYTHON = str(_VENV) if _VENV.exists() else sys.executable
CRAWLER_ENV = {**os.environ, "AVERO_DOWNLOADS": str(DOWNLOADS)} if _VENV.exists() else {**os.environ, "AVERO_DOWNLOADS": str(DOWNLOADS), "PYTHONPATH": os.pathsep.join(p for p in sys.path if p)}
SHARED = ROOT / "shared"


@lru_cache(maxsize=1)
def env() -> dict[str, str]:
    path = ROOT / ".env.local"
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines() if path.exists() else []:
        key, sep, value = line.partition("=")
        if sep and not key.startswith("#"):
            out[key.strip()] = value.strip().strip('"\'')
    return {**out, **{k: v for k, v in os.environ.items() if v}}


def setting(name: str) -> str:
    value = env().get(name)
    if not value:
        raise RuntimeError(f"{name} missing: set it in the environment or in .env.local")
    return value
