"""Collecte: find, download and keep the source PDFs of a topic. Admin only.

Ported from the old backend (app/routers/scrape.py). The crawler (services/crawler) runs as a subprocess in its
own venv (Crawl4AI and Playwright stay out of this service) and reports JSON lines. Every PDF it downloads is
stored in the Storage bucket "sources" under its topic, with its provenance record beside it
(<topic>/<file>.pdf and <topic>/<file>.pdf.json): the bucket is the source of truth, crawler/downloads only a cache.
Jobs and running searches live in memory: a restart forgets them, never the files.
"""

import json
import re
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import supabase as sb
from .settings import CRAWLER, DOWNLOADS

sys.path.insert(0, str(CRAWLER))
import topics as crawler_topics  # noqa: E402

router = APIRouter(prefix="/crawl", tags=["crawl"])

PYTHON = CRAWLER / ".venv" / "bin" / "python"
_KEEP_JOBS = 20
_KEEP_LOG = 200
_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@lru_cache(maxsize=1)
def _topics() -> dict[str, dict]:
    items, _ = crawler_topics.load_topics()
    return {t["id"]: t for t in items}


def _topic(topic_id: str) -> dict:
    t = _topics().get(topic_id)
    if not t:
        raise HTTPException(status_code=404, detail=f"Unknown topic: {topic_id}")
    return t


def _is_private(host: str) -> bool:
    """Local and private-network addresses: the crawler must not be pointed at the server's own network."""
    import ipaddress
    import socket

    if host == "localhost" or host.endswith((".local", ".internal")):
        return True
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError:
        return False  # unresolvable: the crawler reports the error
    return any(ipaddress.ip_address(i[4][0]).is_private or ipaddress.ip_address(i[4][0]).is_loopback or ipaddress.ip_address(i[4][0]).is_link_local for i in infos)


def _require_crawler() -> None:
    if not PYTHON.exists():
        raise HTTPException(status_code=503, detail="Crawler not installed (services/crawler/.venv missing, see services/crawler/README.md)")


def _stored_name(topic: str, filename: str, sha256: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", filename).strip("-")[:120] or "document.pdf"
    return f"{topic}/{sha256[:12]}-{safe}"


def _keep(caller: sb.Caller, topic: str, record: dict) -> str:
    """Store one downloaded PDF and its provenance record in the bucket; its stored path."""
    body = (DOWNLOADS / record["path"]).read_bytes()
    path = _stored_name(topic, record.get("filename") or record["path"].rsplit("/", 1)[-1], record["sha256"])
    sb.upload(caller, path, body, "application/pdf")
    sb.upload(caller, f"{path}.json", json.dumps({**record, "topic": topic, "stored_at": _now()}, ensure_ascii=False).encode(), "application/json")
    return path


# ─── Collecting a page or a PDF (collect.py picks the collector for the site) ──────────────────

def _apply(job: dict, event: dict) -> None:
    kind = event.get("type")
    if kind == "stage":
        job["stage"] = event["stage"]
    elif kind == "page":
        job["page_title"] = event.get("title")
    elif kind == "documents":
        job["documents"] = [{**d, "status": "pending"} for d in event["items"]]
        job["skipped"] = event.get("skipped", [])
    elif kind == "doc":
        for d in job["documents"]:
            if d["id"] == event["id"]:
                d["status"] = event["status"]
                for k in ("error", "record"):
                    if k in event:
                        d[k] = event[k]
    elif kind == "error":
        job["error"] = event["message"]
    elif kind == "done":
        job["stage"] = "done"
    if kind in ("log", "error"):
        job["log"].append({"at": _now(), "message": event["message"]})


def _watch(job_id: str, proc: subprocess.Popen, caller: sb.Caller) -> None:
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except ValueError:
            event = {"type": "log", "message": line}
        with _lock:
            _apply(_jobs[job_id], event)
            del _jobs[job_id]["log"][:-_KEEP_LOG]
    code = proc.wait()
    with _lock:
        job = _jobs[job_id]
        downloaded = [d for d in job["documents"] if d["status"] == "downloaded" and d.get("record")]
    # Downloaded files go to the topic's folder of the bucket (outside the lock: uploads take time).
    stored = []
    for d in downloaded:
        try:
            stored.append(_keep(caller, job["topic"], d["record"]))
        except Exception as exc:  # noqa: BLE001 - reported on the job, the others still go
            d["status"], d["error"] = "failed", f"stockage : {exc}"
    with _lock:
        job["stored"] = stored
        if code == 0 and stored:
            job["status"] = "succeeded"
        elif stored:
            job["status"] = "partial"
        else:
            job["status"] = "failed"
            job["error"] = job["error"] or f"La collecte s'est arrêtée (code {code}), voir le journal"
        for d in job["documents"]:
            if d["status"] in ("pending", "downloading"):
                d["status"], d["error"] = "failed", d.get("error", "interrompu")
        job["finished_at"] = _now()


class CollectIn(BaseModel):
    url: str = Field(min_length=8, max_length=500)
    topic: str
    # The link is one PDF ("Ajouter par URL"): read no page for its links.
    single: bool = False
    # Also download argumentaire, note de cadrage, English versions... (default: guideline texts only).
    include_supporting: bool = False


DOI = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)?(10\.\d{4,9}/\S+)$", re.I)


