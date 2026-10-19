"""Open-access practice guidelines from PubMed / PubMed Central (US National Library of Medicine),
through NCBI's own programmatic access.

    python pmc.py catalogue [--out DIR]          # -> <out>/pmc.json
    python pmc.py licences [--out DIR]           # read the missing licences in the articles themselves
    python pmc.py collect <PMC article URL> [--job ID] [--out DIR] [--all]

Catalogue: E-utilities. esearch finds the records (publication type "Practice Guideline", PMC Open
Access subset, English, French or Arabic), esummary gives their titles and dates, and esearch with
PMC's licence filters gives each article's licence; an article the filters leave without one has
its licence read in its own XML (efetch), so a CC BY or CC BY-NC article is not left "lien seulement".
Collect: efetch returns the article's own XML, where its licence is read again, article by article
(the check that decides); the PDF then comes from the PMC Article Datasets bucket (NCBI's open-data
store on S3, over HTTPS: efetch has no PDF), whose JSON gives the PDF's MD5 and a retraction flag.

Licence: an article is collected only when its licence allows adaptation (CC0, BY, BY-SA, BY-NC,
BY-NC-SA). "No derivatives" (ND) and unlicensed articles are link only: a fiche is an adaptation.
The licence is recorded in the manifest. NLM asks redistributors to keep the data current or say
it may not be, and never to imply NLM/NIH endorsement.

NCBI's usage policy: every E-utilities request names the tool (TOOL) and a contact email
(NCBI_EMAIL, from the environment or backend/.env.local; requests go without one until it is set),
and stays under 3 requests per second (polite.py spaces them one second apart; NCBI_API_KEY is sent
when set). Collect emits the same JSON-line events as has_scraper.py.
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import uuid
from datetime import datetime, timezone
from importlib.metadata import version
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import httpx

import polite

EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
BUCKET = "https://pmc-oa-opendata.s3.amazonaws.com"
HOST = "pmc.ncbi.nlm.nih.gov"
TOOL = "averohealth-bot"
USER_AGENT = "AveroHealthBot/0.1 (+guideline provenance)"
DEFAULT_OUT = Path(__file__).resolve().parent / "downloads"
QUERY = "practice guideline[pt] AND pubmed pmc open access[filter] AND (english[la] OR french[la] OR arabic[la])"
LANGUAGES = {"eng": ("en", "English"), "fre": ("fr", "Français"), "ara": ("ar", "العربية")}
# PMC licence filter -> licence code as written in the bucket's JSON.
LICENCES = {
    "cc0 license": "CC0", "cc by license": "CC BY", "cc by-sa license": "CC BY-SA", "cc by-nc license": "CC BY-NC",
    "cc by-nc-sa license": "CC BY-NC-SA", "cc by-nd license": "CC BY-ND", "cc by-nc-nd license": "CC BY-NC-ND",
}
# Licences that allow adaptation: what a fiche is. The others are link only.
ADAPTABLE = {"CC0", "CC BY", "CC BY-SA", "CC BY-NC", "CC BY-NC-SA"}
_CC = re.compile(r"creativecommons\.org/(?:licenses/(by(?:-[a-z]{2})*)|publicdomain/(zero))", re.I)
MAX_PDF_BYTES = 80 * 1024 * 1024
_BATCH = 200


def emit(kind: str, **fields) -> None:
    print(json.dumps({"type": kind, **fields}, ensure_ascii=False), flush=True)


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _setting(name: str) -> str | None:
    """A setting from the environment, else from services/crawler/.env.local (read only)."""
    if os.environ.get(name):
        return os.environ[name]
    env = Path(__file__).resolve().parent / ".env.local"
    for line in env.read_text(encoding="utf-8").splitlines() if env.exists() else []:
        key, _, value = line.partition("=")
        if key.strip() == name and value.strip():
            return value.strip().strip('"\'')
    return None


def identity() -> dict[str, str]:
    """What NCBI asks every E-utilities request to carry: the tool's name, a contact email, the API key if any."""
    out = {"tool": TOOL}
    if _setting("NCBI_EMAIL"):
        out["email"] = _setting("NCBI_EMAIL")
    if _setting("NCBI_API_KEY"):
        out["api_key"] = _setting("NCBI_API_KEY")
    return out


