"""Deterministic checks of one fiche line against its source. No LLM: a line passes only if the
words it cites are really on the cited page and every number it states is in those words.

Matching ignores what PDF extraction scrambles: case, accents, punctuation, markdown, and
whitespace (so "médica menteux", split across a line break in the PDF, matches "médicamenteux").
Letters and digits must still match exactly and in order.
"""

import re
import unicodedata
from dataclasses import dataclass, field
from difflib import SequenceMatcher

# A quote shorter than this (letters+digits after normalisation) proves nothing by being found.
MIN_QUOTE_CHARS = 12

_NUM = re.compile(r"\d+(?:[.,]\d+)?")
# Numbers the source may spell out ("deux des trois classes", "quatrième médicament"). Not
# "un/une/premier": they are also articles, so counting them would let a stray "1" pass.
_WORDS = "deux trois quatre cinq six sept huit neuf dix onze douze".split()
_NUMBER_WORDS = {w: str(n) for n, w in enumerate(_WORDS, 2)}
_NUMBER_WORDS.update({(w[:-1] if w.endswith("e") else w.replace("neuf", "neuv").replace("cinq", "cinqu")) + "ieme": str(n) for n, w in enumerate(_WORDS, 2)})
# English sources (WHO, PMC): same rule, not "one/first" (also a pronoun / an ordinal of order).
_EN_WORDS = "two three four five six seven eight nine ten eleven twelve".split()
_NUMBER_WORDS.update({w: str(n) for n, w in enumerate(_EN_WORDS, 2)})
# English ordinals from "third" ("second" is also a unit of time, so it is left out, like "first").
_EN_ORDINALS = "third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth".split()
_NUMBER_WORDS.update({w: str(n) for n, w in enumerate(_EN_ORDINALS, 3)})
_NUMBER_WORD_RE = re.compile(r"\b(" + "|".join(sorted(_NUMBER_WORDS, key=len, reverse=True)) + r")s?\b")


def normalise(text: str) -> str:
    # Real html tags only (parsed tables, <sup> footnote markers): "< 135/85 mmHg" is text.
    text = re.sub(r"</?[a-zA-Z][^<>]*>", " ", text)
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("œ", "oe").replace("æ", "ae")
    return re.sub(r"[\W_]+", "", text)


# A space inside a number, French style: "1 000", with a plain, non-breaking, narrow or thin space.
# Only before a group of exactly 3 digits, so "5 100" joins but "J5 10 mg" does not.
_THOUSANDS = re.compile(r"(?<=\d)[ \u00a0\u202f\u2009](?=\d{3}(?!\d))")


def join_thousands(text: str) -> str:
    return _THOUSANDS.sub("", text)


def _value(n: str) -> str:
    n = n.replace(",", ".")
    whole, _, frac = n.partition(".")
    whole = whole.lstrip("0") or "0"
    frac = frac.rstrip("0")
    return f"{whole}.{frac}" if frac else whole


def numbers(text: str) -> set[str]:
    """Numbers as values: "1,5" == "1.5", "07" == "7", "1 000" == "1000"."""
    text = join_thousands(re.sub(r"\*\*", "", text))
    folded = "".join(ch for ch in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(ch))
    out = {_NUMBER_WORDS[w] for w in _NUMBER_WORD_RE.findall(folded)}
    out.update(_value(n) for n in _NUM.findall(text))
    return out


# Units, French and English spellings -> one name. Longest first, so "mg" is not read as "m".
_UNIT_NAMES = {
    "µg": "µg μg mcg ug microgrammes microgramme micrograms microgram",
    "mg": "mg milligrammes milligramme milligrams milligram",
    "kg": "kg kilogrammes kilogramme kilograms kilogram",
    "g": "g grammes gramme grams gram",
    "ml": "ml millilitres millilitre milliliters milliliter",
    "l": "l litres litre liters liter",
    "ui": "ui iu unites internationales unites units unit",
    "mmhg": "mmhg",
    "mmol": "mmol",
    "meq": "meq",
    "%": "% pour cent percent",
    "min": "minutes minute min mn",
    "h": "heures heure hours hour hrs hr h",
    "j": "jours jour days day j",
    "semaine": "semaines semaine weeks week",
    "mois": "mois months month",
    "an": "ans an years year",
}
_UNIT_OF = {alias: unit for unit, aliases in _UNIT_NAMES.items() for alias in aliases.split()}
_QUANTITY = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(" + "|".join(re.escape(a) for a in sorted(_UNIT_OF, key=len, reverse=True)) + r")(?![a-z])"
    r"(\s*(?:/|par|per)\s*kg\b)?"
)


def quantities(text: str) -> dict[str, set[str]]:
    """Value -> the units written right after it: "0,5 mg/kg" -> {"0.5": {"mg/kg"}}."""
    text = join_thousands(re.sub(r"\*\*", "", text))
    folded = "".join(ch for ch in unicodedata.normalize("NFKD", text.lower()) if not unicodedata.combining(ch))
    folded = folded.replace("μ", "µ")
    out: dict[str, set[str]] = {}
    for n, unit, per_kg in _QUANTITY.findall(folded):
        out.setdefault(_value(n), set()).add(_UNIT_OF[unit] + ("/kg" if per_kg else ""))
    return out