def _resolve_doi(doi: str) -> dict:
    """What Europe PMC knows of a DOI: title, journal, year, and its open-access PDF when there is one."""
    import httpx

    r = httpx.get("https://www.ebi.ac.uk/europepmc/webservices/rest/search", params={"query": f'DOI:"{doi}"', "resultType": "core", "format": "json"}, timeout=30)
    hits = r.json().get("resultList", {}).get("result", []) if r.status_code == 200 else []
    if not hits:
        return {"doi": doi, "title": doi, "pdf_url": None}
    h = hits[0]
    pdf = next((u["url"] for u in (h.get("fullTextUrlList") or {}).get("fullTextUrl", []) if u.get("documentStyle") == "pdf" and u.get("availabilityCode") in ("OA", "F")), None)
    if not pdf and h.get("pmcid") and h.get("isOpenAccess") == "Y":
        pdf = f"https://europepmc.org/articles/{h['pmcid']}?pdf=render"
    return {"doi": doi, "title": h.get("title", doi).rstrip("."), "journal": (h.get("journalInfo") or {}).get("journal", {}).get("medlineAbbreviation"),
            "year": h.get("pubYear"), "pmid": h.get("pmid"), "pdf_url": pdf}


@router.post("/collect", status_code=201)
def collect(body: CollectIn, caller: sb.Caller = Depends(sb.require_admin)):
    url = body.url.strip()
    if m := DOI.match(url):
        # A DOI: its open-access PDF is downloaded; without one, the reference is kept as a link.
        _topic(body.topic)
        ref = _resolve_doi(m.group(1))
        if not ref["pdf_url"]:
            import hashlib

            key = hashlib.sha256(ref["doi"].lower().encode()).hexdigest()
            sb.upload(caller, f"{body.topic}/{key[:12]}-lien.json", json.dumps({**ref, "url": f"https://doi.org/{ref['doi']}", "topic": body.topic, "link_only": True, "stored_at": _now()}, ensure_ascii=False).encode(), "application/json")
            return {"id": f"lien-{key[:8]}", "status": "succeeded", "stage": "done", "url": url, "topic": body.topic, "error": None, "documents": [], "skipped": [], "log": [],
                    "stored": [], "link_only": True, "title": ref["title"]}
        url, body = ref["pdf_url"], body.model_copy(update={"single": True})
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or _is_private(parsed.hostname):
        raise HTTPException(status_code=422, detail="A public web address is expected (http or https)")
    _topic(body.topic)
    _require_crawler()
    with _lock:
        if any(j["status"] == "running" for j in _jobs.values()):
            raise HTTPException(status_code=409, detail="A download is already running")
        job_id = uuid.uuid4().hex[:12]
        job = {"id": job_id, "url": url, "topic": body.topic, "status": "running", "stage": "start", "page_title": None,
               "documents": [], "skipped": [], "stored": [], "log": [], "error": None, "started_at": _now(), "finished_at": None}
        _jobs[job_id] = job
        for old in sorted(_jobs.values(), key=lambda j: j["started_at"])[:-_KEEP_JOBS]:
            if old["status"] != "running":
                del _jobs[old["id"]]
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    script = ["web_scraper.py", "--single"] if body.single else ["collect.py"]
    proc = subprocess.Popen(
        [str(PYTHON), str(CRAWLER / script[0]), url, "--job", job_id, "--out", str(DOWNLOADS), *script[1:], *(["--all"] if body.include_supporting else [])],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=CRAWLER,
    )
    threading.Thread(target=_watch, args=(job_id, proc, caller), daemon=True, name=f"collect-{job_id}").start()
    return job


