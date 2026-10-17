"""Part B: the Claude calls of fiche generation (Anthropic SDK, server-side, ANTHROPIC_API_KEY from .env.local).

- route(): one call (Haiku) maps printed pages to the 13 sections and lists topics outside the audience's practice;
- sections(): one call per section, in parallel, or through the Message Batches API (half price) when nobody waits;
- fix(): the retry call for quotes the check did not find;
- cover(): one targeted call per section for the recommendation and dose rows the fiche does not cover yet.
Pages holding a figure are sent as PNG images too (vision), after the page text.
Every answer is JSON constrained by a schema (output_config.format). The shared system prompt is marked for prompt
caching (it only caches above the model's minimum prompt length). The cheapest settings by default: Haiku with no
thinking; Sonnet and Opus (which cannot turn thinking off) at low effort. Temperature is left at its default: these
models reject other sampling values. Every call's tokens and cost go to `log` (prices: shared/llm_prices.yaml).
"""

import base64
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import anthropic
import yaml

from ..settings import env

DEFAULT_MODEL = "claude-haiku-5-5"
ROUTING_MODEL = "claude-haiku-5-5"
MODELS = ("claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5")
PRICES = yaml.safe_load((Path(__file__).resolve().parents[4] / "shared" / "llm_prices.yaml").read_text(encoding="utf-8"))
MAX_PAGES = 40  # per section, sent CHUNK_PAGES at a time
CHUNK_PAGES = 8  # a call per 8 pages: one call over 25 pages summarises instead of extracting
PARALLEL = 6
# Pages a section needs whatever the routing says, found by their words (code, no model): do-not statements are spread
# over every treatment page; key messages and scope have fixed names.
KEYWORDS = {
    "8_ne_pas_faire": re.compile(r"\b(should not|not recommended|avoid|3: harm|3: no benefit|is contraindicated)\b", re.I),
    "6_examens": re.compile(r"\b(ECG|electrocardiogra\w*|troponin|cTn|laboratory)\b", re.I),
    "1_essentiel": re.compile(r"\b(take-home messages|top 10|key messages)\b", re.I),
    "3_champ": re.compile(r"\bscope of (the|this) guideline\b", re.I),
}

ROUTING_SYSTEM = """You map pages of a clinical practice guideline to the 13 sections of a
clinical fiche for {audience} (general practitioners and emergency first
contact, Algeria). Sections: 1_essentiel (key messages), 2_presentation
(symptoms, misleading forms, clinical exam), 3_champ (scope), 4_gravite
(severity signs, immediate actions), 5_conduite (decision tree), 6_examens
(ECG, biology, imaging), 7_traitement (treatments, contraindications, doses),
8_ne_pas_faire (do-not statements), 9_orientation (transport, referral),
10_surveillance (monitoring), 11_suivi (follow-up after discharge),
12_ordonnance (prescription template), 13_definitions.
For each section return the printed pages that contain material for it.
Return [] if the guideline has none. Also list topics in the guideline that
are outside this audience's practice (e.g. catheterization lab technique,
mechanical circulatory support). JSON only."""