class Ncbi:
    """NCBI client: E-utilities requests carry the identity; polite.py spaces every request one
    second apart per host (NCBI allows 3 per second)."""

    def __init__(self) -> None:
        self.client = polite.client(headers={"User-Agent": USER_AGENT}, timeout=httpx.Timeout(60, connect=15), follow_redirects=True)
        self.identity = identity()

    def _send(self, method: str, url: str, **kw) -> httpx.Response:
        """One request; a server error or a dropped connection is tried again, twice, after a pause."""
        for attempt in range(3):
            try:
                r = self.client.request(method, url, **kw)
                if r.status_code < 500:
                    return r.raise_for_status()
                error = httpx.HTTPStatusError(f"HTTP {r.status_code}", request=r.request, response=r)
            except httpx.TransportError as exc:
                error = exc
            if attempt < 2:
                time.sleep(5 * (attempt + 1))
        raise error

    def get(self, url: str, **params) -> httpx.Response:
        if url.startswith(EUTILS):
            params = {**self.identity, **params}
        return self._send("GET", url, params=params or None)

    def post(self, url: str, **data) -> httpx.Response:
        return self._send("POST", url, data={**self.identity, **data})


def licence_of(xml: str) -> str | None:
    """The Creative Commons licence an article's XML states in its <permissions>: "CC BY-NC-ND", "CC0"; None if none."""
    block = re.search(r"<permissions>.*?</permissions>", xml, re.S)
    m = _CC.search(block.group(0)) if block else None
    if not m:
        return None
    return "CC0" if m.group(2) else "CC " + m.group(1).upper()


def _date(summary: dict) -> str | None:
    m = re.match(r"(\d{4})/(\d{2})/(\d{2})", summary.get("sortpubdate") or "")
    return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None


# --- catalogue --------------------------------------------------------------------------------

_ARTICLE = re.compile(r"<article[ >].*?</article>", re.S)
_PMCID = re.compile(r'<article-id pub-id-type="pmc(?:id)?">(?:PMC)?(\d+)</article-id>')
_LICENCE_BATCH = 20  # full-text XML: a few megabytes per request


def read_licences(ncbi: "Ncbi", items: dict[str, dict]) -> int:
    """For the articles PMC's licence filters gave no licence, read it in the article itself (its
    own XML, from efetch, the check collect() makes): an article that states a Creative Commons
    licence in its <permissions> and gives its full text takes that licence. Returns how many did."""
    todo = [u for u, it in items.items() if not it["licence"]]
    found = 0
    for i in range(0, len(todo), _LICENCE_BATCH):
        try:
            xml = ncbi.post(f"{EUTILS}/efetch.fcgi", db="pmc", id=",".join(todo[i : i + _LICENCE_BATCH])).text
        except Exception as exc:
            print(f"licences read in the articles: batch skipped ({exc})", file=sys.stderr, flush=True)
            continue
        for article in _ARTICLE.findall(xml):
            m = _PMCID.search(article)
            code = licence_of(article)
            if m and m.group(1) in items and code and "<body" in article:
                items[m.group(1)]["licence"] = code
                found += 1
        print(f"licences read in the articles: {min(i + _LICENCE_BATCH, len(todo))}/{len(todo)}", file=sys.stderr, flush=True)
    return found


def licences(out: Path) -> None:
    """Fill the catalogue's missing licences from the articles, without rebuilding the catalogue."""
    path = out / "pmc.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    items = {it["id"].removeprefix("pmc:PMC"): it for it in doc["items"]}
    found = read_licences(Ncbi(), items)
    for it in items.values():
        it["collectable"] = it["licence"] in ADAPTABLE and not it["retired"]
        it["link_only"] = not it["collectable"]
    path.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"licences_read": found, "collectable": sum(i["collectable"] for i in items.values()),
                      "without_licence": sum(not i["licence"] for i in items.values())}))

