"""French and Algerian bodies that PubMed covers badly: their own guideline pages, not their whole site.

Each source of shared/sources.yaml with a `listing` (URL) and a `link_pattern` (regex on the link address) is read
once a day: the links of that page (and of `listing_more`) that match the pattern are its guidelines. HAS comes
from its open-data catalogue (has_catalogue.py, refreshed weekly). A source marked `manual`, or that answers 401 or
403 or with a bot wall, is never forced: it is listed as "ajout manuel" with its reason.
All requests go through polite.py.
"""

import json
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

import httpx
import yaml

import polite

HERE = Path(__file__).resolve().parent
SHARED = HERE.parents[1] / "shared"
DOWNLOADS = HERE / "downloads"
CACHE = DOWNLOADS / "listings"
FRESH = timedelta(days=1)
HAS_FRESH = timedelta(days=7)
UA = "Mozilla/5.0 (X11; Linux x86_64) MedGuidesBot/0.3 (+guideline collection)"
# sources.yaml id -> guideline_bodies.yaml id
BODY = {"has": "has", "splf": "splf", "spilf": "spilf", "sfc": "sfc", "ansm": "ansm", "cnge": "cnge", "dz-ministry": "dz-ministere", "dz-insp": "dz-ministere",
        "sfmu": "sfmu", "sfar": "sfar"}
# Societies read from their catalogue (societies_catalogue.py -> downloads/societies.json), not from a listing page:
# sources.yaml id -> the catalogue's "source". Their listing page, if any, is not read as well.
SOCIETIES = {"sfmu": "SFMU", "sfar": "SFAR", "sfc": "SFC", "spilf": "SPILF"}
SOCIETIES_FRESH = timedelta(days=7)


def now() -> datetime:
    return datetime.now(timezone.utc)


def sources() -> list[dict]:
    """The sources read through a listing page, the society catalogue, or marked for manual adding."""
    out: list[dict] = []

    def walk(node):
        if isinstance(node, list):
            out.extend(s for s in node if isinstance(s, dict) and ("listing" in s or "manual" in s or s.get("id") in SOCIETIES))
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)

    walk(yaml.safe_load((SHARED / "sources.yaml").read_text(encoding="utf-8")))
    return out


class _Links(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href, self._text = dict(attrs).get("href"), []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href is not None:
            self.links.append((self._href, " ".join(" ".join(self._text).split())))
            self._href = None


def _title_from(url: str) -> str:
    last = unquote(urlparse(url).path.rstrip("/").rsplit("/", 1)[-1])
    return re.sub(r"[-_+]+", " ", re.sub(r"\.(pdf|html?|php)$", "", last, flags=re.I)).strip()


def _year(text: str) -> int | None:
    years = [int(y) for y in re.findall(r"(?<!\d)((?:19|20)\d{2})(?!\d)", text) if 1990 <= int(y) <= now().year + 1]
    return max(years) if years else None


def read_listing(src: dict) -> dict:
    """{"status": "ok" | "ajout manuel" | "erreur", "reason", "entries": [{title, url, pdf, year}]} for one source."""
    if src.get("manual"):
        return {"status": "ajout manuel", "reason": src["manual"], "entries": []}
    path = CACHE / f"{src['id']}.json"
    if path.exists():
        cached = json.loads(path.read_text(encoding="utf-8"))
        if now() - datetime.fromisoformat(cached["read_at"]) < FRESH:
            return cached
    pattern = re.compile(src["link_pattern"], re.I)
    entries: dict[str, dict] = {}
    result = {"status": "ok", "reason": None}
    try:
        with polite.client(headers={"User-Agent": UA}, timeout=30, follow_redirects=True) as c:
            for page in [src["listing"], *src.get("listing_more", [])]:
                r = c.get(page)
                r.raise_for_status()
                parser = _Links()
                parser.feed(r.text)
                for href, text in parser.links:
                    if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
                        continue
                    url = urljoin(str(r.url), href).split("#")[0]
                    if url == page or not pattern.search(url) or urlparse(url).hostname != urlparse(str(r.url)).hostname:
                        continue
                    title = text if len(text) > 8 else _title_from(url)
                    if url not in entries or len(title) > len(entries[url]["title"]):
                        # a date in the title is the document's ("... (31/12/2009)"); the address may carry a later upload date
                        entries[url] = {"title": title, "url": url, "pdf": url.lower().endswith(".pdf"), "year": _year(title) or _year(url)}
    except polite.Blocked as exc:
        result = {"status": "ajout manuel", "reason": f"le site refuse le robot ({exc}) : ajout manuel"}
    except httpx.HTTPStatusError as exc:
        code = exc.response.status_code
        result = {"status": "ajout manuel" if code in (401, 403) else "erreur", "reason": f"HTTP {code}" + (" : ajout manuel" if code in (401, 403) else "")}
    except httpx.HTTPError as exc:
        result = {"status": "erreur", "reason": f"{type(exc).__name__}: {exc}"[:200]}
    out = {**result, "read_at": now().isoformat(timespec="seconds"), "entries": list(entries.values())}
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    return out


def has_entries() -> dict:
    """The HAS publications (open data), refreshed weekly by has_catalogue.py."""
    path = DOWNLOADS / "catalogue.json"
    stale = not path.exists() or now() - datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) > HAS_FRESH
    if stale:
        subprocess.run([sys.executable, str(HERE / "has_catalogue.py"), "--out", str(DOWNLOADS)], capture_output=True, timeout=300)
    if not path.exists():
        return {"status": "erreur", "reason": "catalogue HAS indisponible", "entries": []}
    items = json.loads(path.read_text(encoding="utf-8"))["items"]
    return {"status": "ok", "reason": None, "entries": [
        {"title": i["title"], "url": i["page_url"], "pdf": False, "pdf_url": (i["pdfs"][0]["url"] if i["pdfs"] else None),
         "year": int(i["published"][:4]) if i.get("published") else None, "retired": i.get("retired"), "kind_label": i.get("kind")}
        for i in items if not i.get("in_progress")]}  # a publication in progress (note de cadrage only) is not guidance yet


