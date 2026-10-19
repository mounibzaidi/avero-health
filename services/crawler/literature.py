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
TOOL = "averohealth-bot"
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
_client = httpx.Client(timeout=30, headers={"User-Agent": "AveroHealthBot/0.3 (+guideline provenance)"})


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


def number_forms(phrase: str) -> list[str]:
    """The phrase with its last word singular and plural: a PubMed title phrase matches one form only, and
    "acute coronary syndrome" misses "2023 ESC Guidelines for the management of acute coronary syndromes"."""
    head, _, last = phrase.rpartition(" ")
    if not last.isalpha() or len(last) < 4 or last.isupper() or last.lower().endswith(("ss", "is", "us")):
        return [phrase]
    other = last[:-1] if last.lower().endswith("s") else last + "s"
    return [phrase, f"{head} {other}".strip()]


# Qualifiers that say nothing of the subject: a term sharing only these with the topic is another topic.
_GENERIC = set("acute aigu aigue aigus aigues syndrome syndromes chronic chronique severe grave adult adulte patient patients "
               "management prise charge treatment traitement therapy therapie disease maladie".split())


def _stems(text: str) -> set[str]:
    return {w[:5] for w in re.findall(r"[a-z0-9+]{3,}", fold(text)) if w not in _GENERIC}


def on_topic(term: str, own_names: list[str]) -> bool:
    """A librarian term that names the topic itself, not a neighbour ("antiplatelet therapy", "chest pain" for ACS):
    it shares a word stem with the topic's own names in that language, or it is a subtype abbreviation (NSTEMI)."""
    if re.fullmatch(r"[A-Z][A-Z0-9+\-]{3,11}", term.strip()):
        return True
    return bool(_stems(term) & set().union(*(_stems(n) for n in own_names)))


def usable_term(term: str, french: bool = False) -> bool:
    """A search term from the librarian worth searching: a phrase or a long word in English (a bare "ACS" or "MI" in
    PubMed titles brings everything); in French an abbreviation is kept (matched as a whole word on short titles)."""
    t = term.strip()
    return bool(t) and len(t) <= 80 and (" " in t or len(t) >= (2 if french else 5)) and '"' not in t


def pubmed_term(concepts: list[list[str]]) -> str:
    parts = ["(" + " OR ".join(f'"{f}"[ti]' for p in alts for f in number_forms(p)) + ")" for alts in concepts]
    return " AND ".join(parts) + f" AND {GUIDE_FILTER} AND {SINCE}:3000[dp]"


# ─── PubMed ─────────────────────────────────────────────────────────────────────────────────────


def mesh_headings(names: list[str]) -> list[str]:
    """PubMed's own subject headings (MeSH) for the topic's names: the search finds the topic's guidance by subject,
    whatever words a title uses ("Scorpion Stings" for scorpion envenomation, "Shock" for shock)."""
    out: list[str] = []
    for name in names[:4]:
        for term in (f'"{name}"[mh]', f'"{name}"'):  # the exact heading first, then PubMed's closest one
            res = _ncbi("esearch.fcgi", {"db": "mesh", "term": term, "retmax": 1})["esearchresult"]
            if not res.get("idlist"):
                continue
            rec = _ncbi("esummary.fcgi", {"db": "mesh", "id": res["idlist"][0]})["result"]
            heading = (rec.get(res["idlist"][0], {}).get("ds_meshterms") or [None])[0]
            # a loose match must share a subject word with the name ("Shock" is not "Hyperlactatemia")
            if heading and (term.endswith("[mh]") or on_topic(heading, [name])) and heading not in out:
                out.append(heading)
            break
    return out


def mesh_term(headings: list[str]) -> str:
    """The guidance whose main subject ([majr]) is one of the topic's MeSH headings."""
    named = " OR ".join(f'"{h}"[majr]' for h in headings)
    kind = '(guideline[pt] OR "practice guideline"[pt] OR "consensus development conference"[pt] OR guideline*[ti] OR recommendation*[ti] OR consensus[ti] OR statement[ti])'
    return f"({named}) AND {kind} AND {SINCE}:3000[dp]"


def body_term(concepts: list[list[str]]) -> str:
    """PubMed query for the known bodies' guidance on the topic: the topic named in the title or abstract, in one of
    the bodies' journals or under their corporate author. Finds "Guideline for ... Aortic Disease" for aortic
    dissection, which a title search misses."""
    named = " OR ".join(f'"{f}"[tiab]' for alts in concepts for p in alts for f in number_forms(p) if usable_term(p) or p == alts[0])
    journals = sorted({j for b in _bodies() for j in b.get("journals", [])})
    authors = sorted({a for b in _bodies() for a in b.get("authors", [])})
    source = " OR ".join([*(f'"{j}"[ta]' for j in journals), *(f'"{a}"[cn]' for a in authors)])
    kind = ('(guideline[pt] OR "practice guideline"[pt] OR guideline*[ti] OR recommendation*[ti] OR consensus[ti] '
            'OR statement[ti] OR "position paper"[ti] OR "practice parameter"[ti])')
    return f"({named}) AND ({source}) AND {kind} AND {SINCE}:3000[dp]"


