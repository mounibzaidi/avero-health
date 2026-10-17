"""The record classifier: an LLM labels every search record (primary guidance, derivative, correction...), names its
issuing body and its edition year, and judges its relevance to the topic.

Called by literature.search on the records of a search, when asked (the "Analyser avec l'IA" button): 20 records a
call, several calls at once, on a small model (CLASSIFIER_MODEL, default Claude Haiku 5.5 through OpenRouter: about
$0.02 a topic), no reasoning, short answers. What PubMed's own types already settle (erratum, comment, editorial,
letter) is labelled without the model. Results are cached per topic and document (DOI, else PMID, else URL) in
downloads/classifier/: a rerun, or a search without the button, reuses them for free. A record the model does not
answer stays unclassified, and literature.py falls back on its own rules for it.
"""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

import literature as L

HERE = Path(__file__).resolve().parent
CACHE = HERE / "downloads" / "classifier"
OPENROUTER = "https://openrouter.ai/api/v1/chat/completions"
BATCH = 20
PARALLEL = 6
TIMEOUT_S = 150
DEFAULT_MODEL = "anthropic/claude-haiku-5.5"  # labelling a title and abstract needs no large model
ABSTRACT_CHARS = 400
# PubMed types that settle the label without the model
BY_TYPE = {"Published Erratum": "correction", "Comment": "commentary", "Editorial": "commentary", "Letter": "commentary"}
LABELS = {"primary_guidance", "derivative", "correction", "methodology", "patient_material", "research", "commentary", "expired"}

SYSTEM = """You classify medical publications for a guideline library. For each record
(title, abstract or first page, authors, corporate author, journal, year,
language) return exactly one label:

- primary_guidance: an official document issued by a body in its own name
  (guideline, recommandations de bonnes pratiques, RFE, consensus d'experts,
  conférence de consensus, position statement, clinical policy, fiche mémo,
  guide du parcours de soins, appropriateness criteria). Includes non-English
  national guidelines written by that country's own bodies.
- derivative: summary, executive summary published separately, highlights,
  "what's new", "l'essentiel", "ce qui change", "at a glance", key points,
  perspectives, interpretation, comparison of guidelines, critical appraisal,
  Q&A or companion document, translation or reprint of another body's
  guideline, endorsement statement.
- correction: correction, corrigendum, erratum.
- methodology: reporting standards, definitions for research, trial design
  standards.
- patient_material: patient pages, patient leaflets.
- research: original studies, registries, audits, adherence studies,
  modelling, surveys, systematic reviews, narrative reviews.
- commentary: editorials, letters, comments, replies.
- expired: temporary or pandemic-era guidance.

Also return:
- issuing_body: the body that ISSUED the document, or null. A paper about a
  guideline is not issued by that guideline's body. Never infer the body from
  the journal.
- co_bodies: other issuing bodies, or [].
- guideline_edition_year: the edition year in the title if different from
  publication year (e.g. "JCS 2020 Guideline" published 2023 -> 2020), else
  null.
- derived_from: for derivatives, the body and year of the guideline it is
  about, or null.
- relevance: "core" | "adjacent" | "off_topic" for the topic and setting
  given (general practice and emergency first contact, Algeria).
- reason: one short sentence in French.

A bracketed title only means the article is not in English. It does not mean
it is a translation: decide from the content whether it is the country's own
guideline or a summary of someone else's.

Output JSON only: {"results":[{"id":..., "label":..., ...}]}
Keep "reason" to at most 8 words. Omit any field whose value is null or empty."""

_lock = threading.Lock()
ERRORS: list[str] = []  # why batches went unanswered in this run (shown on the results page)


def doc_key(r: dict) -> str:
    if r.get("doi"):
        return "doi:" + r["doi"].lower()
    if r.get("pmid"):
        return "pmid:" + r["pmid"]
    return "url:" + r["url"]


def _cache_path(topic_id: str) -> Path:
    return CACHE / f"{topic_id}.json"


