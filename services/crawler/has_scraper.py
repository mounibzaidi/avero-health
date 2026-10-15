"""Download the documents a HAS guideline page publishes, with provenance.

    python has_scraper.py <HAS page URL> [--job ID] [--out DIR] [--all]

Crawl4AI renders the page in a headless browser (Playwright) and gives its title and HTML. The
guideline's own documents (fiche mémo, algorithme, rapport d'élaboration...) are HAS "document"
links: /jcms/c_XXX redirects to a tracking page (types/FileDocument/doXiti.jsp) that meta-refreshes
to the real PDF under /upload/docs/. We follow that chain for every HAS content link on the page,
keep the ones that land on a PDF, and skip everything else (third-party PDFs, other HAS pages).
Of those PDFs only the guideline texts are downloaded; supporting documents (argumentaire, note de
cadrage, English version... see doc_kinds.py) are listed as skipped unless --all.

Each downloaded PDF gets one line in <out>/manifest.jsonl: page URL and title, document URL,
final file URL, document title, fetch date, size, sha256, and the server's Last-Modified.

Progress goes to stdout as one JSON object per line (see `emit`), for the API to relay to the
dashboard. Exit code 0 when at least one PDF was downloaded and none failed, 1 otherwise.
"""

import argparse
import asyncio
import hashlib
import html
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

import polite
from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

from doc_kinds import supporting_reason

HAS_HOST = "www.has-sante.fr"
USER_AGENT = "MedGuidesBot/0.1 (+guideline provenance; contact via has-sante.fr)"
DEFAULT_OUT = Path(__file__).resolve().parent / "downloads"
MAX_PDF_BYTES = 60 * 1024 * 1024

# <a ... href="jcms/c_2679492/fr/..." ... title="..." ... data-jalios-id='c_2679492'>text</a>
_LINK = re.compile(r"<a\s[^>]*?href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
# Some documents are embedded rather than linked (the DT2 algorithms: <iframe src="jcms/p_...">).
_FRAME = re.compile(r"<(?:iframe|embed)\s[^>]*?src=[\"']([^\"']+)[\"'][^>]*>", re.I)
_ATTR_TITLE = re.compile(r"\btitle=[\"']([^\"']*)[\"']", re.I)
_JCMS = re.compile(r"/jcms/([cp]_\d+)")
_REFRESH = re.compile(r"http-equiv=[\"']?refresh[\"']?\s+content=[\"'][^\"']*?url=['\"]?([^'\">]+)", re.I)
_DOC_TITLE = re.compile(r"<title>(.*?)</title>", re.I | re.S)
_BASE = re.compile(r"<base\s[^>]*href=[\"']([^\"']+)[\"']", re.I)


def emit(kind: str, **fields) -> None:
    print(json.dumps({"type": kind, **fields}, ensure_ascii=False), flush=True)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def clean(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text))).strip()


def page_links(page_url: str, page_html: str) -> list[dict]:
    """Every <a>, <iframe> and <embed> target on the page as {url, text, title}, absolute, first
    occurrence of each URL.
    Relative links resolve against <base href> when the page sets one (HAS pages do)."""
    base = _BASE.search(page_html)
    page_url = urljoin(page_url, html.unescape(base.group(1))) if base else page_url
    seen, out = set(), []
    tags = [(m.start(), m.group(1), m.group(0), m.group(2)) for m in _LINK.finditer(page_html)]
    tags += [(m.start(), m.group(1), m.group(0), "") for m in _FRAME.finditer(page_html)]
    for _, src, tag, inner in sorted(tags):
        href = html.unescape(src).strip()
        if href.startswith(("#", "mailto:", "javascript:")):
            continue
        url = urljoin(page_url, href).split("#")[0]
        if url in seen:
            continue
        seen.add(url)
        attr = _ATTR_TITLE.search(tag[: tag.find(">") + 1])
        out.append({"url": url, "text": clean(inner), "title": clean(attr.group(1)) if attr else ""})
    return out


async def render(url: str) -> tuple[str, str, int | None]:
    """(title, html, status) of the page as a browser sees it."""
    await asyncio.to_thread(polite.gate, url, USER_AGENT)  # robots.txt, the host's turn, no login page
    async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False, user_agent=USER_AGENT)) as crawler:
        result = await crawler.arun(url, config=CrawlerRunConfig(cache_mode=CacheMode.BYPASS, verbose=False))
    if not result.success:
        raise RuntimeError(result.error_message or f"page non rendue (HTTP {result.status_code})")
    title = (result.metadata or {}).get("title") or ""
    title = re.sub(r"^Haute Autorité de Santé\s*-\s*", "", clean(title))
    return title, result.html, result.status_code


async def resolve_document(client: httpx.AsyncClient, link: dict) -> dict | None:
    """Follow a HAS content link to its file. None when it is a page, not a document."""
    r = await client.get(link["url"], follow_redirects=False)
    location = r.headers.get("location", "")
    if not (r.is_redirect and "FileDocument" in location):
        return None
    tracker_url = urljoin(link["url"], location)
    tracker = await client.get(tracker_url, follow_redirects=True)
    m = _REFRESH.search(tracker.text)
    if not m:
        return None
    t = _DOC_TITLE.search(tracker.text)
    return {
        "document_url": link["url"],
        "file_url": urljoin(str(tracker.url), html.unescape(m.group(1)).strip()),
        "title": link["title"] or (clean(t.group(1)) if t else "") or link["text"],
    }


