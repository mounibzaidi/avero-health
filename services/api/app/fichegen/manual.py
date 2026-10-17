"""Manual fiche building ("select-to-add"): the reviewer selects passages of the guideline, picks where the line goes,
and one small Haiku call fills the rest of the line (French text, type, condition, risk, missing; the dose fields for
a posology). The quote is the selected text, never rewritten by the model.

Every proposal is checked by code before the reviewer accepts it: the quote on its page (each passage on its own
page), the grade next to the selection (ACC/AHA COR + LOE row, or ESC Class + Level), rule 4 placement, a duplicate of
a line already in the fiche, the strict schema of the line, and the Algerian nomenclature for a posology.
"""

import re

from jsonschema import Draft202012Validator

from . import assemble, check, coverage, llm
from .schema import DOSE, ELEMENT

_FIX = " [...] "
_ESC_GRADE = re.compile(r"\s(I|IIa|IIb|III)\s{2,}(A|B|C)\s*$")
_null = {"type": ["string", "null"]}
FILL_ELEMENT = {
    "type": "object", "additionalProperties": False, "required": ["text", "type", "condition", "grade", "risk", "missing"],
    "properties": {"text": {"type": "string"}, "type": {"enum": ["action", "conditional", "info", "row"]}, "condition": _null, "grade": _null,
                   "risk": {"enum": ["high", "medium", "low"]}, "missing": {"type": "array", "items": {"type": "string"}}},
}
FILL_DOSE = {
    "type": "object", "additionalProperties": False,
    "required": ["drug_dci", "dose", "dose_max", "route", "administration", "frequency_or_duration", "condition", "missing", "note"],
    "properties": {"drug_dci": {"type": "string"}, "dose": {"type": "string"}, "dose_max": _null, "route": {"type": "string"}, "administration": _null,
                   "frequency_or_duration": {"type": "string"}, "condition": _null, "missing": {"type": "array", "items": {"type": "string"}}, "note": _null},
}
FILL_SYSTEM = """You write one line of a French clinical fiche for general practitioners and emergency first
contact in Algeria, from a passage of a clinical practice guideline chosen by a physician.

RULES
1. The quote is fixed: never change it. Write only the other fields.
2. The French line says only what the quote supports. Do not add thresholds, examples, doses or conditions
   that are not in the quote.
3. "condition": the situation the line applies to, when the quote states one, else null.
4. "grade": the class of recommendation and level of evidence only if the context gives them next to the
   passage (e.g. "COR 1 / LOE B-R", "Classe I / Niveau B"); else null. Never guess.
5. "missing": what a prescriber would need that the quote does not give (for a dose: the missing dose fields).
   Never invent it into the other fields.
6. Doses: fill the dose fields only from the quote; absent fields go in "missing". Keep units as written
   (µg stays µg). Do not fill Algerian brands or status.
7. If the quote looks wrong (e.g. an impossible unit), keep the French line with the likely correct value and
   explain the discrepancy in "missing".
JSON only."""


def quote_of(parts: list[dict]) -> str:
    return _FIX.join(" ".join(p["text"].split()) for p in parts)


def _locate(layout: str, text: str) -> tuple[int, int] | None:
    """The first and last line of `layout` covered by `text` (both normalised), or None."""
    lines = layout.split("\n")
    norms = [check.normalise(l) for l in lines]
    joined, starts = "", []
    for n in norms:
        starts.append(len(joined))
        joined += n
    t = check.normalise(text)
    if not t:
        return None
    i = joined.find(t[:40])
    if i < 0:
        return None
    j = i + len(t)
    first = max(k for k, s in enumerate(starts) if s <= i)
    last = max(k for k, s in enumerate(starts) if s <= max(i, j - 1))
    return first, last


def grade_near(page: dict | None, text: str) -> str | None:
    """The grade printed next to a passage: its ACC/AHA recommendation row (COR + LOE), else an ESC Class + Level at
    the right edge of the lines the passage covers (or the line just before or after)."""
    if not page:
        return None
    layout = page.get("raw_layout") or ""
    for r in coverage.rec_rows(layout, page["printed_page"]):
        if check.normalise(text)[:60] in check.normalise(r["text"]) or check.normalise(r["text"])[:60] in check.normalise(text):
            return f"COR {r['cor']} / LOE {r['loe']}"
    span = _locate(layout, text)
    if span:
        lines = layout.split("\n")
        for k in range(max(0, span[0] - 1), min(len(lines), span[1] + 2)):
            m = _ESC_GRADE.search(lines[k])
            if m:
                return f"Classe {m.group(1)} / Niveau {m.group(2)}"
    return None


def context_of(page: dict | None, text: str, width: int = 700) -> str:
    """The page text around a passage, for the model (grade, condition)."""
    if not page:
        return ""
    raw = " ".join((page.get("raw_columns") or "").split())
    i = raw.lower().find(" ".join(text.split())[:40].lower())
    if i < 0:
        return raw[:width * 2]
    return raw[max(0, i - width): i + len(text) + width]


