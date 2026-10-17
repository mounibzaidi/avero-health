"""The guideline librarian: an LLM maps who publishes on a topic and what; PubMed and the bodies' catalogues decide
what exists.

    python librarian.py --topic acs [--refresh]      # JSON on stdout

The model (OpenRouter, FACTORY_MODEL then FACTORY_FALLBACK_MODELS from .env.local) answers the librarian prompt
below (v2: every listed body checked, other bodies discovered, search terms per language, verification queries).
Its answer is a proposal only:
- each guidance document is looked up on PubMed by its PMID, its DOI, then its title and year; a site-only document
  (HAS, SFMU...) is matched later on the bodies' own catalogues by literature.py. The identifiers shown are always
  PubMed's or the catalogue's, never the model's;
- its search terms widen the search itself (literature.py), they decide nothing.
Inputs come from shared/librarian.yaml. The answer is cached a week per topic in downloads/librarian/.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import yaml

import literature as L

HERE = Path(__file__).resolve().parent
CONFIG = L.SHARED / "librarian.yaml"
CACHE = HERE / "downloads" / "librarian"
FRESH = timedelta(days=7)
OPENROUTER = "https://openrouter.ai/api/v1/chat/completions"
TIMEOUT_S = 170  # the v2 answer is long; the API gives the whole first search 420 s
MATCH = 0.85  # share of the shorter title's words found in the other: same document
VERSION = 3  # prompt version: a cached answer of another version is asked again

SYSTEM = """You are a clinical guidelines librarian specialised in francophone and
international medicine. Your job is to map every body that issues guidance on
a medical topic, identify their current documents, and produce search targets
so each item can be verified and retrieved afterwards. You do not need to be
right about everything; you need to be honest about what you are unsure of.

DEFINITIONS

A GUIDANCE DOCUMENT is an official document issued by a body in its own name:
guideline, recommandation de bonnes pratiques, recommandations formalisées
d'experts (RFE), consensus d'experts, conférence de consensus, position
statement, fiche mémo, guide du parcours de soins, protocole national.

NEVER list as guidance documents:
- summaries, executive summaries published separately, "highlights",
  "what's new", "l'essentiel", "ce qui change"
- critical appraisals, commentaries, editorials, letters, corrections
- Q&A or companion documents, pocket guides, slide sets, congress sessions
- translations or reprints of another body's guideline
- temporary or pandemic-era guidance that has expired
- papers ABOUT a guideline written by other authors

BODIES

A body can be: an international society (ESC, ACC/AHA), a national health
agency (HAS, ANSM, NICE), a national learned society (SFC, SFMU, SFAR, SRLF,
SPILF, SPLF), a subspecialty group or working group of a society (e.g. a
working group within SFC), a general practice college (CNGE, NHG), a
ministry or public health institute, or a regional/network body.

RULES

1. CHECK EVERY LISTED BODY. For each one, state whether it has its own
   document on this topic, adopts another body's guideline, has none, or is
   unknown.

2. DISCOVER OTHER BODIES. After the listed bodies, actively look for other
   bodies that publish on this topic, especially:
   - learned societies of the reference countries in every specialty that
     touches the topic (cardiology, emergency medicine, anaesthesia,
     intensive care, general practice, pharmacy, nursing, imaging...)
   - joint documents between societies (e.g. SFAR/SFC, SFAR/SFMU)
   - subspecialty working groups inside larger societies
   Mark these with "discovered": true. They are hypotheses to be verified,
   so only include a body if you have a concrete reason to believe it
   publishes on this topic.

3. INCLUDE OLD AND NARROW DOCUMENTS from learned societies of the reference
   countries, even if older than the international reference or limited to
   one aspect (prehospital care, analgesia, perioperative care, follow-up).
   Mark narrow ones "role": "adjacent". Always give the exact year.

