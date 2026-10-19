"""Collect the PDFs of any guideline web page: learned societies (SFMU, SFAR, SFC, SPILF...), and
any site the dedicated collectors do not cover (a ministry, an agency).

    python web_scraper.py <URL> [--job ID] [--out DIR] [--all] [--single]

A URL that is itself a PDF is downloaded as is (with --single nothing else is accepted: the link
a person pasted is one file, no page is read for its links). Otherwise the page is fetched and every link to a
PDF on it (".pdf", or a download link that answers with a PDF) is downloaded, one request every
DELAY_S seconds so the site is not hammered. Files land in <out>/web/<host>/<page slug>/ with a
manifest record like the other collectors' (the licence is recorded when the page states one,
"non indiquée" otherwise). Same JSON-line events as has_scraper.py / pmc.py.
"""

import argparse
import hashlib
import json
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from html import unescape
from importlib.metadata import version
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

import polite

from doc_kinds import supporting_reason

USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AveroHealthBot/0.2 (+guideline collection)"
DEFAULT_OUT = Path(__file__).resolve().parent / "downloads"
MAX_PDF_BYTES = 60 * 1024 * 1024
MAX_DOCS = 25  # a page linking more PDFs than this is an index, not one guideline
DELAY_S = 1.5
# Site furniture whose PDFs (terms of sale, internal rules...) are never the guideline.
_FURNITURE = re.compile(r"(?:[\w-]*[-_])?(footer|header|menu|nav|navbar|sidebar|share|sharing|social|cookie|breadcrumbs?)(?:[-_][\w-]*)?", re.I)
# Download-plugin attributes that carry the real file URL (WordPress Download Manager and the like).
_DATA_URL = ("data-downloadurl", "data-download-url", "data-href", "data-url", "data-file")
_DOWNLOAD_HINT = re.compile(r"(download|telecharg|/file|/fichier|getfile|attachment)", re.I)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_LICENCE = re.compile(r"(creative commons[^<.]{0,40}|CC[ -]BY[A-Z -]{0,10}|tous droits réservés|all rights reserved)", re.I)


def emit(kind: str, **fields) -> None:
    print(json.dumps({"type": kind, **fields}, ensure_ascii=False), flush=True)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _text(html: str) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", html))).strip()


def _slug(s: str, n: int = 60) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:n] or "page"


def _filename(url: str, headers: httpx.Headers) -> str:
    cd = headers.get("content-disposition", "")
    m = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)', cd, re.I)
    name = unquote(m.group(1)) if m else unquote(Path(urlparse(url).path).name) or "document"
    name = re.sub(r"[^\w.\-]+", "_", name)
    return name if name.lower().endswith(".pdf") else name + ".pdf"


def discover(page_url: str, html: str) -> list[dict]:
    """PDF and download links in the page's content, in page order, each once: {url, label}.
    Navigation, header, footer and sidebars are left out."""
    soup = BeautifulSoup(html, "html.parser")
    for el in soup.find_all(["nav", "header", "footer", "aside", "script", "style", "noscript"]):
        el.decompose()
    for el in soup.find_all(attrs={"class": True}):
        # Page-level elements carry theme classes ("sticky-header", "menu-text-align..."): never removed.
        if el.attrs is None or el.name in ("html", "body", "main", "article"):
            continue
        if any(_FURNITURE.fullmatch(c) for c in el.get("class") or []):
            el.decompose()
    root = soup.find("main") or soup.find("article") or soup.body or soup
    seen, docs = set(), []
    for el in root.find_all(True):
        if el.attrs is None:
            continue
        candidates = [el.get(k) for k in _DATA_URL if el.get(k)]
        if el.name == "a" and el.get("href"):
            candidates.append(el["href"])
        for raw in candidates:
            url = urljoin(page_url, unescape(str(raw).strip()))
            u = urlparse(url)
            if u.scheme not in ("http", "https") or url in seen or "#" in raw[:1]:
                continue
            if not (u.path.lower().endswith(".pdf") or _DOWNLOAD_HINT.search(url)):
                continue
            seen.add(url)
            label = el.get_text(" ", strip=True) or el.get("title") or Path(u.path).name
            docs.append({"url": url, "label": label[:200]})
    return docs


def fetch_pdf(client: httpx.Client, url: str) -> httpx.Response:
    """The PDF behind a link. A download link that answers with an HTML page (a plugin's landing
    page) is followed one level: the first PDF or download link in that page's content."""
    resp = client.get(url)
    if resp.content[:5] == b"%PDF-":
        return resp
    if "html" in resp.headers.get("content-type", ""):
        for d in discover(str(resp.url), resp.text):
            if d["url"] != url:
                time.sleep(DELAY_S)
                inner = client.get(d["url"])
                if inner.content[:5] == b"%PDF-":
                    return inner
    return resp