def french_term(phrases: list[str]) -> str | None:
    """PubMed query for French-language guidance on the topic: its French names in the original title ([tt])."""
    alts = list(dict.fromkeys(fold(p) for p in phrases if p and (" " in p.strip() or len(p.strip()) >= 6)))
    if not alts:
        return None
    named = " OR ".join(f'"{a}"[tt]' for a in alts)
    kind = '(recommandation*[tt] OR consensus[tt] OR referentiel*[tt] OR guideline[pt] OR "practice guideline"[pt] OR guideline*[ti] OR recommendation*[ti] OR consensus[ti])'
    return f"({named}) AND french[la] AND {kind} AND {SINCE}:3000[dp]"


def pubmed(term: str) -> list[dict]:
    """The records for a query: newest first and most relevant, so an older reference guideline is not missed."""
    ids: list[str] = []
    for sort, n in (("pub_date", 200), ("relevance", 100)):
        found = _ncbi("esearch.fcgi", {"db": "pubmed", "term": term, "retmax": n, "sort": sort})["esearchresult"]["idlist"]
        ids += [i for i in found if i not in ids]
    return records(ids)


def records(ids: list[str]) -> list[dict]:
    """The PubMed records of these PMIDs, in the search's own shape."""
    out = []
    for k in range(0, len(ids), 200):
        res = _ncbi("esummary.fcgi", {"db": "pubmed", "id": ",".join(ids[k : k + 200])}, post=True)["result"]
        for pmid in res.get("uids", []):
            r = res[pmid]
            title = re.sub(r"\s+", " ", r.get("title", "")).strip().rstrip(".")
            year = int(r["pubdate"][:4]) if r.get("pubdate", "")[:4].isdigit() else None
            ids_ = {a["idtype"]: a["value"] for a in r.get("articleids", [])}
            out.append({
                "pmid": pmid, "title": title, "journal": r.get("source") or "", "year": year,
                "title_year": _title_year(title), "pubtypes": r.get("pubtype", []),
                "authors": [a["name"] for a in r.get("authors", [])], "doi": ids_.get("doi"), "pmc": ids_.get("pmc"),
                "url": f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/", "lang": r.get("lang") or [],
                "corporate": [a["name"] for a in r.get("authors", []) if a.get("authtype") == "CollectiveName"],
            })
    _details(out)
    return out


def _details(recs: list[dict]) -> None:
    """What esummary does not give, from efetch: each record's abstract (for the classifier) and, for a French
    article, its own title (VernacularTitle) in place of the bracketed English translation, kept as title_en."""
    import xml.etree.ElementTree as ET

    by_pmid = {r["pmid"]: r for r in recs}
    ids = list(by_pmid)
    for k in range(0, len(ids), 100):
        params = {"db": "pubmed", "id": ",".join(ids[k : k + 100]), "retmode": "xml", "tool": TOOL}
        if setting("NCBI_EMAIL"):
            params["email"] = setting("NCBI_EMAIL")
        if setting("NCBI_API_KEY"):
            params["api_key"] = setting("NCBI_API_KEY")
        _NCBI.wait()
        try:
            r = _client.post(f"{EUTILS}/efetch.fcgi", data=params)
            r.raise_for_status()
            root = ET.fromstring(r.content)
        except (httpx.HTTPError, ET.ParseError):
            continue  # the English title stays, still classified as a French original (lang)
        for art in root.iter("PubmedArticle"):
            pmid, vern = art.findtext(".//PMID"), art.findtext(".//VernacularTitle")
            rec = by_pmid.get(pmid or "")
            if rec:
                rec["abstract"] = " ".join("".join(a.itertext()) for a in art.iter("AbstractText"))[:1500] or None
            if rec and vern and vern.strip() and "fre" in rec["lang"] and TRANSLATED.match(rec["title"]):
                rec["title_en"] = rec["title"]
                rec["title"] = re.sub(r"\s+", " ", vern).strip().rstrip(".")
                rec["title_year"] = rec["title_year"] or _title_year(rec["title"])


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
    r"systematic review|meta-analysis|trends?|barriers|evaluating|assessment of|pertinent points|large language models?|artificial intelligence|chatgpt|machine learning|reply|dissent|neglect\w*|impact of|response to|in response|rebuttal|missing from|beyond the|note de cadrage|"
    r"critical appraisal|type of evidence|questions and answers|companion document|highlights?|covid-19|sars-cov-2|pandemic|temporary|"
    r"pilot study|methodological quality|versus|vs\.?|how do they help|application of|what'?s new|known unknowns|unpacking|commandments|"
    r"for the hospitalist|key priorities|comments?|appraisal|a view from|effect of|brochure|diaporama|slides?|comparative|"
    r"(might|does|do|should) (it|they) fit|fit in(to)? (the )?guidelines?|evolution of|pearls|what are the latest|latest recommendations)\b|^\W*(summary of|evaluation of|a review of|an overview of)\b|"
    # "... in the 2025 ACC/AHA Guideline", "Appraisal of the 2020 ESC Guidelines": about a guideline, not the guideline
    r"\b(the|of|on|to|in|from)\s+(19|20)\d{2}\s+[\w/&.,' -]{0,80}?\bguidelines?\b", re.I)
