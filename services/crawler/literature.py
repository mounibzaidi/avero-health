"""Guideline discovery through the literature APIs: PubMed E-utilities (what exists) and Europe PMC (its DOI and
its open-access PDF). The main discovery layer of the search; site crawling is kept for the French and Algerian
bodies PubMed covers badly (listings.py).

    python literature.py --query "embolie pulmonaire"      # JSON on stdout
    python literature.py --topic pulmonary-embolism

Each record is classified (guideline | consensus | article), attributed to its issuing body
(shared/guideline_bodies.yaml), grouped into families (same body, same topic: the newest is current, the others
are "Version antérieure"; copies in several journals are one entry), and ranked: guideline > consensus > article,
then recency, then a title that names the topic. A family whose topic another body covers more recently says so.
Rate limits: 3 requests a second to NCBI (10 with NCBI_API_KEY), one at a time.
"""

import argparse
import json
import os
import re
import sys
import time
import unicodedata
from functools import lru_cache
from pathlib import Path

import httpx
import yaml

HERE = Path(__file__).resolve().parent
SHARED = HERE.parents[1] / "shared"
EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
TOOL = "medguides-bot"
SINCE = 2010  # older guidelines are history, not practice

# ─── Settings and polite access ────────────────────────────────────────────────────────────────


def setting(name: str) -> str | None:
    """From the environment, else services/crawler/.env.local, else the repo-root .env.local (read only)."""
    if os.environ.get(name):
        return os.environ[name]
    for env in (HERE / ".env.local", HERE.parents[1] / ".env.local"):
        for line in env.read_text(encoding="utf-8").splitlines() if env.exists() else []:
            key, _, value = line.partition("=")
            if key.strip() == name and value.strip():
                return value.strip().strip('"\'')
    return None


class Throttle:
    """At most `per_s` requests a second, one at a time (NCBI: 3 without a key, 10 with)."""

    def __init__(self, per_s: float):
        self.gap, self.last = 1 / per_s, 0.0

    def wait(self) -> None:
        pause = self.last + self.gap - time.monotonic()
        if pause > 0:
            time.sleep(pause)
        self.last = time.monotonic()


_NCBI = Throttle(10 if setting("NCBI_API_KEY") else 3)
_EBI = Throttle(5)
_client = httpx.Client(timeout=30, headers={"User-Agent": "MedGuidesBot/0.3 (+guideline provenance)"})


def _ncbi(path: str, params: dict, post: bool = False) -> dict:
    params = {**params, "retmode": "json", "tool": TOOL}
    if setting("NCBI_EMAIL"):
        params["email"] = setting("NCBI_EMAIL")
    if setting("NCBI_API_KEY"):
        params["api_key"] = setting("NCBI_API_KEY")
    for attempt in range(3):
        _NCBI.wait()
        try:
            r = _client.post(f"{EUTILS}/{path}", data=params) if post else _client.get(f"{EUTILS}/{path}", params=params)
        except httpx.TimeoutException:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))
            continue
        if r.status_code == 429:  # too fast: back off and try again
            time.sleep(1 + attempt)
            continue
        r.raise_for_status()
        return r.json()
    r.raise_for_status()
    return {}


# ─── Query: the topic's English names, or the French words translated ──────────────────────────


def fold(s: str) -> str:
    s = "".join(c for c in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s.replace("’", "'")).strip()


@lru_cache(maxsize=1)
def _glossary() -> list[tuple[str, str]]:
    terms = yaml.safe_load((SHARED / "search-terms.yaml").read_text(encoding="utf-8"))["terms"]
    return sorted(((fold(fr), en) for fr, en in terms.items()), key=lambda x: -len(x[0]))