def catalogue(out: Path) -> None:
    ncbi = Ncbi()
    found = ncbi.get(f"{EUTILS}/esearch.fcgi", db="pubmed", term=QUERY, retmax=10000, retmode="json").json()["esearchresult"]
    pmids = found["idlist"]
    print(f"{found['count']} PubMed records", file=sys.stderr, flush=True)

    items = {}
    for i in range(0, len(pmids), _BATCH):
        res = ncbi.post(f"{EUTILS}/esummary.fcgi", db="pubmed", id=",".join(pmids[i : i + _BATCH]), retmode="json").json()["result"]
        for uid in res.get("uids", []):
            s = res[uid]
            ids = {a["idtype"]: a["value"] for a in s.get("articleids", [])}
            pmcid = ids.get("pmc")
            lang = next((l for l in s.get("lang", []) if l in LANGUAGES), None)
            if not pmcid or not lang:
                continue
            code, label = LANGUAGES[lang]
            items[pmcid.removeprefix("PMC")] = {
                "id": f"pmc:{pmcid}",
                "source": "PubMed Central",
                "title": re.sub(r"\s+", " ", s.get("title", "")).strip().rstrip("."),
                "kind": "Recommandation de bonne pratique",
                "page_url": f"https://{HOST}/articles/{pmcid}/",
                "published": _date(s),
                "themes": [label, s.get("source", "")],
                "language": code,
                "licence": None,
                "doi": ids.get("doi"),
                "retired": "Retracted Publication" in s.get("pubtype", []),
                "in_progress": False,
                "collectable": False,
                "link_only": True,
                "pdfs": [],
            }
        print(f"summaries: {len(items)}", file=sys.stderr, flush=True)

    uids = list(items)
    for filt, code in LICENCES.items():
        for i in range(0, len(uids), _BATCH):
            term = "(" + " OR ".join(f"{u}[uid]" for u in uids[i : i + _BATCH]) + f") AND {filt}[filter]"
            hit = ncbi.post(f"{EUTILS}/esearch.fcgi", db="pmc", term=term, retmax=_BATCH, retmode="json").json()["esearchresult"]["idlist"]
            for u in hit:
                items[u]["licence"] = code
        print(f"licence {code}: done", file=sys.stderr, flush=True)
    read_licences(ncbi, items)
    for it in items.values():
        it["collectable"] = it["licence"] in ADAPTABLE and not it["retired"]
        it["link_only"] = not it["collectable"]

    rows = sorted(items.values(), key=lambda i: i["published"] or "", reverse=True)
    out.mkdir(parents=True, exist_ok=True)
    doc = {"source": {"name": "PubMed Central (NLM)", "query": QUERY, "records": int(found["count"]), "fetched_at": now()}, "items": rows}
    (out / "pmc.json").write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    by = lambda key: {k: sum(key(i) == k for i in rows) for k in sorted({key(i) for i in rows}, key=str)}
    print(json.dumps({"kept": len(rows), "collectable": sum(i["collectable"] for i in rows), "licence": by(lambda i: i["licence"]),
                      "language": by(lambda i: i["language"])}, ensure_ascii=False))


# --- collect ----------------------------------------------------------------------------------

def _latest_version(ncbi: Ncbi, pmcid: str) -> str | None:
    """'PMC123.2' for the newest version of the article in the bucket, None if it is not there."""
    xml = ncbi.get(f"{BUCKET}/", **{"list-type": "2", "prefix": f"{pmcid}.", "delimiter": "/"}).text
    versions = re.findall(rf"<Prefix>({pmcid}\.(\d+))/</Prefix>", xml)
    return max(versions, key=lambda v: int(v[1]))[0] if versions else None


def _https(s3_url: str) -> tuple[str, str | None]:
    """s3://pmc-oa-opendata/key?md5=... -> (https URL, md5)."""
    u = urlparse(s3_url)
    return f"{BUCKET}{u.path}", (parse_qs(u.query).get("md5") or [None])[0]