# Animal medicine: a veterinary guideline is not one for patients ("RECOVER" is the veterinary CPR initiative).
VETERINARY = re.compile(r"\b(veterinary|canine|feline|dogs?|cats?|equine|bovine|RECOVER guidelines)\b", re.I)
VET_JOURNALS = {"J Vet Emerg Crit Care (San Antonio)", "Vet Clin North Am Small Anim Pract", "J Am Vet Med Assoc", "Front Vet Sci"}
# PubMed puts a translated title in square brackets: a translation or a reprint, not the original guideline.
TRANSLATED = re.compile(r"^\s*\[.*\]\W*$", re.S)
GUIDE_TITLE = re.compile(
    r"\b(guidelines?|recommendations?|recommandations?)\s+(for|on|pour|de|sur|du|des|in the)\b|clinical practice guideline|\bstandards of (medical )?care\b|"
    r"\b(good|best) practice recommendations?\b|\brecommendations? (of|for) (good|best) practice\b|"
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
    if VETERINARY.search(title) or rec.get("journal") in VET_JOURNALS:
        return "article", "médecine vétérinaire"
    if TRANSLATED.match(title) and "fre" in (rec.get("lang") or []):
        title = title.strip(" []")  # a French original whose French title could not be read: its translation is classified
    elif TRANSLATED.match(title):
        return "article", "traduction (titre entre crochets dans PubMed) : l'original est cherché à part"
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


_LEAD = re.compile(r"^\W*(?:the\s+)?(?:part\s+\d+\W+)?(?:(?:19|20)\d{2}\W+)?(?:(?:joint|official|updated|international|focused)\s+)*"
                   r"(?:update\W+)?(?:(?:19|20)\d{2}\W+)?", re.I)


def _from_body(rec: dict, b: dict) -> bool:
    """Does a PubMed record whose title names a body come from it, rather than speak about its guideline? Its
    corporate author, or a title that opens with the body ("2022 ACC/AHA Guideline...", "Joint ERS/... guidelines",
    "Part 10: ...: 2025 American Heart Association...") or says it is the body's ("...a scientific statement from the
    American Heart Association", "...guidelines (JCS 2011)"). The journal alone is not enough: "The new 2022 ESC
    Guidelines... and their impact" is in an ESC journal and is about the guideline."""
    if any(a in name for a in b.get("authors", []) for name in rec.get("authors", [])):
        return True
    title = rec["title"]
    for part in re.split(r":\s+|\s+[-–—]\s+", title):
        rest = part[_LEAD.match(part).end():]
        if any(p.match(rest) for p in b["_title"]):
            return True
    for p in b["_title"]:
        if re.search(rf"\b(?:from|of|by|du|de la|de l'|des)\s+(?:the\s+)?(?:{p.pattern})", title, re.I):
            return True
        if re.search(rf"\((?:{p.pattern})[\w\s/-]{{0,12}}\)", title):
            return True
    return False


def attribution(rec: dict) -> tuple[dict | None, dict | None]:
    """(issuing body, body only spoken about). A record that names a body in its title without coming from it is a
    paper about that body's guideline (appraisal, adherence, implementation...), whatever its words."""
    bodies = _bodies()
    named = next((b for b in bodies if any(p.search(rec["title"]) for p in b["_title"])), None)
    if named and (not rec.get("pmid") or _from_body(rec, named)):
        return named, None
    by_author = next((b for b in _bodies() if any(a in n for a in b.get("authors", []) for n in rec.get("corporate") or rec.get("authors") or [])), None)
    if named and not by_author:
        return None, named
    return by_author, None


def issuing_body(rec: dict, by_title: bool = True) -> dict | None:
    """The body that issued it: named in the title, else a collective author. Never the journal."""
    bodies = _bodies()
    for b in bodies if by_title else []:
        if any(p.search(rec["title"]) for p in b["_title"]):
            return b
    for b in bodies:
        if any(a in name for a in b.get("authors", []) for name in rec.get("authors", [])):
            return b
    return None  # never from the journal: a journal publishes papers about guidelines too


# ─── Families, versions, ranking ────────────────────────────────────────────────────────────────

_BOILER = set("""guideline guidelines recommendation recommendations recommandations recommandation consensus statement position paper scientific
document expert clinical practice report joint committee task force for the of and in on a an with to by from developed collaboration
management diagnosis evaluation treatment prevention detection care adults adult patients update focused international european
american society association college organisation organization working group writing members update
prise charge des les aux une par pour sur dans chez avec sans dehors patient patients adultes enfant enfants traitement diagnostic
bonne bonnes pratique pratiques guide parcours soins phase urgence urgences service services societe francaise version courte longue""".split())


def singular(word: str) -> str:
    """"syndromes" -> "syndrome", so two titles that differ by a plural are one subject."""
    return word[:-1] if len(word) > 4 and word.endswith("s") and not word.endswith(("ss", "is", "us")) else word


def topic_key(title: str) -> frozenset[str]:
    """The title's subject words: no year, body, boilerplate or anything after 'developed in collaboration with'."""
    t = re.split(r"\b(developed in collaboration|in collaboration with|a report of|endorsed by)\b", fold(title))[0]
    t = re.sub(r"\([^)]*\)", " ", t)
    t = re.sub(r"[\w-]+(/[\w-]+)+", " ", t)  # co-author chains: "aha/acc/accp/chest/..."
    words = re.findall(r"[a-z][a-z-]{2,}", t)
    acronyms = {fold(p.pattern).strip("\\b") for b in _bodies() for p in b["_title"]}
    return frozenset(singular(w) for w in words if w not in _BOILER and w not in acronyms and not re.fullmatch(r"(19|20)\d\d", w))


def _same(a: frozenset, b: frozenset, threshold: float) -> bool:
    return bool(a and b) and len(a & b) / len(a | b) >= threshold


def families(records: list[dict]) -> list[dict]:
    """Guidance records grouped by body and topic: the newest version first, older ones after it; the copies of one
    version in several journals are one entry ("aussi publié dans")."""
    groups: list[dict] = []
    for r in sorted(records, key=lambda r: -(r["version_year"] or 0)):
        key = topic_key(r["title"])
        # same body, same kind of document, same subject; or, for a guideline, a newer one of the body whose subject
        # covers this one's (ESC "acute coronary syndromes" 2023 replaces ESC "NSTE acute coronary syndromes" 2020)
        g = next((g for g in groups if g["body"] == r["body"] and r["body"] and g["kind"] == r["kind"]
                  and (_same(g["key"], key, 0.5) or (r["kind"] == "guideline" and g["key"] and g["key"] <= key))), None)
        if g is None:
            groups.append({"body": r["body"], "kind": r["kind"], "key": key, "versions": [r]})
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
            # one document in two journals: the entry kept is the reference if either copy was named one
            kept = r if r in g["versions"] else twin
            other = twin if kept is r else r
            if other.get("reference") and not kept.get("reference"):
                kept["reference"], kept["why"] = other["reference"], other["why"]
        else:
            g["versions"].append(r)
    for g in groups:
        for i, v in enumerate(g["versions"]):
            v["version"] = "actuelle" if i == 0 else "antérieure"
    return groups


def _title_words(title: str) -> set[str]:
    return {singular(w) for w in re.findall(r"[a-z0-9]{3,}", fold(title))}


def chapters(fams: list[dict]) -> list[dict]:
    """A long guideline published as one article per question ("Quel parcours de soins... ?", SPLF 2021): the
    question-titled articles of the same body, journal and year fold into the guideline as its chapters."""
    heads = [g["versions"][0] for g in fams]
    out = []
    for g in fams:
        cur = g["versions"][0]
        main = None
        question = lambda t: t.strip(" .[]").endswith("?")  # noqa: E731
        if question(cur["title"]) and cur["body"]:
            main = next((h for h in heads if h is not cur and h["body"] == cur["body"] and h["journal"] == cur["journal"]
                         and h["version_year"] == cur["version_year"] and not question(h["title"])), None)
        if main is None:
            out.append(g)
        else:
            main.setdefault("chapters", []).append({"title": cur["title"], "url": cur["url"]})
    return out


def co_published(fams: list[dict]) -> list[dict]:
    """One text on several bodies' own pages (HAS, SFMU and SFAR list the same 2007 text): one entry, the others in
    "also_in". Only for documents found on listings, whose shorter title is (almost) all in the other, and years close."""
    out: list[dict] = []
    for g in sorted(fams, key=lambda g: (g["versions"][0].get("listing_source") != "has", -(g["versions"][0]["version_year"] or 0))):
        cur = g["versions"][0]
        twin = None
        if cur.get("on_listing"):
            a = _title_words(cur["title"])
            for h in out:
                o = h["versions"][0]
                b = _title_words(o["title"])
                if (o.get("on_listing") and o["body"] != cur["body"] and a and b and len(a & b) / min(len(a), len(b)) >= 0.9
                        and (not o["version_year"] or not cur["version_year"] or abs(o["version_year"] - cur["version_year"]) <= 6)):
                    twin = o
                    break
        if twin is None:
            out.append(g)
        else:
            twin.setdefault("also_in", []).append({"journal": cur["journal"], "url": cur["url"], "doi": None})
    return out


def _key(r: dict) -> str:
    """One document, whatever query found it: its DOI, else PMID, else address (classifier.doc_key)."""
    if r.get("doi"):
        return "doi:" + r["doi"].lower()
    if r.get("pmid"):
        return "pmid:" + r["pmid"]
    return "url:" + r["url"]


def _body_named(name: str) -> dict | None:
    """A body from a name the classifier gave: the registry's, else one made from the name (its region guessed from
    the name only for France and Algeria)."""
    if not name or not name.strip():
        return None
    reg = _proposal_body({"body": name})
    if reg:
        return reg
    folded = fold(name)
    region = "fr" if re.search(r"\bfran[cç]ais|\bfrance\b|\bfrench\b|langue francaise", folded) else "dz" if re.search(r"alg[eé]ri", folded) else None
    return {"id": "x-" + re.sub(r"[^a-z0-9]+", "-", folded).strip("-")[:40], "name": name.strip()[:60], "region": region}


def body_of(r: dict, c: dict | None, by_id: dict) -> dict | None:
    """The issuing body, never from the journal: the body's own catalogue or site, its corporate author, a title that
    names it as issuer, then the classifier's issuing_body."""
    if r.get("body_hint") and by_id.get(r["body_hint"]):
        return by_id[r["body_hint"]]
    for b in _bodies():
        if any(a in name for a in b.get("authors", []) for name in r.get("corporate") or r.get("authors") or []):
            return b
    named = next((b for b in _bodies() if any(p.search(r["title"]) for p in b["_title"])), None)
    if named and (not r.get("pmid") or _from_body(r, named)):
        return named
    if c and c.get("issuing_body"):
        return _body_named(c["issuing_body"])
    if r.get("body_name_hint"):
        return _body_named(r["body_name_hint"])
    return None


_FR_WORDS = re.compile(r"\b(de|des|du|la|le|les|et|pour|chez|prise en charge|recommandations?|conduite a tenir)\b")


def language_of(r: dict) -> str:
    """fr or en: PubMed's language, else the title's words."""
    if "fre" in (r.get("lang") or []):
        return "fr"
    if r.get("lang"):
        return "en" if "eng" in r["lang"] else r["lang"][0][:2]
    return "fr" if len(_FR_WORDS.findall(fold(r["title"]))) >= 2 else "en"


SECTION_TITLES = {
    "international": "Références internationales", "france": "Sociétés savantes et agences françaises", "algerie": "Algérie",
    "syntheses_fr": "Synthèses en français", "autres": "Autres recommandations nationales", "articles": "Articles",
}
ARTICLE_GROUPS = {"commentary": "commentaires", "correction": "corrections", "research": "études", "derivative": "documents dérivés",
                  "methodology": "méthodologie", "patient_material": "documents patients", "expired": "documents expirés"}


def section_of(head: dict) -> str:
    """The results page section of a primary guidance (family head)."""
    region = head.get("region")
    if region == "fr":
        return "france"
    if region == "dz":
        return "algerie"
    if region in ("eu", "na", "intl") or (head.get("reference") and head["reference"].get("tier") == 1):
        return "international"
    return "autres"


def sections(fams: list[dict], articles: list[dict], body_status: list[dict]) -> list[dict]:
    """The results page, top to bottom: international references, French bodies (always, with each French body's
    crawl status when empty), Algeria, French summaries, other countries, then the articles by label."""
    out = {k: [] for k in SECTION_TITLES}
    for f in fams:
        out[section_of(f["versions"][0])].append(f)
    groups: dict[str, list] = {}
    for a in articles:
        if a.get("label") == "derivative" and a.get("language") == "fr":
            out["syntheses_fr"].append({"versions": [a]})
        else:
            groups.setdefault(ARTICLE_GROUPS.get(a.get("label") or "", "hors sujet" if a.get("relevance") == "off_topic" else "autres"), []).append(a)
    region_of = lambda name: (_body_named(name) or {}).get("region")  # noqa: E731
    return [
        {"id": "international", "title": SECTION_TITLES["international"], "families": out["international"]},
        {"id": "france", "title": SECTION_TITLES["france"], "families": out["france"], "always": True,
         "bodies": [b for b in body_status if region_of(b["body"]) == "fr"]},
        {"id": "algerie", "title": SECTION_TITLES["algerie"], "families": out["algerie"], "always": True,
         "bodies": [b for b in body_status if region_of(b["body"]) == "dz"]},
        {"id": "syntheses_fr", "title": SECTION_TITLES["syntheses_fr"], "families": out["syntheses_fr"]},
        {"id": "autres", "title": SECTION_TITLES["autres"], "families": out["autres"], "collapsed": True},
        {"id": "articles", "title": SECTION_TITLES["articles"], "collapsed": True, "groups": [{"label": k, "items": v} for k, v in groups.items()]},
    ]


KIND_RANK = {"guideline": 0, "consensus": 1, "article": 2}
THIS_YEAR = time.localtime().tm_year
STALE_YEARS = 10  # an older guideline (or one with no date) comes after the recent ones of its tier
STALE_YEARS_LOCAL = 15  # French and Algerian bodies revise less often; their text stays the local reference longer
# The reference countries' bodies first, then the international references, then other countries' national bodies.
REGION_RANK = {"dz": 0, "fr": 0, "eu": 1, "na": 1, "intl": 1, "other": 2}
FOCUS = 0.6  # share of the title's subject words that are the topic's: the topic is what the guideline is about


def rank_key(r: dict) -> tuple:
    """A current reference named by the librarian and verified first; then official guideline > other guideline >
    consensus > article; within each, a recent one (STALE_YEARS) first; then a guideline whose main subject is the topic; then by region (French/Algerian, international, other countries);
    then the most recent; then a title that names the topic over a match found elsewhere."""
    window = STALE_YEARS_LOCAL if r.get("region") in ("dz", "fr") else STALE_YEARS
    stale = not r["version_year"] or THIS_YEAR - r["version_year"] > window
    return (0 if r.get("reference") else 1, r["reference"]["tier"] if r.get("reference") else 9, 1 if r.get("relevance") == "adjacent" else 0,
            KIND_RANK[r["kind"]], 0 if r.get("official") else 1, int(stale),
            0 if r.get("focus", 0) >= FOCUS else 1, REGION_RANK.get(r.get("region"), 2), -(r["version_year"] or 0),
            0 if r.get("title_match") else 1)


def _librarian(out: dict, records: list[dict]) -> dict:
    """The librarian's verified documents marked as references in `records` (added when the PubMed query missed
    them); a site-only document (HAS, SFMU...) is verified on the bodies' own catalogues. Returns what the dashboard
    shows of its answer."""
    import librarian

    by_pmid = {r["pmid"]: r for r in records if r.get("pmid")}
    unverified = []
    for p in out.get("guidance", []):
        target = None
        if p.get("verified"):
            target = by_pmid.get(p["pmid"])
            if target is None:
                target = {k: v for k, v in p["record"].items()}
                records.append(target)
                by_pmid[target["pmid"]] = target
        else:  # matched against the found records once they have a body and a year (_resolve_proposals)
            unverified.append({**{k: p.get(k) for k in ("body", "body_full_name", "co_bodies", "title", "year", "doc_type", "tier", "role",
                                                       "url_hint", "verification_queries", "confidence", "notes", "check", "supersedes")},
                               "doi": p.get("llm_doi"), "pmid": p.get("llm_pmid")})
            continue
        tier = p.get("tier") if p.get("tier") in (1, 2, 3) else 3
        target["reference"] = {"role": p.get("role") or "core", "tier": tier, "doc_type": p.get("doc_type"),
                               "supersedes": p.get("supersedes") or [], "notes": p.get("notes"), "body": p.get("body")}
        target["why"] = "référence selon le bibliothécaire, vérifiée " + ("sur PubMed" if target.get("pmid") else "sur le catalogue de l'organisme")
    bodies = [{k: b.get(k) for k in ("body", "body_full_name", "country_or_region", "status", "adopts", "discovered", "confidence", "notes")}
              for b in out.get("bodies", [])]
    return {"model": out.get("model"), "asked_at": out.get("asked_at"), "error": out.get("error"), "scope_note": out.get("scope_note"),
            "usage": out.get("usage"), "search_terms": out.get("search_terms", {}), "bodies": bodies, "unverified": unverified}


_CHAIN = re.compile(r"^\W*(?:(?:19|20)\d{2}\W+)?[a-z0-9]+(?:/[a-z0-9]+)+\b", re.I)


def proposal_words(title: str) -> set[str]:
    """A title for fuzzy matching: lowercase, no accents, punctuation or year, and no leading run of body acronyms
    ("2022 ACC/AHA/AATS/ACR/... Guideline" -> "guideline ...")."""
    t = _CHAIN.sub(" ", fold(title))
    return {singular(w) for w in re.findall(r"[a-z0-9]{2,}", re.sub(r"\b(?:19|20)\d{2}\b", " ", t))
            if w not in {"the", "of", "and", "for", "in", "on", "de", "du", "des", "la", "le", "les", "et", "a", "an"}}


def title_similarity(a: str, b: str) -> float:
    """Token-set similarity: the share of the shorter title's words found in the other."""
    wa, wb = proposal_words(a), proposal_words(b)
    return len(wa & wb) / min(len(wa), len(wb)) if wa and wb else 0.0


def _proposal_body(p: dict) -> dict | None:
    """The registry body a proposal names ("ACC/AHA", "Société Française de Cardiologie"...)."""
    text = f"{p.get('body') or ''} {p.get('body_full_name') or ''}"
    return next((b for b in _bodies() if any(pat.search(text) for pat in b["_title"]) or fold(b["name"]) == fold(p.get("body") or "")), None)


def _resolve_proposals(shelf: dict, records: list[dict]) -> None:
    """The librarian's unconfirmed proposals matched against the found records, in this order: DOI, PMID, then same
    body + year within one + title similarity >= 0.8. Failing that, a later guideline of the same body on the topic
    resolves it as "found, newer version". Only what matches nothing stays "non confirmé"."""
    still = []
    for p in shelf["unverified"]:
        body = _proposal_body(p)
        same_body = lambda r: bool(r.get("body")) and (r["body"] == body["id"] if body else fold(p.get("body") or "-") in fold(r.get("body_name") or ""))  # noqa: E731
        doi, pmid = (p.get("doi") or "").lower().strip(), str(p.get("pmid") or "").strip()
        found = (next((r for r in records if doi and (r.get("doi") or "").lower() == doi), None)
                 or next((r for r in records if pmid and r.get("pmid") == pmid), None)
                 or max((r for r in records if r["kind"] != "article" and same_body(r) and p.get("year") and r.get("version_year")
                         and abs(r["version_year"] - p["year"]) <= 1 and title_similarity(p["title"], r["title"]) >= 0.8),
                        key=lambda r: title_similarity(p["title"], r["title"]), default=None))
        note = None
        if found is None and p.get("year"):
            newer = [r for r in records if r["kind"] == "guideline" and same_body(r) and (r.get("version_year") or 0) > p["year"]
                     and r.get("focus", 0) >= FOCUS]
            if newer:
                found = max(newer, key=lambda r: r["version_year"])
                note = f"version plus récente que la proposition du bibliothécaire ({p['year']})"
        if found is None:
            still.append(p)
            continue
        if not found.get("reference"):
            tier = p.get("tier") if p.get("tier") in (1, 2, 3) else 3
            found["reference"] = {"role": p.get("role") or "core", "tier": tier, "doc_type": p.get("doc_type"),
                                  "supersedes": p.get("supersedes") or [], "notes": note or p.get("notes"), "body": p.get("body")}
            found["why"] = "référence selon le bibliothécaire, " + ("version plus récente trouvée" if note else "trouvée dans les résultats")
    shelf["unverified"] = still


def _refresh_references(records: list[dict]) -> None:
    """The librarian's knowledge stops at its training: a reference it named is moved to a newer guideline of the same
    body on the topic when the search found one, and an old one (STALE_YEARS, longer for French bodies) is unpinned."""
    for ref in [r for r in records if r.get("reference")]:
        newer = [r for r in records if r is not ref and r["body"] and r["body"] == ref["body"] and r["kind"] == "guideline"
                 and not r.get("reference") and (r["version_year"] or 0) > (ref["version_year"] or 0) and r.get("focus", 0) >= FOCUS]
        if newer:
            best = max(newer, key=lambda r: r["version_year"] or 0)
            best["reference"] = {**ref["reference"], "notes": f"plus récente que « {ref['title'][:80]} » ({ref['version_year']}), proposée par le bibliothécaire"}
            best["why"] = "version plus récente du même organisme que la référence proposée par le bibliothécaire"
            ref.pop("reference")
            continue
        window = STALE_YEARS_LOCAL if ref.get("region") in ("dz", "fr") else STALE_YEARS
        if not ref["version_year"] or THIS_YEAR - ref["version_year"] > window:
            ref.pop("reference")
            ref["why"] = "proposée par le bibliothécaire mais ancienne : non épinglée"


def _superseded(fams: list[dict]) -> None:
    """A family whose current version a reference of the SAME body says it replaced points to that reference; a
    body's guideline never supersedes another body's."""
    import librarian

    refs = [g["versions"][0] for g in fams if g["versions"][0].get("reference")]
    for g in fams:
        cur = g["versions"][0]
        if cur.get("reference"):
            g.pop("newer_elsewhere", None)  # a current reference is not "outdated" by another body's reference
            continue
        for ref in refs:
            if ref["body"] and ref["body"] == cur["body"] and any(
                    librarian.same_title(s.get("title") or "", cur["title"]) and (not s.get("year") or s["year"] == cur["version_year"])
                    for s in ref["reference"]["supersedes"]):
                g["newer_elsewhere"] = {"body": ref["body_name"], "year": ref["version_year"], "title": ref["title"]}
                break


def search(query: str | None = None, topic: dict | None = None, with_listings: bool = True, with_librarian: bool = True,
           with_classifier: bool = True, with_bodies: bool = True, ai: bool = False) -> dict:
    """The topic's guidance. The paid steps (librarian, classifier) run only with `ai`; without it their saved
    answers are reused for free and the rest is classified by rules."""
    concepts = concepts_for(query, topic)
    if not concepts:
        return {"query": query, "concepts": [], "families": [], "articles": [], "sources": [], "error": "Aucun terme de recherche reconnu"}
    answer = None
    if topic and with_librarian:
        import librarian

        try:
            answer = librarian.run(topic, ask=ai)
        except Exception as exc:  # the search never depends on it
            answer = {"error": f"Bibliothécaire indisponible : {type(exc).__name__} {exc}"[:400]}
    if answer is not None and topic:
        # its search terms widen the search: English ones in the PubMed query, French ones on the French catalogues
        terms = answer.get("search_terms") or {}
        own_en = [*concepts[0], *(topic.get("synonyms") or [])]
        own_fr = [topic["fr"], *(topic.get("keywords_fr") or []), *(topic.get("synonyms") or [])]
        concepts = [[*concepts[0], *(t for t in terms.get("en", []) if usable_term(t) and on_topic(t, own_en) and t not in concepts[0])]]
        topic = {**topic, "keywords_fr": [*(topic.get("keywords_fr") or []),
                                          *(t for t in terms.get("fr", []) if usable_term(t, french=True) and on_topic(t, own_fr))]}
    term = pubmed_term(concepts)
    records = pubmed(term)
    seen = {r["pmid"] for r in records}
    if topic:  # by subject (MeSH), independent of how the topic is worded
        headings = mesh_headings([p for p in concepts[0] if usable_term(p)])
        if headings:
            ids = [i for i in _ncbi("esearch.fcgi", {"db": "pubmed", "term": mesh_term(headings), "retmax": 150})["esearchresult"]["idlist"] if i not in seen]
            records += globals()["records"](ids) if ids else []
            seen |= set(ids)
    anchored = body_term(concepts)  # the known bodies' guidance on the topic, whatever words its title uses
    ids = [i for i in _ncbi("esearch.fcgi", {"db": "pubmed", "term": anchored, "retmax": 200}, post=True)["esearchresult"]["idlist"] if i not in seen]
    # found through the abstract: kept only when the title names the topic too (a subject word of its names)
    own = [p for alts in concepts for p in alts] + ([(topic or {}).get("fr") or ""] + list((topic or {}).get("synonyms") or []))
    records += [r for r in (globals()["records"](ids) if ids else []) if on_topic(r["title"], own)]
    if topic:  # French-language guidance, found by its French title (its English title may name the topic otherwise)
        fr_term = french_term([topic["fr"], *(topic.get("keywords_fr") or []), *(topic.get("synonyms") or [])])
        if fr_term:
            seen = {r["pmid"] for r in records}
            ids = [i for i in _ncbi("esearch.fcgi", {"db": "pubmed", "term": fr_term, "retmax": 100})["esearchresult"]["idlist"] if i not in seen]
            records += globals()["records"](ids) if ids else []
    listing_status: list[dict] = []
    if with_listings:
        import listings

        found, listing_status = listings.search(query, topic, fold, _glossary)
        records += found
    shelf = None
    if answer is not None:
        try:
            shelf = _librarian(answer, records)
        except Exception as exc:  # the search never depends on it
            shelf = {"error": f"Bibliothécaire indisponible : {type(exc).__name__} {exc}"[:400], "unverified": [], "bodies": []}
    crawl_log: list[dict] = []
    if topic and with_bodies and answer and answer.get("bodies"):
        import bodies as bodies_mod

        try:  # every body the librarian named, crawled: its site or catalogue, not its guess
            found, crawl_log = bodies_mod.crawl(answer["bodies"], topic, records, listing_status)
            records += found
        except Exception as exc:
            crawl_log = [{"body": "*", "error": f"{type(exc).__name__}: {exc}"[:200]}]
    by_id = {b["id"]: b for b in _bodies()}
    records = [r for r in records if r["title"].strip(" .[]")]  # PubMed records without a title say nothing
    seen_keys: set[str] = set()
    records = [r for r in records if not (_key(r) in seen_keys or seen_keys.add(_key(r)))]  # one record per document
    # the topic's own excludes (topics.yaml), on PubMed and catalogue records alike: a title naming one is another
    # topic's guideline (a reference the librarian verified stays)
    excluded = [fold(x) for x in (topic or {}).get("exclude") or []]
    if excluded:
        records = [r for r in records if r.get("reference") or not any(x in fold(r["title"]) for x in excluded)]
    # a French title is about the topic when it names it in French: the topic's French names count too
    french_words = {singular(w) for p in [(topic or {}).get("fr") or "", *((topic or {}).get("synonyms") or []), *((topic or {}).get("keywords_fr") or [])]
                    for w in re.findall(r"[a-z][a-z-]{2,}", fold(p))}
    labels: dict[str, dict] = {}
    classifier_error = None
    if topic and with_classifier:
        import classifier

        classifier.ERRORS.clear()
        try:  # every record labelled by the classifier before anything is shown; its own rules only where it is silent
            labels = classifier.classify(records, topic, ask=ai)
        except Exception as exc:
            labels, classifier.ERRORS[:] = {}, [f"{type(exc).__name__}: {exc}"[:200]]
        unlabelled = sum(1 for r in records if _key(r) not in labels)
        if unlabelled and ai:
            classifier_error = (f"Classifieur : {unlabelled} document(s) sur {len(records)} non classés, classés par règles"
                                + (f" ({classifier.ERRORS[0]})" if classifier.ERRORS else ""))
    for r in records:
        c = labels.get(_key(r))
        about = None
        if c:
            r["label"], r["relevance"], r["derived_from"] = c["label"], c.get("relevance"), c.get("derived_from")
            r["why"] = c.get("reason") or c["label"]
            primary = c["label"] == "primary_guidance" and c.get("relevance") != "off_topic"
            r["kind"] = "guideline" if primary or r.get("reference") else "article"
        else:
            kind, why = classify(r, on_listing=bool(r.get("on_listing")))
            r["kind"], r["why"] = ("guideline", r["why"]) if r.get("reference") else (kind, why)
            r["label"], r["relevance"], r["derived_from"] = ("primary_guidance" if r["kind"] != "article" else None), None, None
        b = body_of(r, c, by_id)
        if not c and not b and r["kind"] != "article":
            _, about = attribution(r)
            if about and not r.get("reference"):
                r["kind"], r["label"] = "article", "derivative"
                r["why"] = f"article sur une recommandation de {about['name']}, pas publié par cet organisme"
        r["body"], r["body_name"] = (b["id"], b["name"]) if b else (None, None)
        r["region"] = b["region"] if b else None
        edition = c.get("guideline_edition_year") if c else None
        r["version_year"] = (edition if isinstance(edition, int) and 1950 < edition < 2100 else None) or r["title_year"] or r["year"]
        r["language"] = language_of(r)
        folded = fold(r["title"])
        r["title_match"] = all(any(fold(p) in folded for p in alts) for alts in concepts)
        # official: primary guidance whose issuing body is known
        r["official"] = r["kind"] != "article" and r["body"] is not None
        key, wanted = topic_key(r["title"]), {singular(w) for alts in concepts for p in alts for w in fold(p).split()} | french_words
        r["focus"] = round(len(key & wanted) / len(key), 2) if key else 0
    if shelf and shelf.get("unverified"):
        _resolve_proposals(shelf, records)
    _refresh_references(records)
    guidance = [r for r in records if r["kind"] != "article"]
    extra = europe_pmc([r["pmid"] for r in guidance if r.get("pmid")])
    for r in guidance:
        e = extra.get(r["pmid"], {})
        r["doi"] = r.get("doi") or e.get("doi")
        if r.get("pmid"):
            r["pdf_url"], r["open_access"] = e.get("pdf_url"), e.get("open_access", False)
    fams = co_published(chapters(families(guidance)))
    if shelf:
        _superseded(fams)
    fams.sort(key=lambda g: rank_key(g["versions"][0]))
    articles = sorted((r for r in records if r["kind"] == "article"), key=rank_key)
    body_status = []
    if crawl_log and "body" in crawl_log[0] and crawl_log[0]["body"] != "*":
        import bodies as bodies_mod

        body_status = [bodies_mod.status_of(log, records) for log in crawl_log]
        if shelf:
            shelf["bodies"] = [b for b in body_status if not b["discovered"] or b["found"]]  # a discovered body once it has a document
    fams_out = [{k: v for k, v in g.items() if k not in ("key", "kind")} for g in fams]
    return {"query": query, "topic": topic["id"] if topic else None, "concepts": concepts, "term": term, "librarian": shelf,
            "sections": sections(fams_out, articles, body_status), "crawl_log": crawl_log, "classifier_error": classifier_error,
            "families": fams_out, "articles": articles,
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
    ap.add_argument("--ai", action="store_true", help="run the paid steps (librarian, classifier) where nothing is saved yet")
    args = ap.parse_args()
    t = None
    if args.topic:
        from topics import load_topics

        t = next((x for x in load_topics()[0] if x["id"] == args.topic), None)
        if not t:
            sys.exit(f"thème inconnu : {args.topic}")
    print(json.dumps(search(args.query, t, ai=args.ai), ensure_ascii=False))