def all_lines(content: dict | None) -> list[dict]:
    """Every line of the fiche (elements, branches, signes, doses) with its section."""
    out = []
    for name, sec in ((content or {}).get("sections") or {}).items():
        lists = [v for v in sec.values() if isinstance(v, list)] + [v["elements"] for v in sec.values() if isinstance(v, dict) and "elements" in v]
        lists += [n["branches"] for n in sec.get("nodes") or []]
        out += [{"section": name, **el} for lst in lists for el in lst if isinstance(el, dict) and "source" in el]
    return out


def nomenclature(caller, dci: str) -> dict:
    """The Algerian nomenclature for a DCI: how many brands, how many registered, the best status."""
    from .. import supabase as sb

    word = re.sub(r"[^a-zà-ÿ]", "", (dci or "").split()[0].lower()) if dci else ""
    if len(word) < 4:
        return {"dci": dci, "brands": 0, "registered": 0, "statut": None}
    rows = sb.rest(caller, "GET", "nomenclature", {"dci_brut": f"ilike.*{word[:-1]}*", "select": "nom_marque,statut", "limit": "500"}) or []
    brands = {r["nom_marque"]: r["statut"] for r in rows}
    registered = sum(1 for s in brands.values() if s == "enregistre")
    best = "Enregistré" if registered else "Non renouvelé" if "non_renouvele" in brands.values() else "Retiré" if brands else None
    return {"dci": dci, "brands": len(brands), "registered": registered, "statut": best}


BLANK_ELEMENT = {"text": "", "type": "action", "condition": None, "grade": None, "risk": "medium", "missing": []}
BLANK_DOSE = {"drug_dci": "", "dose": "", "dose_max": None, "route": "", "administration": None, "frequency_or_duration": "",
              "condition": None, "missing": [], "note": None}


def propose(caller, draft: dict, pages: dict[int, dict], target: dict, parts: list[dict], log, fill: bool = False) -> dict:
    """The line for the selected passages and the target, with every code check. By default its fields are empty for
    the reviewer to type (no paid call); `fill` asks Haiku to pre-fill them. Not saved: the reviewer edits and
    accepts it in the dashboard."""
    content = draft["content"] or {}
    source_id = ((content.get("meta") or {}).get("sources") or [{}])[0].get("source_id") or draft["form"]["source"]["source_id"]
    quote = quote_of(parts)
    page = parts[0]["page"]
    status = [check.check(p["text"], pages.get(p["page"])) for p in parts]
    quote_status = "failed" if "failed" in status else "parsed" if "parsed" in status else "pdf"
    grade = grade_near(pages.get(page), parts[0]["text"])
    is_dose = target.get("place") == "posologies"
    context = "\n\n".join(f"[page {p['page']}] …{context_of(pages.get(p['page']), p['text'])}…" for p in parts)
    user = (f"Section: {target['section']}{' (posologie)' if is_dose else ''}\n"
            f"Quote (fixed, page {page}): {quote}\n"
            + (f"Grade printed next to it: {grade}\n" if grade else "")
            + f"\nPage context:\n{context}")
    fill = (llm.call(llm.params(llm.DEFAULT_MODEL, FILL_SYSTEM, user, FILL_DOSE if is_dose else FILL_ELEMENT, 1500), log, "manual", target["section"])
            if fill else dict(BLANK_DOSE if is_dose else BLANK_ELEMENT))
    src = {"source_id": source_id, "page": page, "quote": quote}
    if is_dose:
        line = {**fill, "risk": "high", "source": src, "translated": not assemble.is_french(quote),
                "missing": list(dict.fromkeys([*fill["missing"], "algerie.statut"])), "algerie": {"brands": [], "statut": None},
                "note": " ".join(x for x in [fill.get("note"), assemble.NOT_CHECKED] if x)}
        problems = [e.message for e in Draft202012Validator(DOSE).iter_errors(line)]
    else:
        line = {"id": "", **fill, "grade": grade or fill["grade"], "order": None, "source": src, "translated": not assemble.is_french(quote),
                "origin": "explicit", "conflict_group": None}
        problems = [e.message for e in Draft202012Validator(ELEMENT).iter_errors({**line, "id": "x"})]
    place = "node:0" if target.get("place") == "node" else target.get("place") or "elements"
    to, where = assemble.placed(target["section"], place, line)
    key = check.normalise(quote)[:200]
    dup = next((x for x in all_lines(content) if check.normalise(x["source"]["quote"])[:200] == key
                or (line.get("text") and check.normalise(x.get("text", "")) == check.normalise(line["text"]))), None)
    return {
        "line": line, "target": target, "quote_status": quote_status, "part_status": status,
        "grade_source": "page" if grade else ("model" if line.get("grade") else None),
        "placement": None if to == target["section"] else {"section": to, "place": where, "why": "règle 4 : " + (
            "consigne « ne pas faire »" if to == "8_ne_pas_faire" else "réalisation ou lecture d'un examen" if to == "6_examens" else "placement")},
        "duplicate": {"id": dup.get("id"), "section": dup["section"], "text": dup.get("text") or dup.get("drug_dci")} if dup else None,
        "problems": problems,
        "nomenclature": nomenclature(caller, line.get("drug_dci", "")) if is_dose else None,
    }