def _load(topic_id: str) -> dict:
    p = _cache_path(topic_id)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _save(topic_id: str, cache: dict) -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    _cache_path(topic_id).write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


def _payload(i: int, r: dict) -> dict:
    return {"id": i, "title": r["title"], "title_en": r.get("title_en"), "abstract": (r.get("abstract") or "")[:ABSTRACT_CHARS] or None,
            "authors": (r.get("authors") or [])[:3], "corporate_author": r.get("corporate") or [], "journal": r.get("journal"),
            "year": r.get("year"), "language": ",".join(r.get("lang") or []) or None,
            "source": "PubMed" if r.get("pmid") else f"catalogue {r.get('journal')}", "url": r.get("url")}


def _ask(batch: list[tuple[int, dict]], topic: dict) -> dict[int, dict]:
    key = L.setting("OPENROUTER_API_KEY")
    # no fallback to a large model: a batch the small one misses is classified by rules, never at Sonnet's price
    models = [L.setting("CLASSIFIER_MODEL") or DEFAULT_MODEL]
    user = (f"Topic: {topic['fr']} ({topic['en']})\nSetting: general practice and emergency first contact, Algeria\n\n"
            + json.dumps({"records": [_payload(i, r) for i, r in batch]}, ensure_ascii=False))
    for model in models:
        try:
            resp = httpx.post(OPENROUTER, timeout=TIMEOUT_S, headers={"Authorization": f"Bearer {key}", "X-Title": "MedGuides"}, json={
                "model": model, "max_tokens": 4000, "response_format": {"type": "json_object"}, "reasoning": {"enabled": False},
                "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]})
            resp.raise_for_status()
            text = resp.json()["choices"][0]["message"]["content"] or ""
            out = json.loads(text[text.find("{"): text.rfind("}") + 1])
            return {int(x["id"]): x for x in out.get("results", []) if isinstance(x, dict) and x.get("label") in LABELS and str(x.get("id")).isdigit()}
        except httpx.HTTPStatusError as exc:
            msg = exc.response.text[:200]
            if exc.response.status_code == 402:
                msg = "crédits OpenRouter insuffisants"
            with _lock:
                ERRORS.append(f"{model} : HTTP {exc.response.status_code} {msg}")
        except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
            with _lock:
                ERRORS.append(f"{model} : {type(exc).__name__} {str(exc)[:120]}")
    return {}


def classify(records: list[dict], topic: dict, ask: bool = True) -> dict[str, dict]:
    """{doc_key: classification} for these records: PubMed's types, then the cache, then (if `ask`) the model, 20 at
    a time. Never raises."""
    cache = _load(topic["id"])
    settled = {doc_key(r): {"label": BY_TYPE[t], "reason": f"type PubMed : {t}"} for r in records
               for t in (r.get("pubtypes") or []) if t in BY_TYPE}
    if not ask or not L.setting("OPENROUTER_API_KEY"):
        return {doc_key(r): settled.get(doc_key(r)) or cache[doc_key(r)] for r in records if doc_key(r) in settled or doc_key(r) in cache}
    todo = [r for r in {doc_key(r): r for r in records}.values() if doc_key(r) not in cache and doc_key(r) not in settled]
    batches = [list(enumerate(todo[k: k + BATCH])) for k in range(0, len(todo), BATCH)]

    def run(batch):
        got = _ask(batch, topic)
        with _lock:
            for i, r in batch:
                if i in got:
                    cache[doc_key(r)] = {k: got[i].get(k) for k in ("label", "issuing_body", "co_bodies", "guideline_edition_year",
                                                                   "derived_from", "relevance", "reason")}

    if batches:
        with ThreadPoolExecutor(PARALLEL) as pool:
            list(pool.map(run, batches))
        _save(topic["id"], cache)
    return {doc_key(r): settled.get(doc_key(r)) or cache[doc_key(r)] for r in records if doc_key(r) in settled or doc_key(r) in cache}
