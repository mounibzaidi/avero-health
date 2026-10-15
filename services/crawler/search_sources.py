"""Find a topic's pages on every source of shared/sources.yaml.

    python search_sources.py <topic-id>     # JSON-line events on stdout; -> downloads/search/<topic>.json

Each source is indexed once a week into downloads/source_index/<id>.json: from its sitemaps (the list
of pages a site publishes for crawlers: robots.txt "Sitemap:" lines, else /sitemap.xml), or, for a
site without one, by following its links from the home page (or the source's `start` URL), the
promising ones first, up to MAX_CRAWL_PAGES pages; a site whose plain HTML shows almost no links is
rendered in a headless browser (Crawl4AI). The topic is then matched on each page's link text and
address with the same rules as topics.py (French and English names, keywords, excludes). Polite: robots.txt is obeyed when polite.OBEY_ROBOTS is on, one request at a time per site, DELAY_S apart
(or the site's Crawl-delay), several sites in parallel. Sources that already have a catalogue
(HAS, WHO IRIS, PMC, SFMU, SFAR, SFC, SPILF) are left to it.

Each result is classified (doc_kinds.result_kind: guideline, consensus, systematic_review, research,
news, course, patient_story) and scored (doc_kinds.rank); results are listed by origin (Algeria, France, Europe, USA and Canada,
international), then by score (doc_kinds.rank_key). A source that cannot be read is never dropped silently: it is in the result with its error, and
in downloads/search/unreachable.json (every source that failed, since when, for which topics) until it
answers again. A network failure is tried again on the next search, over IPv4 if need be; a site that
answers but cannot be indexed is tried again a day later.

Events: {"type": "source", "id", "name", "status": "indexing" | "done" | "error", ...},
{"type": "done"}.
"""

import argparse
import asyncio
import gzip
import html
import json
import re
import sys
import threading
import time
import urllib.robotparser
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import unquote, urljoin, urldefrag, urlparse

import httpx

import polite
import yaml

from doc_kinds import language_of, rank, rank_key, result_kind, result_year
from topics import MIN_SCORE, PART, compile_topic, english_names, fold, load_topics, score, tokens
from web_scraper import USER_AGENT

HERE = Path(__file__).resolve().parent
SOURCES = HERE.parents[1] / "shared" / "sources.yaml"
DOWNLOADS = HERE / "downloads"
INDEX = DOWNLOADS / "source_index"
RESULTS = DOWNLOADS / "search"
UNREACHABLE = RESULTS / "unreachable.json"
DELAY_S = 1.5
MAX_DELAY_S = 5.0  # a larger Crawl-delay: the site is indexed more slowly, never faster
MAX_SITEMAPS = 40  # child sitemaps read per site
MAX_URLS = 60_000
FRESH = timedelta(days=7)
FRESH_FAILURE = timedelta(days=1)  # an unreachable site is not tried again on every search
WORKERS = 8
TOP = 15  # results kept per source
# Covered by their own catalogue (has_catalogue.py, pmc.py, societies_catalogue.py).
CATALOGUED = {"has", "who-iris", "pmc", "sfmu", "sfar", "sfc", "spilf"}
# Listing pages, not documents.
SKIP_PATH = re.compile(r"/(tag|tags|category|categorie|author|auteur|feed|page/\d+|search|recherche|wp-json|cart|panier|login|agenda|event)s?(/|$)", re.I)
# Sitemaps worth reading first on a site that has many.
GOOD_SITEMAP = re.compile(r"post|page|publication|recommand|guideline|document|pdf|attachment|media|article|fiche", re.I)

# Link-following crawl, for a site without a sitemap.
MAX_CRAWL_PAGES = 250  # HTML pages fetched per site
SITE_BUDGET_S = 240  # time one site may take to index: a slow site is cut short (marked partial), never holds a search up
MAX_RENDERED_PAGES = 60  # when each page has to be rendered in a browser
MAX_DEPTH = 3
MIN_LINKS = 5  # fewer same-site links in the plain HTML: the page is built by JavaScript, render it
PROMISING = re.compile(r"recommand|guideline|guide|publication|protocol|consensus|referentiel|r[eé]f[eé]rentiel|bonnes?[-_ ]pratiques?|practice|statement|position|fiche|document|pdf|ressource|resource|library|biblioth", re.I)
NOT_PAGE = re.compile(r"\.(jpe?g|png|gif|svg|webp|ico|css|js|zip|mp4|mp3|docx?|xlsx?|pptx?|ics|xml|json)$", re.I)
_browsers = threading.Semaphore(2)  # headless browsers open at once
# Qualifiers a web page rarely repeats in its address or link: "Méningite bactérienne aiguë" is
# found as "meningite", "Asthme aigu grave" as "asthme". The topic's excludes still apply.
GENERIC = tokens("aigu aigue aiguë grave sévère severe bactérienne bacterienne bacterial acute adulte adult "
                 "communautaire community acquired chronique chronic symptomatique symptomatic")