def collect(url: str, job: str, out: Path, include_supporting: bool, single: bool = False) -> int:
    host = urlparse(url).hostname or "site"
    with polite.client(headers={"User-Agent": USER_AGENT}, timeout=60, follow_redirects=True) as client:
        emit("stage", stage="render")
        try:
            r = client.get(url)
        except Exception as exc:
            emit("error", message=f"Page inaccessible : {exc}")
            return 1
        is_pdf = r.content[:5] == b"%PDF-"
        html = "" if is_pdf else r.text
        title = _text(_TITLE.search(html).group(1)) if html and _TITLE.search(html) else Path(urlparse(url).path).name
        emit("page", title=title, status_code=r.status_code)
        if r.status_code >= 400:
            emit("error", message=f"La page répond {r.status_code}")
            return 1
        if single and not is_pdf:
            emit("error", message="Ce lien n'est pas un PDF (le lien direct du fichier est attendu)")
            return 1
        licence_m = _LICENCE.search(_text(html)) if html else None
        licence = licence_m.group(1).strip() if licence_m else "non indiquée"

        emit("stage", stage="discover")
        found = [{"url": url, "label": title}] if is_pdf else discover(str(r.url), html)
        items, skipped = [], []
        for n, d in enumerate(found, 1):
            reason = supporting_reason(d["label"], d["url"], ignore=("version anglaise",))
            if reason and not include_supporting:
                skipped.append({"url": d["url"], "label": d["label"], "reason": reason})
                continue
            if len(items) >= MAX_DOCS:
                skipped.append({"url": d["url"], "label": d["label"], "reason": f"Plus de {MAX_DOCS} documents sur la page"})
                continue
            items.append({"id": f"d{n}", "title": d["label"], "document_url": d["url"], "file_url": d["url"]})
        emit("documents", items=items, skipped=skipped)
        if not items:
            emit("error", message="Aucun PDF trouvé sur cette page")
            return 1

        emit("stage", stage="download")
        dest = out / "web" / host / _slug(title)
        dest.mkdir(parents=True, exist_ok=True)
        ok = failed = 0
        got: set[str] = set()  # a title link and a "download" button often lead to the same file
        for doc in items:
            emit("doc", id=doc["id"], status="downloading")
            try:
                if not is_pdf:
                    time.sleep(DELAY_S)
                resp = r if is_pdf else fetch_pdf(client, doc["file_url"])
                body = resp.content
                if len(body) > MAX_PDF_BYTES:
                    raise RuntimeError("fichier trop volumineux")
                if not body.startswith(b"%PDF-"):
                    raise RuntimeError(f"ce n'est pas un PDF ({resp.headers.get('content-type', '?')})")
                digest = hashlib.sha256(body).hexdigest()
                if digest in got:
                    emit("doc", id=doc["id"], status="skipped", error="même fichier qu'un document déjà collecté")
                    continue
                got.add(digest)
                name = _filename(str(resp.url), resp.headers)
                (dest / name).write_bytes(body)
            except Exception as exc:
                failed += 1
                emit("doc", id=doc["id"], status="failed", error=str(exc) or type(exc).__name__)
                continue
            record = {
                "job_id": job,
                "fetched_at": now(),
                "source_page_url": url,
                "source_page_title": title,
                "document_url": doc["document_url"],
                "title": doc["title"],
                "filename": name,
                "file_url": str(resp.url),
                "bytes": len(body),
                "sha256": digest,
                "content_type": resp.headers.get("content-type"),
                "last_modified": resp.headers.get("last-modified"),
                "path": str((dest / name).relative_to(out)),
                "licence": licence,
                "scraper": f"web/httpx {version('httpx')}",
            }
            with (out / "manifest.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(record, ensure_ascii=False) + "\n")
            ok += 1
            emit("doc", id=doc["id"], status="downloaded", record=record)
        emit("done", downloaded=ok, failed=failed)
        return 0 if ok else 1


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("url")
    p.add_argument("--job", default=None)
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    p.add_argument("--all", action="store_true")
    p.add_argument("--single", action="store_true", help="the URL is one PDF: download it, read no page")
    a = p.parse_args()
    if urlparse(a.url).scheme not in ("http", "https"):
        emit("error", message="URL http(s) attendue")
        sys.exit(2)
    a.out.mkdir(parents=True, exist_ok=True)
    sys.exit(collect(a.url, a.job or uuid.uuid4().hex[:12], a.out, a.all, a.single))


if __name__ == "__main__":
    main()