@router.get("/jobs/{job_id}")
def get_job(job_id: str, caller: sb.Caller = Depends(sb.require_admin)):
    with _lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Unknown download (did the service restart?)")
        return job


# ─── A topic: its stored files, and uploading one ─────────────────────────────────────────────

@router.get("/topics")
def list_topics(caller: sb.Caller = Depends(sb.require_admin)):
    return [{"id": t["id"], "fr": t["fr"], "group": t["group_label"], "section": t["section"], "priority": t.get("priority")} for t in _topics().values()]


def _files(caller: sb.Caller, topic: str) -> list[dict]:
    out = []
    for o in sb.listing(caller, f"{topic}/"):
        name = o.get("name") or ""
        if name.endswith("-lien.json"):
            ref = json.loads(sb.download(caller, f"{topic}/{name}") or b"{}")
            out.append({"path": None, "ref": f"{topic}/{name}", "title": ref.get("title") or name, "bytes": None, "document_url": ref.get("url"), "source_page_url": None,
                        "fetched_at": ref.get("stored_at"), "licence": None, "scraper": "lien seulement (pas de PDF en accès libre)", "link_only": True})
            continue
        if not name.endswith(".pdf"):
            continue
        meta = sb.download(caller, f"{topic}/{name}.json")
        record = json.loads(meta) if meta else {}
        out.append({"path": f"{topic}/{name}", "title": record.get("title") or name, "bytes": record.get("bytes") or (o.get("metadata") or {}).get("size"),
                    "document_url": record.get("document_url") or record.get("file_url"), "source_page_url": record.get("source_page_url"),
                    "fetched_at": record.get("fetched_at"), "licence": record.get("licence"), "scraper": record.get("scraper")})
    return out


@router.get("/topics/{topic}")
def get_topic(topic: str, caller: sb.Caller = Depends(sb.require_admin)):
    t = _topic(topic)
    return {"id": topic, "fr": t["fr"], "group": t["group_label"], "files": _files(caller, topic), "search": _saved(topic)}


@router.post("/topics/{topic}/upload", status_code=201)
async def upload(topic: str, file: UploadFile = File(...), caller: sb.Caller = Depends(sb.require_admin)):
    import hashlib

    _topic(topic)
    body = await file.read()
    if not body.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="A PDF file is expected")
    sha = hashlib.sha256(body).hexdigest()
    path = _stored_name(topic, file.filename or "document.pdf", sha)
    sb.upload(caller, path, body, "application/pdf")
    record = {"title": file.filename, "filename": file.filename, "bytes": len(body), "sha256": sha, "fetched_at": _now(), "scraper": "upload", "topic": topic}
    sb.upload(caller, f"{path}.json", json.dumps(record, ensure_ascii=False).encode(), "application/json")
    return {"path": path}


# ─── A fiche's own PDFs (fiches/<fiche id>/), whatever Collecte topic it belongs to ───────────────────

_FICHE_ID = re.compile(r"^[a-z0-9-]{1,80}$")


def _fiche_folder(fiche: str) -> str:
    if not _FICHE_ID.match(fiche):
        raise HTTPException(status_code=404, detail=f"Invalid fiche id: {fiche}")
    return f"fiches/{fiche}"