def unit_mismatches(text: str, quote: str) -> list[str]:
    """Values the line gives with a unit the quote does not use for them ("0,5 g" for "0,5 mg").
    A value the quote writes without a unit is not a mismatch: the quote may name the unit once."""
    said, quoted = quantities(text), quantities(quote)
    return sorted(f"{v} {u}" for v, units in said.items() if quoted.get(v) for u in units - quoted[v])


def best_similarity(needle: str, hay: str) -> float:
    """Best match ratio of needle against any same-length window of hay (0..1)."""
    if not needle or not hay:
        return 0.0
    if len(hay) <= len(needle):
        return SequenceMatcher(None, needle, hay, autojunk=False).ratio()
    step = max(1, len(needle) // 4)
    best = 0.0
    for start in range(0, len(hay) - len(needle) + step, step):
        r = SequenceMatcher(None, needle, hay[start : start + len(needle)], autojunk=False).ratio()
        if r > best:
            best = r
    return round(best, 3)


def grade_in_quote(label: str, quote: str) -> bool:
    """Whether a grade is written in the quote, as whole words ("Grade A", "AE"): a grade is given as
    the source writes it for that passage, or not at all."""
    def words(t: str) -> str:
        t = "".join(ch for ch in unicodedata.normalize("NFKD", t.lower()) if not unicodedata.combining(ch))
        return " ".join(re.sub(r"[^a-z0-9+]+", " ", t).split())

    return bool(words(label)) and f" {words(label)} " in f" {words(quote)} "


@dataclass
class Verdict:
    quote_found: bool
    numbers_match: bool
    detail: dict = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return self.quote_found and self.numbers_match


def verify_line(text: str, page: int, quote: str, pages: dict[int, str]) -> Verdict:
    """Check one line. pages: page number -> text of the cited source."""
    detail: dict = {}
    q = normalise(quote)
    if len(q) < MIN_QUOTE_CHARS:
        quote_found = False
        detail["quote"] = "trop_courte"
    elif q in normalise(pages.get(page, "")):
        quote_found = True
        detail["quote"] = "trouvee"
    else:
        quote_found = False
        elsewhere = [p for p, t in sorted(pages.items()) if p != page and q in normalise(t)]
        if elsewhere:
            detail["quote"] = "autre_page"
            detail["found_on_pages"] = elsewhere
        else:
            detail["quote"] = "absente"
            detail["similarity"] = best_similarity(q, normalise(pages.get(page, "")))

    said, quoted = numbers(text), numbers(quote)
    missing = sorted(said - quoted)
    detail["numbers"] = sorted(said)
    if missing:
        detail["numbers_missing"] = missing
    wrong_units = unit_mismatches(text, quote)
    if wrong_units:
        detail["units_mismatch"] = wrong_units
    return Verdict(quote_found=quote_found, numbers_match=not missing and not wrong_units, detail=detail)


def scores(verdicts: list[Verdict]) -> dict[str, float | None]:
    n = len(verdicts)
    if not n:
        return {"score_quote": None, "score_numbers": None, "score_overall": None}
    return {
        "score_quote": round(sum(v.quote_found for v in verdicts) / n, 3),
        "score_numbers": round(sum(v.numbers_match for v in verdicts) / n, 3),
        "score_overall": round(sum(v.ok for v in verdicts) / n, 3),
    }


def _contains_number_safe(hay: str, needle: str) -> bool:
    """needle in hay, but not inside a larger number: normalising drops commas and dots, so "0,5 mg"
    becomes "05mg", which contains "5mg"; a dose of "5 mg" must not pass as present."""
    if not needle:
        return False
    start = hay.find(needle)
    while start >= 0:
        before = hay[start - 1] if start else ""
        after = hay[start + len(needle)] if start + len(needle) < len(hay) else ""
        if not (needle[0].isdigit() and before.isdigit()) and not (needle[-1].isdigit() and after.isdigit()):
            return True
        start = hay.find(needle, start + 1)
    return False


def check_dosing(dosing: list[dict], quote: str) -> list[dict]:
    """Problems with a recommendation's doses: each dose as written must be in its quote (it is
    what the app shows), and a parsed min/max must be a number of that written dose."""
    problems = []
    q = normalise(quote)
    for d in dosing:
        written = d.get("dose_as_written") or ""
        if not _contains_number_safe(q, normalise(written)):
            problems.append({"drug": d.get("drug"), "problem": "dose_pas_dans_citation", "dose": written})
        stated = numbers(written)
        for key in ("dose_min", "dose_max"):
            v = d.get(key)
            if v is None:
                continue
            as_text = f"{v:g}"
            if as_text not in stated:
                problems.append({"drug": d.get("drug"), "problem": f"{key}_pas_dans_dose", "value": as_text})
    return problems


def verify_item(text: str, page: int, quote: str, pages: dict[int, str], data: dict | None = None) -> Verdict:
    """verify_line, plus the dose checks for a recommendation. A dose problem fails numbers_match:
    a wrong dose is the error that hurts, so it gets the same red flag as a missing number."""
    v = verify_line(text, page, quote, pages)
    problems = check_dosing((data or {}).get("dosing") or [], quote)
    if problems:
        v.detail["dosing"] = problems
        v.numbers_match = False
    return v