# Words of guidance, as opposed to news or events: such pages come first within a source.
GUIDANCE = re.compile(r"recommand|guideline|guidance|prise[ -]en[ -]charge|management|protocol|consensus|fiche|traitement|treatment|conduite[ -]a[ -]tenir|algorithm", re.I)


def core_terms(t: dict) -> list[tuple[str, frozenset[str]]]:
    """Each topic name without its generic qualifiers, when that leaves something telling."""
    out = []
    for name in [t["fr"], *english_names(t["en"])]:
        full = tokens(name)
        head = full - GENERIC
        if head and head != full and len("".join(head)) >= 5:
            out.append((" ".join(sorted(head)), head))
    return out

_print = threading.Lock()


def emit(**event) -> None:
    with _print:
        print(json.dumps(event, ensure_ascii=False), flush=True)


def sources() -> list[dict]:
    out = []

    def walk(node):
        if isinstance(node, list):
            out.extend(node)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)

    walk(yaml.safe_load(SOURCES.read_text(encoding="utf-8")))
    return out


class Site:
    """One source's polite HTTP client: requests spaced, robots.txt obeyed when polite.OBEY_ROBOTS is on."""

    def __init__(self, client: httpx.Client, base: str):
        self.client, self.base, self.last = client, base.rstrip("/"), 0.0
        self.started, self.cut = time.monotonic(), False
        self.robots = urllib.robotparser.RobotFileParser()
        r = self.get(f"{self.base}/robots.txt", check=False)
        self.robots.parse(r.text.splitlines() if r is not None and r.status_code == 200 else [])
        self.delay = min(MAX_DELAY_S, max(DELAY_S, float(self.robots.crawl_delay(polite.ROBOT_NAME) or 0)))

    def over(self) -> bool:
        """The site has used its SITE_BUDGET_S: what is indexed so far is kept, marked partial."""
        if time.monotonic() - self.started > SITE_BUDGET_S:
            self.cut = True
        return self.cut

    def get(self, url: str, check: bool = True) -> httpx.Response | None:
        if check and self.over():
            return None
        if check and polite.OBEY_ROBOTS and not self.robots.can_fetch(polite.ROBOT_NAME, url):
            return None
        wait = self.last + getattr(self, "delay", DELAY_S) - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self.last = time.monotonic()
        try:
            return self.client.get(url)
        except httpx.HTTPError:
            return None