def concepts_for(query: str | None = None, topic: dict | None = None) -> list[list[str]]:
    """What must be in a title, as concepts AND-ed together, each a list of English phrases OR-ed."""
    if topic:
        names = [n.strip() for n in topic["en"].split("/") if n.strip()]
        return [names]
    text, out = f" {fold(query or '')} ", []
    for fr, en in _glossary():  # longest phrases first; a matched phrase is removed so its words are not matched again
        if f" {fr} " in text:
            out.append([en])
            text = text.replace(f" {fr} ", " ")
    leftover = [w for w in text.split() if len(w) > 3 and w.isascii() and w not in {"pour", "dans", "avec", "chez", "sans"}]
    out += [[w] for w in leftover]  # an English or international word typed as is ("sepsis")
    return out


GUIDE_FILTER = (
    '(guideline[pt] OR "practice guideline"[pt] OR "consensus development conference"[pt] OR guideline*[ti] OR recommendation*[ti]'
    ' OR consensus[ti] OR "position statement"[ti] OR "scientific statement"[ti] OR "position paper"[ti] OR "standards of care"[ti])'
)


def pubmed_term(concepts: list[list[str]]) -> str:
    parts = ["(" + " OR ".join(f'"{p}"[ti]' for p in alts) + ")" for alts in concepts]
    return " AND ".join(parts) + f" AND {GUIDE_FILTER} AND {SINCE}:3000[dp]"


# ─── PubMed ─────────────────────────────────────────────────────────────────────────────────────


def pubmed(term: str) -> list[dict]:
    """The records for a query: newest first and most relevant, so an older reference guideline is not missed."""
    ids: list[str] = []
    for sort, n in (("pub_date", 200), ("relevance", 100)):
        found = _ncbi("esearch.fcgi", {"db": "pubmed", "term": term, "retmax": n, "sort": sort})["esearchresult"]["idlist"]
        ids += [i for i in found if i not in ids]
    records = []
    for k in range(0, len(ids), 200):
        res = _ncbi("esummary.fcgi", {"db": "pubmed", "id": ",".join(ids[k : k + 200])}, post=True)["result"]
        for pmid in res.get("uids", []):
            r = res[pmid]
            title = re.sub(r"\s+", " ", r.get("title", "")).strip().rstrip(".")
            year = int(r["pubdate"][:4]) if r.get("pubdate", "")[:4].isdigit() else None
            ids_ = {a["idtype"]: a["value"] for a in r.get("articleids", [])}
            records.append({
                "pmid": pmid, "title": title, "journal": r.get("source") or "", "year": year,
                "title_year": _title_year(title), "pubtypes": r.get("pubtype", []),
                "authors": [a["name"] for a in r.get("authors", [])], "doi": ids_.get("doi"), "pmc": ids_.get("pmc"),
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
            })
    return records


def _title_year(title: str) -> int | None:
    m = re.match(r"^\W*((?:19|20)\d{2})\b", title) or re.search(r"\(((?:19|20)\d{2})\)\s*$", title)
    return int(m.group(1)) if m else None


# ─── Europe PMC: DOI and open-access PDF ────────────────────────────────────────────────────────


EPMC_FAILURES: list[str] = []  # batches Europe PMC did not answer: the search still returns, without their PDF links


def _epmc_get(params: dict) -> dict | None:
    for attempt in range(3):
        _EBI.wait()
        try:
            r = _client.get(EPMC, params=params, timeout=60)
            if r.status_code == 200:
                return r.json()
        except httpx.HTTPError:
            pass
        time.sleep(2 * (attempt + 1))
    return None


def europe_pmc(pmids: list[str]) -> dict[str, dict]:
    """DOI and open-access PDF link by PMID. Best effort: a batch Europe PMC does not answer is skipped and noted."""
    out: dict[str, dict] = {}
    for k in range(0, len(pmids), 25):
        chunk = pmids[k : k + 25]
        data = _epmc_get({"query": f"({' OR '.join(f'EXT_ID:{p}' for p in chunk)}) AND SRC:MED", "resultType": "core", "format": "json", "pageSize": 100})
        if data is None:
            EPMC_FAILURES.append(f"{len(chunk)} référence(s)")
            continue
        for it in data.get("resultList", {}).get("result", []):
            pdf = None
            for u in (it.get("fullTextUrlList") or {}).get("fullTextUrl", []):
                if u.get("documentStyle") == "pdf" and u.get("availabilityCode") in ("OA", "F"):
                    pdf = u["url"]
                    break
            if not pdf and it.get("pmcid") and it.get("isOpenAccess") == "Y":
                pdf = f"https://europepmc.org/articles/{it['pmcid']}?pdf=render"
            out[it.get("pmid", "")] = {"doi": it.get("doi"), "open_access": it.get("isOpenAccess") == "Y", "pdf_url": pdf}
    return out