4. CURRENT VERSION ONLY per body and topic. If a body merged or renamed
   documents, list the current one and record the previous ones in
   "supersedes". Supersession only ever applies within the same body.
   A guideline from one body never supersedes a guideline from another.

5. ADOPTION. If a body applies or endorses another body's guideline instead
   of writing its own, set its status to "adopts_other" and fill "adopts".
   Do not invent a document for it.

6. IDENTIFIERS. Only give a DOI, PMID or website domain if you are confident
   it is exact. Otherwise null. A wrong identifier is worse than a missing
   one. Never invent titles.

7. SEARCH TERMS. Give every synonym and spelling variant used in each
   reference language, including abbreviations. Francophone sources often
   alternate forms (e.g. "syndrome coronaire aigu" and "syndrome coronarien
   aigu", "SCA", "SCA ST+", "IDM"). Missing a variant means missing documents.

8. VERIFICATION QUERIES. For every guidance document, give 1 to 3 queries
   that would find it: a PubMed query for indexed documents, and a
   site-restricted web query (site:domain "keywords" filetype:pdf) for
   documents hosted on a society or agency website.

9. TIERS, relative to the reference countries given in the input:
   - tier 1: international reference guidelines the reference countries
     follow in practice
   - tier 2: agencies and learned societies of the reference countries
   - tier 3: other national bodies

10. If you are unsure, set "confidence": "low" and explain in "notes".

Output valid JSON only, matching the schema. No prose before or after."""

USER = """Topic: {topic}
Theme: {theme}
Clinical setting: {setting}
Country of use: {country}
Reference countries (whose practice the user follows): {reference_countries}
Reference languages: {languages}
Bodies to check (always cover each one, then discover others): {bodies}
Write scope_note and all notes in {ui_language}.
Keep it short: at most 1 crawl query per body, at most 1 verification query per document, notes of at most 12 words.

Return JSON in this exact schema:

{{
  "topic": string,
  "scope_note": string,
  "search_terms": {{
    "<language code>": [string]
  }},
  "bodies": [
    {{
      "body": string,
      "body_full_name": string,
      "country_or_region": string,
      "body_type": "international_society" | "national_agency" |
                   "national_society" | "working_group" | "gp_college" |
                   "ministry" | "regional" | "other",
      "website_domain": string | null,
      "listed": boolean,
      "discovered": boolean,
      "status": "has_guidance" | "adopts_other" | "no_guidance" | "unknown",
      "adopts": {{ "body": string, "title": string, "year": integer }} | null,
      "crawl_queries": [string],
      "confidence": "high" | "medium" | "low",
      "notes": string | null
    }}
  ],
  "guidance": [
    {{
      "body": string,
      "co_bodies": [string],
      "title": string,
      "year": integer,
      "doc_type": "guideline" | "rfe" | "expert_consensus" |
                  "consensus_conference" | "position_statement" |
                  "fiche_memo" | "care_pathway" | "national_protocol" | "other",
      "journal": string | null,
      "doi": string | null,
      "pmid": string | null,
      "corporate_author": string | null,
      "url_hint": string | null,
      "language": string,
      "role": "core" | "adjacent",
      "tier": 1 | 2 | 3,
      "supersedes": [ {{ "title": string, "year": integer }} ],
      "verification_queries": [string],
      "confidence": "high" | "medium" | "low",
      "notes": string | null
    }}
  ]
}}"""


# ─── Asking the model ───────────────────────────────────────────────────────────────────────────


def _config() -> dict:
    return yaml.safe_load(CONFIG.read_text(encoding="utf-8"))


def bodies_for(topic: dict) -> list[str]:
    cfg = _config()
    by_section = cfg.get("by_section", {}).get(topic.get("section"), [])
    return list(dict.fromkeys([*cfg["by_group"].get(topic.get("group"), []), *by_section, *cfg["always"]]))


def prompt(topic: dict) -> str:
    cfg = _config()
    return USER.format(topic=f"{topic['fr']} ({topic['en']})", theme=topic.get("group_label") or "", setting=cfg["setting"],
                       country=cfg["country"], reference_countries=cfg["reference_countries"], languages=cfg["languages"],
                       bodies=", ".join(bodies_for(topic)), ui_language=cfg.get("ui_language", "fr"))


def _json(text: str) -> dict:
    """The JSON object of an answer, fences or stray prose around it ignored."""
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("pas de JSON dans la réponse")
    return json.loads(text[start : end + 1])


def ask(topic: dict) -> dict:
    """The model's answer, from the first model of FACTORY_MODEL, FACTORY_FALLBACK_MODELS that answers valid JSON."""
    key = L.setting("OPENROUTER_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY absent de .env.local")
    models = [m.strip() for m in [L.setting("FACTORY_MODEL") or "", *(L.setting("FACTORY_FALLBACK_MODELS") or "").split(",")] if m.strip()]
    if not models:
        raise RuntimeError("FACTORY_MODEL absent de .env.local")
    errors = []
    for model in models:
        try:
            r = httpx.post(OPENROUTER, timeout=TIMEOUT_S, headers={"Authorization": f"Bearer {key}", "X-Title": "MedGuides"}, json={
                "model": model, "max_tokens": 10000, "response_format": {"type": "json_object"}, "reasoning": {"effort": "low"},
                "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt(topic)}]})
            r.raise_for_status()
            body = r.json()
            answer = _json(body["choices"][0]["message"]["content"] or "")
            if not isinstance(answer.get("guidance"), list):
                raise ValueError("champ guidance absent")
            return {**answer, "model": model, "usage": body.get("usage")}
        except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
            errors.append(f"{model} : {type(exc).__name__} {str(exc)[:120]}")
    raise RuntimeError(" ; ".join(errors))


# ─── Checking each proposal ─────────────────────────────────────────────────────────────────────

_STOP = set("the of and for in on with a an to by from des de du la le les et pour sur en au aux dans".split())
_EDITORIAL = set("editor editors choice summary version short long full abridged executive".split())


def words(title: str) -> set[str]:
    """A title's words, without the co-authoring bodies' chain ("ACC/AHA/AATS/ACR/..."), which titles abbreviate."""
    return {L.singular(w) for w in re.findall(r"[a-z0-9]{3,}", L.fold(re.sub(r"\S*/\S*", " ", title))) if w not in _STOP}


def same_title(a: str, b: str) -> bool:
    """The same document: most words of the shorter title (subtitle often dropped) are in the other."""
    wa, wb = words(a), words(b)
    return bool(wa and wb) and len(wa & wb) / min(len(wa), len(wb)) >= MATCH


def _search(term: str, n: int = 10) -> list[str]:
    return L._ncbi("esearch.fcgi", {"db": "pubmed", "term": term, "retmax": n})["esearchresult"]["idlist"]


def _best(proposal: dict, recs: list[dict]) -> dict | None:
    """The record that is this document: same title, year within one, not a commentary, translation or erratum;
    among several, the body's own journal, then PubMed's guideline type."""
    year = proposal.get("year")
    ok = [r for r in recs if same_title(proposal["title"], r["title"]) and L.classify(r)[0] != "article"
          and (not year or not r["year"] or abs(r["year"] - year) <= 1)]
    journal = L.fold(proposal.get("journal") or "")
    ok.sort(key=lambda r: (L.fold(r["journal"]) != journal, not set(r["pubtypes"]) & L.GUIDE_PT))
    return ok[0] if ok else None


def verify(p: dict) -> dict | None:
    """The PubMed record of a proposed document: by its PMID, its DOI, then its title words and year."""
    tries: list[list[str]] = []
    if p.get("pmid") and str(p["pmid"]).isdigit():
        tries.append([str(p["pmid"])])
    if p.get("doi"):
        tries.append(_search(f'"{p["doi"]}"[doi]'))
    # subject words only: no author chain ("ACC/AHA/AATS/..."), acronym, year or boilerplate ("Editors' Choice",
    # "Clinical Practice Guidelines"), which the PubMed title may not repeat
    head = re.sub(r"\S*/\S*", " ", re.split(r":\s", p["title"])[0])
    title_words = [w for w in re.findall(r"[^\W\d_]{4,}", head)
                   if not w.isupper() and L.fold(w) not in _STOP and L.fold(w) not in L._BOILER and L.fold(w) not in _EDITORIAL][:8]
    if title_words:
        year = f" AND {p['year'] - 1}:{p['year'] + 1}[dp]" if p.get("year") else ""
        guidance = ('(guideline[pt] OR "practice guideline"[pt] OR guideline*[ti] OR recommendation*[ti] OR consensus[ti] '
                    'OR statement[ti] OR recommandation*[tt] OR consensus[tt])')
        tries.append(_search(" AND ".join(f"{w}[ti]" for w in title_words) + f" AND {guidance}" + year, 50))
        # a French document: its title words are in PubMed's original-title field, not the English title
        tries.append(_search(" AND ".join(f"{L.fold(w)}[tt]" for w in title_words) + f" AND {guidance}" + year, 50))
    for ids in tries:
        found = _best(p, L.records(ids) if ids else [])
        if found:
            return found
    return None


def search_terms(answer: dict) -> dict[str, list[str]]:
    """The model's search terms by language, cleaned: strings only, no duplicates."""
    out: dict[str, list[str]] = {}
    for lang, terms in (answer.get("search_terms") or {}).items():
        if isinstance(terms, list):
            out[str(lang)[:2].lower()] = list(dict.fromkeys(t.strip() for t in terms if isinstance(t, str) and t.strip()))
    return out


def run(topic: dict, refresh: bool = False, ask: bool = True) -> dict | None:
    """The model's answer, each guidance document verified on PubMed or not (yet); never raises (an error is in
    "error"). Without `ask`, only a saved answer (any age) is returned, else None: nothing is paid."""
    path = CACHE / f"{topic['id']}.json"
    if path.exists() and not refresh:
        saved = json.loads(path.read_text(encoding="utf-8"))
        if saved.get("version") == VERSION and not saved.get("error") and (
                not ask or datetime.now(timezone.utc) - datetime.fromisoformat(saved["asked_at"]) < FRESH):
            return saved
    if not ask:
        return None
    out = {"version": VERSION, "asked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "listed": bodies_for(topic)}
    try:
        answer = ask(topic)
    except Exception as exc:
        return {**out, "error": f"Bibliothécaire indisponible : {exc}"[:400], "guidance": [], "bodies": [], "search_terms": {}}
    guidance = []
    for p in answer["guidance"]:
        if not isinstance(p, dict) or not p.get("title"):
            continue
        p = {**p, "year": p["year"] if isinstance(p.get("year"), int) else None, "llm_pmid": p.get("pmid"), "llm_doi": p.get("doi")}
        rec = verify(p)
        if rec:
            p.update(verified=True, pmid=rec["pmid"], doi=rec["doi"], journal=rec["journal"], year=rec["title_year"] or rec["year"],
                     title=rec["title"], record=rec, check="trouvé sur PubMed")
        else:
            p.update(verified=False, pmid=None, doi=None, check="introuvable sur PubMed")
        guidance.append(p)
    out.update(model=answer["model"], usage=answer.get("usage"), scope_note=answer.get("scope_note"), guidance=guidance,
               bodies=[b for b in answer.get("bodies") or [] if isinstance(b, dict) and b.get("body")],
               search_terms=search_terms(answer))
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--topic", required=True)
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()
    from topics import load_topics

    t = next((x for x in load_topics()[0] if x["id"] == args.topic), None)
    if not t:
        sys.exit(f"thème inconnu : {args.topic}")
    print(json.dumps(run(t, args.refresh), ensure_ascii=False, indent=1))