def society_entries(source_id: str) -> dict:
    """A French society's guidelines from downloads/societies.json. Built once if missing; when older than a week it
    is rebuilt in the background and this search uses the current file (a site crawl never holds a search up)."""
    path = DOWNLOADS / "societies.json"
    script = [sys.executable, str(HERE / "societies_catalogue.py"), "--out", str(DOWNLOADS)]
    if not path.exists():
        subprocess.run(script, capture_output=True, timeout=200)
    elif now() - datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) > SOCIETIES_FRESH:
        subprocess.Popen(script, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    if not path.exists():
        return {"status": "erreur", "reason": "catalogue des sociétés savantes indisponible", "entries": []}
    items = [i for i in json.loads(path.read_text(encoding="utf-8"))["items"] if i.get("source") == SOCIETIES[source_id]]
    return {"status": "ok", "reason": None, "entries": [
        {"title": i["title"], "url": i["page_url"], "pdf": False, "pdf_url": (i["pdfs"][0]["url"] if i.get("pdfs") else None),
         "year": int(str(i["published"])[:4]) if i.get("published") else _year(f"{i['title']} {i['page_url']}")}
        for i in items]}


def _singular_words(text: str) -> str:
    """'etats de mal epileptiques' -> 'etat de mal epileptique': a title in the plural still names the topic."""
    return " ".join(w[:-1] if len(w) > 4 and w[-1] in "sx" and not w.endswith(("ss", "is", "us")) else w for w in text.split())


def matches(title: str, concepts: list[list[str]], fold) -> bool:
    """Every concept named in the title (one of its French phrases), singular or plural."""
    t = f" {_singular_words(re.sub(r'[^a-z0-9+]+', ' ', fold(title)))} "
    def has(p: str) -> bool:
        if re.fullmatch(r"[A-Z0-9+]{2,5}", p.strip()):
            return False  # "ACR" is arrêt cardio-respiratoire and the American College of Radiology: a full name is needed
        q = _singular_words(re.sub(r"[^a-z0-9+]+", " ", fold(p))).strip()
        return bool(q) and (f" {q} " in t or (len(q) > 6 and q in t))
    return all(any(has(p) for p in alts) for alts in concepts)


def french_concepts(query: str | None, topic: dict | None, fold, glossary) -> list[list[str]]:
    """What a French title must name: the topic's French names, or the French words of the query."""
    if topic:
        return [[topic["fr"], *(topic.get("synonyms") or []), *(topic.get("keywords_fr") or [])]]
    text, out = f" {fold(query or '')} ", []
    for fr, _en in glossary():
        if f" {fr} " in text:
            out.append([fr])
            text = text.replace(f" {fr} ", " ")
    out += [[w] for w in text.split() if len(w) > 3]
    return out


def search(query: str | None, topic: dict | None, fold, glossary) -> tuple[list[dict], list[dict]]:
    """(records, sources): the listing entries that match, as records like literature.py's; each source's status."""
    concepts = french_concepts(query, topic, fold, glossary)
    records, status = [], []
    for src in [{"id": "has", "name": "Haute Autorité de Santé"}, *sources()]:
        listing = has_entries() if src["id"] == "has" else society_entries(src["id"]) if src["id"] in SOCIETIES else read_listing(src)
        status.append({"id": src["id"], "name": src["name"], "status": listing["status"], "reason": listing.get("reason"),
                       "url": src.get("listing") if src["id"] not in SOCIETIES and src.get("listing") else src.get("url"), "entries": len(listing["entries"])})
        for e in listing["entries"]:
            if not concepts or not matches(e["title"], concepts, fold):
                continue
            records.append({
                "pmid": None, "title": e["title"], "journal": src["name"], "year": e.get("year"), "title_year": e.get("year"),
                "pubtypes": [], "authors": [], "doi": None, "pmc": None, "url": e["url"],
                "pdf_url": e.get("pdf_url") or (e["url"] if e.get("pdf") else None), "open_access": True,
                "on_listing": True, "listing_source": src["id"], "body_hint": BODY.get(src["id"]), "retired": e.get("retired", False),
            })
    return records, status
