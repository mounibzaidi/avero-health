"""Each body the librarian names, crawled: its status comes from what its site or catalogue actually holds, not from
the model's guess ("inconnu", "aucune" are claims too).

For every body of the librarian's answer (listed and discovered), its site is found in shared/sources.yaml (by the
registry id, the name or the domain), else from the domain the librarian gave. Then:
- a body read through a catalogue or listing page (HAS, SFMU, SFAR, SFC, SPILF, ANSM, SPLF: listings.py) is
  counted from that catalogue, which the search already read;
- any other site is searched in its weekly index (search_sources.py: sitemap or link crawl), with the topic's names,
  every French spelling variant of the librarian's search terms, and the quoted phrases of its crawl_queries. The
  pages and PDFs found become records, classified like the others;
- a source marked manual, or a body with no known site, is "non crawlable (ajout manuel)".
The status ("trouvé (n)", "applique ESC 2024", "crawlé, rien trouvé", "site inaccessible", "non crawlable") is set by
literature.py once the records are classified (status_of). The crawl_queries are web-search queries
(site:... filetype:pdf); without a search engine they are run against the body's own site index, and the log says so.
"""

import re
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

import literature as L
import listings
import polite
import search_sources as SS
from topics import compile_topic

CATALOGUES = {"has", "sfmu", "sfar", "sfc", "spilf", "ansm", "splf"}  # read by listings.py
WORKERS = 6


def _host(url: str) -> str:
    return (urlparse(url if "//" in url else f"https://{url}").hostname or "").removeprefix("www.")


def source_for(body: dict) -> dict | None:
    """The body's site: its shared/sources.yaml entry (registry id, name or domain), else the domain the librarian gave."""
    sources = SS.sources()
    reg = L._proposal_body(body)
    if reg:
        s = next((s for s in sources if s["id"] == reg["id"] or (reg["id"] == "dz-ministere" and s["id"] == "dz-ministry")), None)
        if s:
            return s
    names = {L.fold(body.get("body") or ""), L.fold(body.get("body_full_name") or "")} - {""}
    domain = _host(body.get("website_domain") or "") if body.get("website_domain") else ""
    for s in sources:
        host = _host(s["url"])
        if (domain and (host == domain or domain.endswith("." + host) or host.endswith("." + domain))) or L.fold(s["name"]) in names or s["id"] in names:
            return s
    return {"id": "web-" + domain, "name": body.get("body"), "url": f"https://{domain}"} if domain else None


def _phrases(queries: list[str]) -> list[str]:
    """The quoted phrases of web queries ('site:sfcardio.fr "syndrome coronarien aigu" filetype:pdf')."""
    return [p for q in queries for p in re.findall(r'"([^"]{4,80})"', q or "")]


def crawl_one(body: dict, topic: dict, records: list[dict], listing_status: dict) -> tuple[list[dict], dict]:
    """(new records from the body's site, its crawl log)."""
    s = source_for(body)
    log = {"body": body.get("body"), "discovered": bool(body.get("discovered")), "adopts": body.get("adopts"),
           "source": s["id"] if s else None, "site": s["url"] if s else None, "queries": [], "urls_fetched": 0,
           "pdfs_found": 0, "pdfs_classified": 0, "error": None, "method": None, "record_urls": []}
    if s is None or s.get("manual"):
        log["method"] = "manual"
        log["error"] = (s or {}).get("manual") or "aucun site connu"
        return [], log
    queries = list(dict.fromkeys([topic["fr"], *(topic.get("keywords_fr") or []), *_phrases(body.get("crawl_queries") or [])]))
    log["queries"] = queries
    if s["id"] in CATALOGUES:
        log["method"] = "catalogue"
        st = listing_status.get(s["id"], {})
        log["urls_fetched"] = st.get("entries", 0)
        if st.get("status") == "erreur":
            log["error"] = st.get("reason") or "catalogue illisible"
        mine = [r for r in records if r.get("listing_source") == s["id"]]
        log["pdfs_found"] = sum(1 for r in mine if r.get("pdf_url"))
        log["record_urls"] = [r["url"] for r in mine]
        return [], log
    log["method"] = "index du site"
    t = {**topic, "keywords_fr": queries[1:]}
    try:
        with polite.client(headers={"User-Agent": SS.USER_AGENT}, timeout=30, follow_redirects=True) as client:
            idx = SS.load_index(client, s, False)
            found = SS.search(idx, compile_topic(t), SS.core_terms(t), t, s)
    except Exception as exc:
        log["error"] = f"{type(exc).__name__}: {exc}"[:200]
        return [], log
    log["urls_fetched"] = len(idx.get("pages", []))
    reg = L._proposal_body(body)
    out = []
    for f in found:
        out.append({"pmid": None, "title": f["title"], "journal": s["name"], "year": f.get("year"), "title_year": f.get("year"),
                    "pubtypes": [], "authors": [], "doi": None, "pmc": None, "url": f["url"], "lang": [],
                    "pdf_url": f["url"] if f.get("pdf") else None, "open_access": True, "on_listing": True,
                    "listing_source": s["id"], "body_hint": reg["id"] if reg else None, "body_name_hint": body.get("body"), "retired": False})
    log["pdfs_found"] = sum(1 for r in out if r["pdf_url"])
    log["record_urls"] = [r["url"] for r in out]
    return out, log


def crawl(bodies: list[dict], topic: dict, records: list[dict], listing_status: list[dict]) -> tuple[list[dict], list[dict]]:
    """(new records, one crawl log per body), the sites crawled a few at a time."""
    status = {s["id"]: s for s in listing_status}
    known = {r["url"] for r in records}
    with ThreadPoolExecutor(WORKERS) as pool:
        results = list(pool.map(lambda b: crawl_one(b, topic, records, status), bodies))
    new, logs = [], []
    for recs, log in results:
        for r in recs:
            if r["url"] not in known:
                known.add(r["url"])
                new.append(r)
        logs.append(log)
    return new, logs


def status_of(log: dict, records: list[dict]) -> dict:
    """The body's status from the crawl and the classified records: found documents first, then adoption, then what
    the crawl met."""
    reg = L._proposal_body({"body": log["body"]})
    urls = set(log.get("record_urls") or [])
    mine = [r for r in records if r.get("label") == "primary_guidance" and r.get("relevance") != "off_topic"
            and (r["url"] in urls or (reg and r.get("body") == reg["id"])
                 or (not reg and L.fold(log["body"] or "-") in L.fold(r.get("body_name") or "")))]
    log["pdfs_classified"] = sum(1 for r in records if r["url"] in urls and r.get("pdf_url") and r.get("label"))
    if mine:
        text = f"trouvé ({len(mine)})"
    elif log.get("adopts") and isinstance(log["adopts"], dict) and log["adopts"].get("body"):
        a = log["adopts"]
        text = f"applique {a['body']}" + (f" {a['year']}" if a.get("year") else "")
    elif log["method"] == "manual":
        text = "non crawlable (ajout manuel)"
    elif log.get("error"):
        text = "site inaccessible"
    else:
        text = "crawlé, rien trouvé"
    return {"body": log["body"], "status": text, "found": len(mine), "discovered": log["discovered"], "method": log["method"]}