@router.get("/fiches/{fiche}/files")
def fiche_files(fiche: str, caller: sb.Caller = Depends(sb.require_admin)):
    """The PDFs stored for this fiche (its sources), for the editor's quote check."""
    return {"files": _files(caller, _fiche_folder(fiche))}


@router.post("/fiches/{fiche}/upload", status_code=201)
async def fiche_upload(fiche: str, file: UploadFile = File(...), caller: sb.Caller = Depends(sb.require_admin)):
    """A source PDF uploaded from the fiche editor, stored under fiches/<fiche id>/ (no Collecte topic needed)."""
    import hashlib

    folder = _fiche_folder(fiche)
    body = await file.read()
    if not body.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="A PDF file is expected")
    sha = hashlib.sha256(body).hexdigest()
    path = _stored_name(folder, file.filename or "document.pdf", sha)
    sb.upload(caller, path, body, "application/pdf")
    record = {"title": file.filename, "filename": file.filename, "bytes": len(body), "sha256": sha, "fetched_at": _now(), "scraper": "upload", "fiche": fiche}
    sb.upload(caller, f"{path}.json", json.dumps(record, ensure_ascii=False).encode(), "application/json")
    return {"path": path}


@router.get("/file")
def file_link(path: str, caller: sb.Caller = Depends(sb.require_admin)):
    """A link that opens a stored PDF for an hour."""
    if ".." in path or not path.endswith(".pdf"):
        raise HTTPException(status_code=404, detail="File not found")
    return {"url": sb.signed_url(caller, path)}


@router.delete("/file")
def file_delete(path: str, caller: sb.Caller = Depends(sb.require_admin)):
    """A stored source deleted: the PDF and its record (or a link-only reference), and the fiche sources linked to it."""
    if ".." in path or not (path.endswith(".pdf") or path.endswith("-lien.json")):
        raise HTTPException(status_code=404, detail="File not found")
    sb.remove(caller, [path, f"{path}.json"] if path.endswith(".pdf") else [path])
    sb.rest(caller, "DELETE", "source_pdfs", params={"pdf_path": f"eq.{path}"})
    return {"deleted": path}


# ─── Guideline search: literature APIs + the French and Algerian listing pages (crawler/literature.py) ──

def _run_search(args: list[str]) -> dict:
    """literature.py in the crawler's venv: PubMed + Europe PMC, the bodies' catalogues, the librarian (~2 min the first time per topic, cached a week); ~10 s otherwise."""
    _require_crawler()
    done = subprocess.run([str(PYTHON), str(CRAWLER / "literature.py"), *args], capture_output=True, text=True, timeout=900, cwd=CRAWLER)  # a topic's first search waits for the librarian, the body crawls and the classifier
    if done.returncode != 0:
        raise HTTPException(status_code=502, detail=f"Search failed: {(done.stderr or done.stdout).strip().splitlines()[-1:] or ['error']}")
    result = json.loads(done.stdout)
    result["searched_at"] = _now()
    return result


def _saved(topic: str) -> dict | None:
    """The topic's last search; one saved by the old whole-site crawl (no "families") is ignored: search again."""
    path = DOWNLOADS / "search" / f"{topic}.json"
    saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
    return saved if isinstance(saved, dict) and "families" in saved else None


@router.post("/search/{topic}")
def search_topic(topic: str, ai: bool = False, caller: sb.Caller = Depends(sb.require_admin)):
    """ai: also run the paid steps (librarian, classifier, about $0.05 a topic the first time); without it, their
    saved answers are reused and the search costs nothing."""
    _topic(topic)
    result = _run_search(["--topic", topic, *(["--ai"] if ai else [])])
    (DOWNLOADS / "search").mkdir(parents=True, exist_ok=True)
    (DOWNLOADS / "search" / f"{topic}.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


@router.post("/search")
def search_query(q: str, caller: sb.Caller = Depends(sb.require_admin)):
    """A free search ("maladie rénale chronique cardiovasculaire"), not saved."""
    if len(q.strip()) < 3:
        raise HTTPException(status_code=422, detail="Search too short")
    return _run_search(["--query", q.strip()])