GENERATION_SYSTEM = """You turn a clinical practice guideline into one section of a clinical fiche,
in French, for general practitioners and emergency first contact in Algeria.

RULES
1. No element without a verbatim quote and its printed page. No quote, no line.
2. The quote is copied exactly from the page text given, in the original
   language. Do not fix typos, units or symbols inside the quote. If you need
   to skip text inside a quote, use " [...] " between the parts you keep;
   each part must be verbatim and in the original order.
3. The French line says only what the quote supports. Do not add thresholds,
   examples, doses or conditions that are not in the quote.
4. Section placement: symptoms only in 2_presentation; ECG and biology only
   in 6_examens; do-not statements ("should not", "not recommended",
   "avoid") only in 8_ne_pas_faire.
5. Doses: fill dose fields only from the source. Anything absent goes in
   "missing", never guessed. Do not fill Algerian brands or status.
6. If the source text looks wrong (e.g. an impossible unit), keep the quote
   verbatim, write the French line with the likely correct value, and add an
   entry to "missing" explaining the discrepancy for the reviewer.
7. Grades: copy class of recommendation and level of evidence as given
   (e.g. "COR 1 / LOE B-R"), else null.
8. If the pages contain nothing for this section, return state "non_traité"
   with no elements. Never fill a section by guessing.
9. Quotes from figures or tables are allowed; set "from_figure": true when
   the quote comes from a figure.

OUTPUT: JSON matching the schema for this section (elements, or nodes with
branches for 5_conduite, or signes lists for 2_presentation and 4_gravite,
or elements + contre_indications + posologies for 7_traitement). Do not
output ids; code assigns them.

ELEMENT schema:
{ "text": string (French), "type": "action"|"conditional"|"info"|"row",
  "condition": string|null, "source": {"page": int, "quote": string},
  "from_figure": bool, "grade": string|null,
  "risk": "high"|"medium"|"low", "origin": "explicit", "missing": [string] }

DOSE schema:
{ "drug_dci": string, "dose": string, "dose_max": string|null,
  "route": string, "administration": string|null,
  "frequency_or_duration": string, "condition": string|null,
  "source": {"page": int, "quote": string}, "from_figure": bool,
  "missing": [string], "note": string|null }"""

RETRY_USER = ("These quotes were not found on the cited page; correct the quote and page from the same pages, or drop the line.\n"
              "Answer one fix per line, by its index: drop=true to drop it, else the corrected page and verbatim quote.\n\n")


def client() -> anthropic.Anthropic:
    key = env().get("ANTHROPIC_API_KEY")
    if not key:
        raise RuntimeError("ANTHROPIC_API_KEY manquant dans .env.local")
    # a key not scoped to a workspace must name one (ANTHROPIC_WORKSPACE_ID in .env.local)
    workspace = env().get("ANTHROPIC_WORKSPACE_ID")
    return anthropic.Anthropic(api_key=key, default_headers={"anthropic-workspace-id": workspace} if workspace else None)