# ─── Classification and issuing body ────────────────────────────────────────────────────────────

NOT_GUIDANCE_PT = {"Comment", "Editorial", "Published Erratum", "Letter", "News", "Retraction Notice", "Retracted Publication", "Review",
                   "Systematic Review", "Meta-Analysis", "Case Reports", "Observational Study", "Randomized Controlled Trial"}
GUIDE_PT = {"Guideline", "Practice Guideline"}
CONSENSUS_PT = {"Consensus Development Conference", "Consensus Development Conference, NIH"}
# A title about a guideline, not a guideline: commentary, comparison, adherence, therapy "guideline-directed"...
ABOUT = re.compile(
    r"\b(correction|erratum|perspective|perspectives|comparison|compared|comparing|implications?|at-a-glance|key points|adherence|implement\w*|"
    r"guideline[- ](directed|based|recommended|concordant|defined)|editorial|commentary|comment|reading the|prompted by|journal scan|predicted|"
    r"user'?s guide|in transition|a new era|cutting edge|insights?|lessons|reflections|what do the guidelines|harmony|dissonance|survey|registry|"
    r"systematic review|meta-analysis|trends?|barriers|evaluating|assessment of|pertinent points|large language models?|artificial intelligence|chatgpt|machine learning|reply|dissent|neglect\w*|impact of|response to|in response|rebuttal|missing from|beyond the|note de cadrage)\b", re.I)
GUIDE_TITLE = re.compile(
    r"\b(guidelines?|recommendations?|recommandations?)\s+(for|on|pour|de|sur|du|des|in the)\b|clinical practice guideline|\bstandards of (medical )?care\b|"
    r"^\W*(\d{4}\s+)?[\w/ .&-]{0,80}\bguidelines?\W*$", re.I)
CONSENSUS_TITLE = re.compile(
    r"\b(consensus statement|consensus document|expert consensus|clinical consensus statement|position statement|position paper|scientific statement|"
    r"consensus conference|conférence de consensus|déclaration de consensus|controversies conference)\b", re.I)


def classify(rec: dict, on_listing: bool = False) -> tuple[str, str]:
    """(kind, why): "guideline" only for a PubMed guideline type, a document of an official listing page, or a title
    that names itself a guideline or recommendations; "consensus" alike; everything else is an "article"."""
    pts, title = set(rec.get("pubtypes") or []), rec["title"]
    if pts & {"Published Erratum", "Comment", "Editorial", "Letter", "News"} or ABOUT.search(title):
        return "article", "commentaire, correction ou article sur une recommandation"
    if on_listing:
        return "guideline", "page officielle des recommandations de l'organisme"
    if CONSENSUS_TITLE.search(title):  # a statement or consensus, whatever PubMed calls it
        return "consensus", "le titre annonce un consensus ou une prise de position"
    if pts & GUIDE_PT:
        return "guideline", "type de publication PubMed : recommandation"
    if pts & CONSENSUS_PT:
        return "consensus", "type de publication PubMed : conférence de consensus"
    if pts & NOT_GUIDANCE_PT:
        return "article", "type de publication PubMed : " + ", ".join(sorted(pts & NOT_GUIDANCE_PT))
    if CONSENSUS_TITLE.search(title):
        return "consensus", "le titre annonce un consensus ou une prise de position"
    if GUIDE_TITLE.search(title):
        return "guideline", "le titre annonce une recommandation"
    return "article", "ni type ni titre de recommandation"


@lru_cache(maxsize=1)
def _bodies() -> list[dict]:
    doc = yaml.safe_load((SHARED / "guideline_bodies.yaml").read_text(encoding="utf-8"))
    for b in doc["bodies"]:
        b["_title"] = [re.compile(p) for p in b.get("title", [])]
    return doc["bodies"]