def collect(url: str, job: str, out: Path, include_supporting: bool) -> int:
    ncbi = Ncbi()
    emit("stage", stage="render")
    m = re.search(r"(PMC\d+)", url, re.I)
    if not m:
        emit("error", message="URL PMC attendue : https://pmc.ncbi.nlm.nih.gov/articles/PMC…/")
        return 2
    pmcid = m.group(1).upper()
    # The licence check, article by article: the article's own XML, from efetch.
    try:
        xml = ncbi.get(f"{EUTILS}/efetch.fcgi", db="pmc", id=pmcid.removeprefix("PMC")).text
    except Exception as exc:
        emit("error", message=f"Article PMC illisible (efetch) : {exc}")
        return 1
    stated = licence_of(xml)
    if "<body" not in xml:
        emit("error", message=f"{pmcid} : texte intégral non fourni par PMC (hors sous-ensemble Open Access) : lien seulement")
        return 1
    if stated not in ADAPTABLE:
        emit("error", message=f"{pmcid} : licence {stated or 'non indiquée'}, qui ne permet pas l'adaptation : lien seulement")
        return 1
    try:
        ver = _latest_version(ncbi, pmcid)
        if not ver:
            emit("error", message=f"{pmcid} n'est pas dans le sous-ensemble Open Access de PMC : lien seulement")
            return 1
        meta = ncbi.get(f"{BUCKET}/{ver}/{ver}.json").json()
    except Exception as exc:
        emit("error", message=f"Notice PMC illisible : {exc}")
        return 1
    emit("page", title=meta.get("title") or pmcid, status_code=200)
    licence = stated
    if meta.get("is_retracted"):
        emit("error", message="Article rétracté : non collecté")
        return 1
    emit("log", message=f"Licence : {licence} · version {meta.get('version')} · {meta.get('citation')}")

    emit("stage", stage="discover")
    if not meta.get("pdf_url"):
        emit("documents", items=[], skipped=[{"url": url, "label": "PDF", "reason": "Pas de PDF dans PMC (XML seulement)"}])
        emit("error", message="Pas de PDF pour cet article dans PMC")
        return 1
    pdf_url, md5 = _https(meta["pdf_url"])
    doc = {"id": "d1", "title": meta.get("title") or pmcid, "document_url": f"https://{HOST}/articles/{pmcid}/", "file_url": pdf_url}
    skipped = [{"url": _https(u)[0], "label": Path(urlparse(u).path).name, "reason": "Annexe : média ou matériel supplémentaire"}
               for u in meta.get("media_urls") or []]
    emit("documents", items=[doc], skipped=skipped)
    if include_supporting and skipped:
        emit("log", message="Les matériels supplémentaires PMC ne sont pas téléchargés (images, tableurs)")

    emit("stage", stage="download")
    emit("doc", id="d1", status="downloading")
    try:
        r = ncbi.get(pdf_url)
        body = r.content
        if len(body) > MAX_PDF_BYTES:
            raise RuntimeError("fichier trop volumineux")
        if not body.startswith(b"%PDF-"):
            raise RuntimeError(f"ce n'est pas un PDF ({r.headers.get('content-type', '?')})")
        if md5 and hashlib.md5(body).hexdigest() != md5:
            raise RuntimeError("empreinte MD5 différente de celle publiée par PMC")
        dest = out / "pmc" / ver
        dest.mkdir(parents=True, exist_ok=True)
        (dest / f"{ver}.pdf").write_bytes(body)
    except Exception as exc:
        emit("doc", id="d1", status="failed", error=str(exc) or type(exc).__name__)
        emit("done", downloaded=0, failed=1)
        return 1
    record = {
        "job_id": job,
        "fetched_at": now(),
        "source_page_url": f"https://{HOST}/articles/{pmcid}/",
        "source_page_title": meta.get("title"),
        "document_url": f"https://{HOST}/articles/{pmcid}/",
        "title": meta.get("title"),
        "filename": f"{ver}.pdf",
        "file_url": pdf_url,
        "bytes": len(body),
        "sha256": hashlib.sha256(body).hexdigest(),
        "content_type": r.headers.get("content-type"),
        "last_modified": r.headers.get("last-modified"),
        "path": str((dest / f"{ver}.pdf").relative_to(out)),
        "citation": meta.get("citation"),
        "doi": meta.get("doi"),
        "pmid": meta.get("pmid"),
        "pmc_version": meta.get("version"),
        "licence": licence,
        "scraper": f"pmc/httpx {version('httpx')}",
    }
    with (out / "manifest.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    emit("doc", id="d1", status="downloaded", record=record)
    emit("done", downloaded=1, failed=0)
    return 0


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("catalogue")
    c.add_argument("--out", type=Path, default=DEFAULT_OUT)
    li = sub.add_parser("licences")
    li.add_argument("--out", type=Path, default=DEFAULT_OUT)
    g = sub.add_parser("collect")
    g.add_argument("url")
    g.add_argument("--job", default=None)
    g.add_argument("--out", type=Path, default=DEFAULT_OUT)
    g.add_argument("--all", action="store_true")
    a = p.parse_args()
    if a.cmd == "catalogue":
        catalogue(a.out)
        return
    if a.cmd == "licences":
        licences(a.out)
        return
    if urlparse(a.url).hostname != HOST:
        emit("error", message=f"Seules les pages {HOST}/articles/PMC… sont prises en charge")
        sys.exit(2)
    a.out.mkdir(parents=True, exist_ok=True)
    sys.exit(collect(a.url, a.job or uuid.uuid4().hex[:12], a.out, a.all))


if __name__ == "__main__":
    main()