def params(model: str, system: str, user: str | list, schema: dict, max_tokens: int = 16000) -> dict:
    """One request's parameters: the system prompt cached, the answer constrained to `schema`, the cheapest thinking."""
    p = {"model": model, "max_tokens": max_tokens,
         "system": [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
         "messages": [{"role": "user", "content": user}],
         "output_config": {"format": {"type": "json_schema", "schema": schema}}}
    if "haiku" in model:
        p["thinking"] = {"type": "disabled"}
    else:
        p["output_config"]["effort"] = "low"  # thinking cannot be turned off on Sonnet 5.5 / Opus 5.5
    return p


def cost(model: str, usage, batch: bool = False) -> dict:
    """Tokens and dollar cost of one call."""
    price = PRICES["models"].get(model, PRICES["models"]["claude-sonnet-5-5"])
    u = {"input_tokens": getattr(usage, "input_tokens", 0) or 0, "output_tokens": getattr(usage, "output_tokens", 0) or 0,
         "cache_read_tokens": getattr(usage, "cache_read_input_tokens", 0) or 0,
         "cache_write_tokens": getattr(usage, "cache_creation_input_tokens", 0) or 0}
    usd = (u["input_tokens"] * price["input"] + u["output_tokens"] * price["output"]
           + u["cache_read_tokens"] * price["cache_read"] + u["cache_write_tokens"] * price["cache_write"]) / 1e6
    return {**u, "cost_usd": round(usd * (PRICES["batch"] if batch else 1), 6), "model": model, "batch": batch}


def _answer(message) -> dict:
    if message.stop_reason == "refusal":
        raise RuntimeError("le modèle a refusé de répondre")
    if message.stop_reason == "max_tokens":
        raise RuntimeError("réponse tronquée (max_tokens)")
    return json.loads(next(b.text for b in message.content if b.type == "text"))


def call(p: dict, log, stage: str, section: str | None = None) -> dict:
    message = client().messages.create(**p)
    log({**cost(p["model"], message.usage), "stage": stage, "section": section})
    return _answer(message)


def page_block(pages: list[dict]) -> str:
    """The routed pages as Claude reads them: printed page header, then the parsed markdown (raw text when the
    parser gave nothing)."""
    return "\n\n".join(f"=== printed page {p['printed_page']} ===\n{(p.get('parsed') or '').strip() or p.get('raw_columns') or ''}" for p in pages)


def route(pages: list[dict], audience: str, log) -> dict:
    """{"sections": {section: [printed pages]}, "excluded_by_audience": [...]}, each section capped at MAX_PAGES."""
    from .schema import ROUTING, SECTIONS

    lines = []
    for p in pages:
        text = (p.get("parsed") or p.get("raw_columns") or "")
        heads = [l.strip() for l in text.split("\n") if l.lstrip().startswith("#")]
        lines.append(json.dumps({"printed_page": p["printed_page"], "start": " ".join(text.split())[:400], "headings": heads[:15]}, ensure_ascii=False))
    out = call(params(ROUTING_MODEL, ROUTING_SYSTEM.format(audience=audience), "\n".join(lines), ROUTING, 8000), log, "routing")
    known = {p["printed_page"] for p in pages}
    for s, rx in KEYWORDS.items():  # the model's pages first, then the pages the keywords find
        out["sections"][s] = [*out["sections"].get(s, []), *(p["printed_page"] for p in pages if rx.search(p.get("raw_columns") or ""))]
    out["sections"] = {s: [n for n in dict.fromkeys(out["sections"].get(s, [])) if n in known][:MAX_PAGES] for s in SECTIONS}
    return out


def section_user(section: str, audience: str, source: dict, pages: list[dict]) -> str:
    return (f"Section: {section}\nAudience: {audience}\nSource: {source.get('title')} ({source.get('citation')})\n\n" + page_block(pages))


FIGURE_NOTE = ("The images below are the pages above that hold a figure, for the text inside the figure. A quote taken from "
               "an image is copied as printed in it, with \"from_figure\": true and the printed page of that image.")


def section_content(section: str, audience: str, source: dict, pages: list[dict]) -> str | list:
    """The user message: the pages' text, then the figure pages as images (page["png"], set by the pipeline)."""
    text = section_user(section, audience, source, pages)
    figures = [p for p in pages if p.get("png")]
    if not figures:
        return text
    blocks: list[dict] = [{"type": "text", "text": text + "\n\n" + FIGURE_NOTE}]
    for p in figures:
        blocks += [{"type": "text", "text": f"=== image of printed page {p['printed_page']} ==="},
                   {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.b64encode(p["png"]).decode()}}]
    return blocks


def sections(jobs: dict[str, list[dict]], audience: str, source: dict, model: str, log, batch: bool = False) -> dict[str, dict | Exception]:
    """{section: answer or the error}, one call per section with pages."""
    from .schema import llm_section_schema

    # one request per section and chunk of CHUNK_PAGES pages ("6_examens#1"), merged back per section
    reqs = {f"{s}#{k}": params(model, GENERATION_SYSTEM, section_content(s, audience, source, pages[i:i + CHUNK_PAGES]), llm_section_schema(s))
            for s, pages in jobs.items() for k, i in enumerate(range(0, len(pages), CHUNK_PAGES))}
    if not reqs:
        return {}
    if batch:
        parts = _batch(reqs, log)
    else:
        def one(item):
            key, p = item
            try:
                return key, call(p, log, "section", key.split("#")[0])
            except Exception as exc:  # one section failing does not stop the others
                return key, exc

        with ThreadPoolExecutor(PARALLEL) as pool:
            parts = dict(pool.map(one, reqs.items()))
    return merge(parts)