def issuing_body(rec: dict) -> dict | None:
    """The body that issued it: named in the title, else a collective author, else the journal."""
    bodies = _bodies()
    for b in bodies:
        if any(p.search(rec["title"]) for p in b["_title"]):
            return b
    for b in bodies:
        if any(a in name for a in b.get("authors", []) for name in rec.get("authors", [])):
            return b
    for b in bodies:
        if rec.get("journal") in b.get("journals", []):
            return b
    return None


# ─── Families, versions, ranking ────────────────────────────────────────────────────────────────

_BOILER = set("""guideline guidelines recommendation recommendations recommandations recommandation consensus statement position paper scientific
document expert clinical practice report joint committee task force for the of and in on a an with to by from developed collaboration
management diagnosis evaluation treatment prevention detection care adults adult patients update focused international european
american society association college organisation organization working group writing members update""".split())


def topic_key(title: str) -> frozenset[str]:
    """The title's subject words: no year, body, boilerplate or anything after 'developed in collaboration with'."""
    t = re.split(r"\b(developed in collaboration|in collaboration with|a report of|endorsed by)\b", fold(title))[0]
    t = re.sub(r"\([^)]*\)", " ", t)
    t = re.sub(r"[\w-]+(/[\w-]+)+", " ", t)  # co-author chains: "aha/acc/accp/chest/..."
    words = re.findall(r"[a-z][a-z-]{2,}", t)
    acronyms = {fold(p.pattern).strip("\\b") for b in _bodies() for p in b["_title"]}
    return frozenset(w for w in words if w not in _BOILER and w not in acronyms and not re.fullmatch(r"(19|20)\d\d", w))


def _same(a: frozenset, b: frozenset, threshold: float) -> bool:
    return bool(a and b) and len(a & b) / len(a | b) >= threshold


def families(records: list[dict]) -> list[dict]:
    """Guidance records grouped by body and topic: the newest version first, older ones after it; the copies of one
    version in several journals are one entry ("aussi publié dans")."""
    groups: list[dict] = []
    for r in sorted(records, key=lambda r: -(r["version_year"] or 0)):
        key = topic_key(r["title"])
        g = next((g for g in groups if g["body"] == r["body"] and r["body"] and _same(g["key"], key, 0.5)), None)
        if g is None:
            groups.append({"body": r["body"], "key": key, "versions": [r]})
            continue
        twin = next((v for v in g["versions"] if v["version_year"] == r["version_year"] and _same(topic_key(v["title"]), key, 0.5)), None)
        if twin:
            # the body's own journal is the original: it becomes the entry, the other copy goes to "also_in"
            own = {b["id"]: b.get("journals", []) for b in _bodies()}.get(r["body"] or "", [])
            if r["journal"] in own and twin["journal"] not in own:
                i = g["versions"].index(twin)
                r["also_in"] = [*twin.pop("also_in", []), {"journal": twin["journal"], "url": twin["url"], "doi": twin.get("doi")}]
                g["versions"][i] = r
            else:
                twin.setdefault("also_in", []).append({"journal": r["journal"], "url": r["url"], "doi": r.get("doi")})
        else:
            g["versions"].append(r)
    for g in groups:
        for i, v in enumerate(g["versions"]):
            v["version"] = "actuelle" if i == 0 else "antérieure"
    # Another body covering the same topic more recently: the older family says so.
    for g in groups:
        cur = g["versions"][0]
        newer = [h["versions"][0] for h in groups if h is not g and h["body"] != g["body"] and _same(h["key"], g["key"], 0.4)
                 and (h["versions"][0]["version_year"] or 0) > (cur["version_year"] or 0) and h["versions"][0]["kind"] == "guideline"]
        if newer:
            best = max(newer, key=lambda v: v["version_year"] or 0)
            g["newer_elsewhere"] = {"body": best["body_name"], "year": best["version_year"], "title": best["title"]}
    return groups