async def download(client: httpx.AsyncClient, doc: dict, dest: Path) -> dict:
    async with client.stream("GET", doc["file_url"], follow_redirects=True) as r:
        r.raise_for_status()
        chunks, size = [], 0
        async for chunk in r.aiter_bytes():
            size += len(chunk)
            if size > MAX_PDF_BYTES:
                raise RuntimeError(f"fichier trop volumineux (> {MAX_PDF_BYTES // 2**20} Mo)")
            chunks.append(chunk)
        body = b"".join(chunks)
        headers = r.headers
        final_url = str(r.url)
    if not body.startswith(b"%PDF-"):
        raise RuntimeError(f"ce n'est pas un PDF ({headers.get('content-type', '?')})")
    name = Path(urlparse(final_url).path).name or "document.pdf"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / name).write_bytes(body)
    return {
        "filename": name,
        "file_url": final_url,
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "content_type": headers.get("content-type"),
        "last_modified": headers.get("last-modified"),
    }


async def run(url: str, job: str, out: Path, include_supporting: bool = False) -> int:
    emit("stage", stage="render")
    try:
        page_title, page_html, status = await render(url)
    except Exception as exc:
        emit("error", message=f"Rendu de la page impossible : {exc}")
        return 1
    emit("page", title=page_title, status_code=status)

    emit("stage", stage="discover")
    links = page_links(url, page_html)
    has_content = [l for l in links if urlparse(l["url"]).hostname == HAS_HOST and _JCMS.search(l["url"])]
    here = _JCMS.search(url)
    has_content = [l for l in has_content if not (here and _JCMS.search(l["url"]).group(1) == here.group(1))]
    skipped = [
        {"url": l["url"], "label": l["title"] or l["text"], "reason": "PDF hors HAS" if urlparse(l["url"]).hostname != HAS_HOST else "PDF référencé (outil)"}
        for l in links
        if l["url"].lower().endswith(".pdf")
    ]
    emit("log", message=f"{len(links)} liens sur la page, {len(has_content)} liens HAS à vérifier")

    async with polite.async_client(headers={"User-Agent": USER_AGENT}, timeout=60) as client:
        resolved = await asyncio.gather(*(resolve_document(client, l) for l in has_content), return_exceptions=True)
        docs = []
        for link, res in zip(has_content, resolved):
            if isinstance(res, Exception):
                emit("log", message=f"Lien non vérifié ({type(res).__name__}) : {link['url']}")
            elif res:
                reason = None if include_supporting else supporting_reason(res["title"], res["file_url"])
                if reason:
                    skipped.append({"url": res["file_url"], "label": res["title"], "reason": f"Annexe : {reason}"})
                else:
                    docs.append({"id": f"d{len(docs) + 1}", **res})
        emit("documents", items=docs, skipped=skipped)
        if not docs:
            annexes = any(s["reason"].startswith("Annexe") for s in skipped)
            emit("error", message="Seulement des documents annexes sur cette page (recommandation pas encore publiée ?)" if annexes else "Aucun document HAS trouvé sur cette page")
            return 1

        emit("stage", stage="download")
        name = re.sub(r"[^a-z0-9]+", "-", urlparse(url).path.rstrip("/").rsplit("/", 1)[-1].lower()).strip("-")[:60]
        pid = here.group(1) if here else "page"
        slug = pid if name in ("", pid.replace("_", "-")) else f"{pid}-{name}"
        dest = out / "has" / slug
        ok = failed = 0
        for doc in docs:
            emit("doc", id=doc["id"], status="downloading")
            try:
                got = await download(client, doc, dest)
            except Exception as exc:
                failed += 1
                emit("doc", id=doc["id"], status="failed", error=str(exc) or type(exc).__name__)
                continue
            record = {
                "job_id": job,
                "fetched_at": now(),
                "source_page_url": url,
                "source_page_title": page_title,
                "document_url": doc["document_url"],
                "title": doc["title"],
                **got,
                "path": str((dest / got["filename"]).relative_to(out)),
                "scraper": f"has_scraper/crawl4ai {version('crawl4ai')}",
            }
            with (out / "manifest.jsonl").open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
            ok += 1
            emit("doc", id=doc["id"], status="downloaded", record=record)

    emit("done", downloaded=ok, failed=failed)
    return 0 if ok and not failed else 1


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("url")
    p.add_argument("--job", default=None)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--all", action="store_true", help="also download supporting documents (argumentaire, note de cadrage...)")
    a = p.parse_args()
    if urlparse(a.url).hostname != HAS_HOST:
        emit("error", message=f"Seules les pages {HAS_HOST} sont prises en charge")
        sys.exit(2)
    a.out.mkdir(parents=True, exist_ok=True)
    sys.exit(asyncio.run(run(a.url, a.job or uuid.uuid4().hex[:12], a.out, a.all)))


if __name__ == "__main__":
    main()