def merge(parts: dict[str, dict | Exception]) -> dict[str, dict | Exception]:
    """Chunk answers ("section#k") merged per section: lists concatenated, nodes appended, filled if any part is.
    A section with a failed chunk keeps its other chunks (the failure is reported only when all failed)."""
    out: dict[str, dict | Exception] = {}
    for key in sorted(parts, key=lambda k: (k.split("#")[0], int(k.split("#")[1]) if "#" in k else 0)):
        s, ans = key.split("#")[0], parts[key]
        if isinstance(ans, Exception):
            out.setdefault(s, ans)
            continue
        cur = out.get(s)
        if cur is None or isinstance(cur, Exception):
            out[s] = ans
            continue
        for k, v in ans.items():
            if isinstance(v, list):
                cur[k] = [*cur.get(k, []), *v]
        if ans.get("state") == "filled":
            cur["state"] = "filled"
    return out


def _batch(reqs: dict[str, dict], log, poll_s: int = 30) -> dict[str, dict | Exception]:
    """The same requests through the Message Batches API (half price), polled until they end."""
    c = client()
    ids = {key: re.sub(r"[^A-Za-z0-9_-]", "-", key) for key in reqs}
    b = c.messages.batches.create(requests=[{"custom_id": ids[k], "params": p} for k, p in reqs.items()])
    while c.messages.batches.retrieve(b.id).processing_status != "ended":
        time.sleep(poll_s)
    names = {v: k for k, v in ids.items()}
    out: dict[str, dict | Exception] = {}
    for r in c.messages.batches.results(b.id):
        s = names[r.custom_id]
        if r.result.type != "succeeded":
            out[s] = RuntimeError(f"lot : {r.result.type}")
            continue
        log({**cost(reqs[s]["model"], r.result.message.usage, batch=True), "stage": "section", "section": s.split("#")[0]})
        try:
            out[s] = _answer(r.result.message)
        except Exception as exc:
            out[s] = exc
    return out


def fix(section: str, failed: list[dict], audience: str, source: dict, pages: list[dict], model: str, log) -> list[dict]:
    """The retry call for one section's failed quotes: [{index, drop, page, quote}]."""
    from .schema import FIXES

    # a dose has no "text": its drug and dose stand for it
    listing = "\n".join(json.dumps({"index": i, "text": f.get("text") or f"{f.get('drug_dci')} {f.get('dose')}", "page": f["source"]["page"],
                                    "quote": f["source"]["quote"]}, ensure_ascii=False)
                        for i, f in enumerate(failed))
    user = RETRY_USER + listing + "\n\n" + section_user(section, audience, source, pages)
    return call(params(model, GENERATION_SYSTEM, user, FIXES, 8000), log, "retry", section)["fixes"]


COVER_USER = ("These rows of the guideline's recommendation and dose tables are not in the fiche yet. Write this section's "
              "lines for them, each quote copied verbatim from its row and cited on its printed page. A row outside the "
              "audience's practice (e.g. catheterization laboratory technique, mechanical circulatory support, surgery) "
              "goes in \"excluded\" with its index and the topic, instead of a line.\n\n")


def cover(section: str, rows: list[dict], audience: str, source: dict, model: str, log) -> dict:
    """The targeted coverage call for one section's uncovered rows: the section's answer plus "excluded" [{row, topic}]."""
    from .schema import llm_cover_schema

    listing = "\n".join(json.dumps({"index": i, "printed_page": r["page"], **({"cor": r["cor"], "loe": r["loe"]} if r["kind"] == "rec" else {}),
                                    "row": r["text"]}, ensure_ascii=False) for i, r in enumerate(rows))
    user = (f"Section: {section}\nAudience: {audience}\nSource: {source.get('title')} ({source.get('citation')})\n\n" + COVER_USER + listing)
    return call(params(model, GENERATION_SYSTEM, user, llm_cover_schema(section)), log, "coverage", section)
