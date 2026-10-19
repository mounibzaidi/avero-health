"""Settings from the environment (a host's variables), else the repo-root .env.local (names in .env.example). Never logged."""

import os
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
CRAWLER = ROOT / "services" / "crawler"
DOWNLOADS = CRAWLER / "downloads"  # the crawler's cache; the Storage bucket is the source of truth
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