def _xml(resp: httpx.Response) -> ET.Element | None:
    body = resp.content
    if body[:2] == b"\x1f\x8b":
        body = gzip.decompress(body)
    try:
        return ET.fromstring(body)
    except ET.ParseError:
        return None


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def index_site(client: httpx.Client, s: dict) -> dict:
    """Every page address a site lists in its sitemaps, with its lastmod."""
    home = client.get(s["url"])
    base = f"{urlparse(str(home.url)).scheme}://{urlparse(str(home.url)).hostname}"
    site = Site(client, base)
    queue = list(site.robots.site_maps() or []) or [f"{base}/sitemap.xml", f"{base}/sitemap_index.xml", f"{base}/wp-sitemap.xml"]
    seen, pages, read = set(), {}, 0
    while queue and read < MAX_SITEMAPS and len(pages) < MAX_URLS:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        r = site.get(url)
        if r is None or r.status_code != 200:
            continue
        root = _xml(r)
        if root is None:
            continue
        read += 1
        kind = _local(root.tag)
        for node in root:
            loc = lastmod = None
            for child in node:
                if _local(child.tag) == "loc":
                    loc = (child.text or "").strip()
                elif _local(child.tag) == "lastmod":
                    lastmod = (child.text or "").strip()[:10]
            if not loc:
                continue
            if kind == "sitemapindex":
                queue.append(loc)
            elif not SKIP_PATH.search(urlparse(loc).path):
                pages[loc] = lastmod
        if kind == "sitemapindex":
            queue.sort(key=lambda u: not GOOD_SITEMAP.search(u))  # the promising ones first
    method = "sitemap"
    if not pages:
        method = "crawl"
        found = crawl_site(site, s.get("start") or str(home.url))
        if not found:
            raise RuntimeError("ni sitemap ni liens exploitables")
        return {"id": s["id"], "base": base, "method": method, "indexed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "partial": site.cut, "pages": [{"url": u, **v} for u, v in found.items()]}
    return {"id": s["id"], "base": base, "method": method, "indexed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "partial": site.cut, "pages": [{"url": u, "lastmod": m} for u, m in pages.items()]}


class _Links(HTMLParser):
    """The <a href> of a page with their visible text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.links, self._href, self._text = [], None, []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            self._href, self._text = dict(attrs).get("href"), []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag == "a" and self._href:
            self.links.append((self._href, " ".join(" ".join(self._text).split())))
            self._href = None


def _same_site(url: str, host: str) -> bool:
    h = (urlparse(url).hostname or "").removeprefix("www.")
    return h == host or h.endswith("." + host)


def _render(url: str) -> str | None:
    """A page's HTML once its JavaScript has run (Crawl4AI headless browser)."""
    from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

    async def go():
        async with AsyncWebCrawler(config=BrowserConfig(headless=True, verbose=False, user_agent=USER_AGENT)) as crawler:
            r = await crawler.arun(url, config=CrawlerRunConfig(cache_mode=CacheMode.BYPASS, verbose=False))
            return r.html if r.success else None

    with _browsers:
        try:
            polite.gate(url, USER_AGENT)  # robots.txt, the host's turn, no login page
            return asyncio.run(go())
        except Exception:
            return None


def crawl_site(site: Site, start: str) -> dict[str, dict]:
    """Pages and PDFs reachable from `start` on the same site, with their link text: most promising
    links first, MAX_DEPTH levels, MAX_CRAWL_PAGES fetched (fewer when pages must be rendered)."""
    host = (urlparse(start).hostname or "").removeprefix("www.")
    found: dict[str, dict] = {}
    queue = [(0, 0, start)]  # (not promising, depth, url)
    seen, fetched, render = {start}, 0, False
    while queue and fetched < (MAX_RENDERED_PAGES if render else MAX_CRAWL_PAGES) and not site.over():
        queue.sort()
        _, depth, url = queue.pop(0)
        html = None
        if render:
            if not polite.OBEY_ROBOTS or site.robots.can_fetch(polite.ROBOT_NAME, url):
                time.sleep(site.delay)
                html = _render(url)
        else:
            r = site.get(url)
            if r is not None and r.status_code == 200 and "html" in r.headers.get("content-type", ""):
                html = r.text
        fetched += 1
        if not html:
            continue
        parser = _Links()
        parser.feed(html)
        links = [(urldefrag(urljoin(url, h))[0], t) for h, t in parser.links if h and not h.startswith(("mailto:", "tel:", "javascript:"))]
        links = [(u, t) for u, t in links if u.startswith("http") and _same_site(u, host)]
        if fetched == 1 and len(links) < MIN_LINKS and not render:
            render = True  # the home page is built by JavaScript: read the site through the browser
            html = _render(url)
            if html:
                parser = _Links()
                parser.feed(html)
                links = [(urldefrag(urljoin(url, h))[0], t) for h, t in parser.links if h and not h.startswith(("mailto:", "tel:", "javascript:"))]
                links = [(u, t) for u, t in links if u.startswith("http") and _same_site(u, host)]
        for u, text in links:
            path = urlparse(u).path
            if SKIP_PATH.search(path) or NOT_PAGE.search(path):
                continue
            if u not in found or (text and not found[u]["title"]):
                found[u] = {"lastmod": None, "title": text[:200]}
            if u not in seen and depth < MAX_DEPTH and not u.lower().endswith(".pdf"):
                seen.add(u)
                queue.append((0 if PROMISING.search(u + " " + text) else 1, depth + 1, u))
    return found


def _network_failure(error: str) -> bool:
    """A saved error that was the network's (no route, refused, cut off, timed out), not the site's
    structure: it is not remembered, the site is tried again on the next search."""
    cls = getattr(httpx, error.split(":", 1)[0].strip(), None)
    return isinstance(cls, type) and issubclass(cls, httpx.TransportError)


def load_index(client: httpx.Client, s: dict, refresh: bool) -> dict:
    """The site's index: the saved one while fresh (a site that cannot be indexed is remembered for a
    day, a network failure is not), else rebuilt."""
    path = INDEX / f"{s['id']}.json"
    if path.exists() and not refresh:
        idx = json.loads(path.read_text(encoding="utf-8"))
        age = datetime.now(timezone.utc) - datetime.fromisoformat(idx["indexed_at"])
        if idx.get("error") and age < FRESH_FAILURE and not _network_failure(idx["error"]):
            raise RuntimeError(idx["error"])
        # a partial index (the site was cut short) is completed a day later, a full one a week later
        if not idx.get("error") and age < (FRESH_FAILURE if idx.get("partial") else FRESH):
            return idx
    INDEX.mkdir(parents=True, exist_ok=True)
    try:
        try:
            idx = index_site(client, s)
        except httpx.TransportError:
            # no route, refused, cut off: once more over IPv4 (a network without IPv6 fails on sites that announce it)
            with polite.client(headers=dict(client.headers), timeout=30, follow_redirects=True, local_address="0.0.0.0") as v4:
                idx = index_site(v4, s)
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"[:200]
        path.write_text(json.dumps({"id": s["id"], "error": error, "indexed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "pages": []}), encoding="utf-8")
        raise RuntimeError(error) from exc
    path.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    return idx


def page_title(url: str) -> str:
    """A readable title from the address: '/fr/prise-en-charge-du-sepsis.pdf' -> 'prise en charge du sepsis'."""
    # the last meaningful segment: not a number, an index page, a language code or a 1-3 letter stub
    parts = [unquote(p) for p in urlparse(url).path.split("/") if p]
    meaningful = [p for p in parts if not re.fullmatch(r"[\d_-]+(\.\w+)?|index\.\w+|[a-z]{1,3}|[a-z]{2}-[a-z]{2}", p, re.I)]
    last = meaningful[-1] if meaningful else (parts[-1] if parts else urlparse(url).hostname)
    last = re.sub(r"\.(pdf|html?|php|aspx?)$", "", last, flags=re.I)
    return re.sub(r"[-_+]+", " ", last).strip()


def scored(f: dict, topic: dict, source: dict) -> dict:
    """The result with its kind, its year and its score for the topic (doc_kinds.rank)."""
    f.update(classify(f["title"], f["url"], f.get("lastmod")))
    language = language_of(f["title"], (source.get("lang") or "").split(",")[0] or None)
    f.update(rank({**f, "language": language, "buildable": source.get("reuse") != "link_only", "region": source.get("region")}, topic, datetime.now(timezone.utc).year))
    return f


def search(idx: dict, c: dict, heads: list[tuple[str, frozenset[str]]] = (), topic: dict | None = None, source: dict | None = None) -> list[dict]:
    found = []
    for p in idx["pages"]:
        link_text = p.get("title") or ""
        link_text = "" if link_text == "-" else link_text
        title = link_text if len(link_text) > 8 else page_title(p["url"])
        words = link_text + " " + " ".join(unquote(urlparse(p["url"]).path).split("/"))
        item = {"title": title, "_folded": fold(words), "_tokens": tokens(re.sub(r"[-_+/.]", " ", words))}
        s, full, why = score(item, c)
        if s < MIN_SCORE and not any(x in item["_folded"] for x in c["exclude"]):
            for label, need in heads:
                if need <= item["_tokens"]:
                    s += PART
                    why.append(label)
                    break
        if s >= MIN_SCORE:
            found.append({"title": title, "titled": "title" in p, "url": p["url"], "lastmod": p.get("lastmod"), "pdf": p["url"].lower().endswith(".pdf"),
                          "guidance": bool(GUIDANCE.search(fold(words))), "score": s, "matched": why})
    for f in found:
        scored(f, topic or {"fr": "", "en": ""}, source or {})
    found.sort(key=rank_key)
    return found[:TOP]


def classify(title: str, url: str, lastmod: str | None) -> dict:
    """A result's kind of document and its year, for the ranking."""
    return {"kind": result_kind(title, url), "year": result_year(title, url, lastmod, datetime.now(timezone.utc).year)}


def log_unreachable(topic: str, results: dict[str, dict], urls: dict[str, str]) -> None:
    """downloads/search/unreachable.json: every source that could not be read, with its error, since
    when and for which topics, so a person can check them. A source that answers again leaves the log."""
    log = json.loads(UNREACHABLE.read_text(encoding="utf-8")) if UNREACHABLE.exists() else {}
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for sid, r in results.items():
        if r["status"] != "error":
            log.pop(sid, None)
            continue
        entry = log.setdefault(sid, {"name": r["name"], "url": urls[sid], "first_failed_at": now, "topics": []})
        entry.update(error=r["error"], last_failed_at=now, topics=sorted({*entry["topics"], topic}))
    UNREACHABLE.write_text(json.dumps(dict(sorted(log.items())), ensure_ascii=False, indent=2), encoding="utf-8")


_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


def fill_titles(client: httpx.Client, s: dict, idx: dict, found: list[dict]) -> None:
    """The real title of each result known only by its address (sitemap entries), read once from the
    page and kept in the site's index. PDFs keep their address-based title."""
    todo = [f for f in found if not f["pdf"] and not f.get("titled")]
    if not todo:
        return
    by_url = {p["url"]: p for p in idx["pages"]}
    site = Site(client, idx["base"])
    changed = False
    for f in todo:
        page = by_url.get(f["url"])
        if page is None or page.get("title"):
            continue
        r = site.get(f["url"])
        m = _TITLE.search(r.text[:200_000]) if r is not None and r.status_code == 200 and "html" in r.headers.get("content-type", "") else None
        title = " ".join(html.unescape(m.group(1)).split())[:200] if m else ""
        page["title"] = title or "-"  # "-": looked, none found; not asked again
        changed = True
        if title:
            f["title"] = title
    if changed:
        (INDEX / f"{s['id']}.json").write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("topic")
    ap.add_argument("--refresh", action="store_true", help="rebuild every site index")
    args = ap.parse_args()
    topics, _ = load_topics()
    t = next((t for t in topics if t["id"] == args.topic), None)
    if not t:
        emit(type="error", message=f"thème inconnu : {args.topic}")
        sys.exit(2)
    c = compile_topic(t)
    heads = core_terms(t)
    todo = [s for s in sources() if s["id"] not in CATALOGUED]
    todo.sort(key=lambda s: s.get("priority", 3))
    results = {}

    def one(s: dict) -> None:
        base = {"type": "source", "id": s["id"], "name": s["name"], "reuse": s.get("reuse", "check"), "priority": s.get("priority", 3), "lang": s.get("lang")}
        emit(**base, status="indexing")
        try:
            with polite.client(headers={"User-Agent": USER_AGENT}, timeout=30, follow_redirects=True) as client:
                idx = load_index(client, s, args.refresh)
                found = search(idx, c, heads, t, s)
                try:
                    fill_titles(client, s, idx, found)
                except Exception:
                    pass  # address-based titles, then
                for f in found:  # the real titles say more about the kind of document than the addresses
                    scored(f, t, s)
                found.sort(key=rank_key)
            results[s["id"]] = {**base, "status": "done", "method": idx.get("method", "sitemap"), "pages": len(idx["pages"]), "partial": bool(idx.get("partial")), "results": found}
        except Exception as exc:
            msg = str(exc) if isinstance(exc, RuntimeError) else f"{type(exc).__name__}: {exc}"
            results[s["id"]] = {**base, "status": "error", "error": msg[:200], "results": []}
        emit(**results[s["id"]])

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(one, todo))
    RESULTS.mkdir(parents=True, exist_ok=True)
    log_unreachable(t["id"], results, {s["id"]: s["url"] for s in todo})
    out = {"topic": t["id"], "searched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "sources": sorted(results.values(), key=lambda r: (r["priority"], -len(r["results"])))}
    (RESULTS / f"{t['id']}.json").write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    emit(type="done", found=sum(len(r["results"]) for r in results.values()))


if __name__ == "__main__":
    main()