KIND_RANK = {"guideline": 0, "consensus": 1, "article": 2}
FOCUS = 0.6  # share of the title's subject words that are the topic's: the topic is what the guideline is about


def rank_key(r: dict) -> tuple:
    """Official guideline > other guideline > consensus > article; then a guideline whose main subject is the topic;
    then the most recent; then a title that names the topic over a match found elsewhere."""
    return (KIND_RANK[r["kind"]], 0 if r.get("official") else 1, 0 if r.get("focus", 0) >= FOCUS else 1, -(r["version_year"] or 0),
            0 if r.get("title_match") else 1)


def search(query: str | None = None, topic: dict | None = None, with_listings: bool = True) -> dict:
    concepts = concepts_for(query, topic)
    if not concepts:
        return {"query": query, "concepts": [], "families": [], "articles": [], "sources": [], "error": "Aucun terme de recherche reconnu"}
    term = pubmed_term(concepts)
    records = pubmed(term)
    # the topic's own excludes (topics.yaml): a title naming one is another topic's guideline
    excluded = [fold(x) for x in (topic or {}).get("exclude") or []]
    if excluded:
        records = [r for r in records if not any(x in fold(r["title"]) for x in excluded)]
    listing_status: list[dict] = []
    if with_listings:
        import listings

        found, listing_status = listings.search(query, topic, fold, _glossary)
        records += found
    by_id = {b["id"]: b for b in _bodies()}
    for r in records:
        r["kind"], r["why"] = classify(r, on_listing=bool(r.get("on_listing")))
        b = by_id.get(r["body_hint"]) if r.get("body_hint") else (issuing_body(r) if r["kind"] != "article" else None)
        r["body"], r["body_name"] = (b["id"], b["name"]) if b else (None, None)
        r["region"] = b["region"] if b else None
        r["version_year"] = r["title_year"] or r["year"]
        folded = fold(r["title"])
        r["title_match"] = all(any(fold(p) in folded for p in alts) for alts in concepts)
        # official: issued by a known body (shared/guideline_bodies.yaml) or found on a body's own listing page
        r["official"] = r["kind"] != "article" and (r["body"] is not None or bool(r.get("on_listing")))
        key, wanted = topic_key(r["title"]), {w for alts in concepts for p in alts for w in fold(p).split()}
        r["focus"] = round(len(key & wanted) / len(key), 2) if key else 0
    guidance = [r for r in records if r["kind"] != "article"]
    extra = europe_pmc([r["pmid"] for r in guidance if r.get("pmid")])
    for r in guidance:
        e = extra.get(r["pmid"], {})
        r["doi"] = r.get("doi") or e.get("doi")
        if r.get("pmid"):
            r["pdf_url"], r["open_access"] = e.get("pdf_url"), e.get("open_access", False)
    fams = families(guidance)
    fams.sort(key=lambda g: rank_key(g["versions"][0]))
    articles = sorted((r for r in records if r["kind"] == "article"), key=rank_key)
    return {"query": query, "topic": topic["id"] if topic else None, "concepts": concepts, "term": term,
            "families": [{k: v for k, v in g.items() if k != "key"} for g in fams], "articles": articles,
            "sources": [{"id": "pubmed", "name": "PubMed + Europe PMC", "status": "ok", "entries": len([r for r in records if r.get("pmid")]),
                         "reason": f"Europe PMC n'a pas répondu pour {', '.join(EPMC_FAILURES)} : liens PDF incomplets" if EPMC_FAILURES else None},
                        *listing_status]}


def top(result: dict, n: int = 5) -> list[dict]:
    """The first n entries a person sees: the current version of each family, in rank order."""
    return [g["versions"][0] for g in result["families"]][:n]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--query")
    ap.add_argument("--topic")
    args = ap.parse_args()
    t = None
    if args.topic:
        from topics import load_topics

        t = next((x for x in load_topics()[0] if x["id"] == args.topic), None)
        if not t:
            sys.exit(f"thème inconnu : {args.topic}")
    print(json.dumps(search(args.query, t), ensure_ascii=False))
