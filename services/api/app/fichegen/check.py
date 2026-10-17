"""Part C: the quote check of a generated line, without any model.

Both sides are normalised the same way: lowercase, ligatures, pdftotext glyph substitutions (# $ £ ‡ for ≤ ≥) and µ
read as m, the recommendation-table tokens pdftotext interleaves ("1 B-R", "3: No Benefit A"; ESC "IIa   C" at a
line's end) removed, then everything
but letters, digits and ≤ ≥ < > % stripped. A quote passes on printed page P when each of its " [...] " fragments is
found, in order, in the raw layer of P (layout or column-split: "pdf"), else in its parsed layer ("parsed").
"""

import re
import unicodedata

_LIGATURES = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"}
_GLYPHS = str.maketrans({"#": "≤", "$": "≥", "£": "≤", "‡": "≥", "µ": "m", "μ": "m"})
_TABLE_TOKENS = re.compile(r"\n\s*(1|2a|2b|3: No Benefit|3: Harm)\s+(A|B-R|B-NR|C-LD|C-EO)\b", re.I)
# ESC: Class and Level at the right edge of a line of the recommendation table ("...apply a      I      B")
_ESC_TOKENS = re.compile(r"[ \t]{2,}(I|IIa|IIb|III)[ \t]{2,}(A|B|C)[ \t]*$", re.M)
_KEEP = re.compile(r"[^0-9a-z≤≥<>%]+")
_FRAGMENTS = re.compile(r"\s*\[\s*(?:\.\.\.|…)\s*\]\s*")


def normalise(text: str) -> str:
    for a, b in _LIGATURES.items():
        text = text.replace(a, b)
    text = _ESC_TOKENS.sub("", _TABLE_TOKENS.sub("\n", text))
    text = unicodedata.normalize("NFKD", text.translate(_GLYPHS))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    return _KEEP.sub("", text)


def fragments(quote: str) -> list[str]:
    return [f for f in (normalise(x) for x in _FRAGMENTS.split(quote or "")) if f]


def found_in_order(frags: list[str], hay: str) -> bool:
    pos = 0
    for f in frags:
        i = hay.find(f, pos)
        if i < 0:
            return False
        pos = i + len(f)
    return bool(frags)


def check(quote: str, page: dict | None) -> str:
    """"pdf" | "parsed" | "failed" for a quote on one page's layers ({raw_layout, raw_columns, parsed})."""
    frags = fragments(quote)
    if not page or not frags:
        return "failed"
    if found_in_order(frags, normalise(page.get("raw_layout") or "")) or found_in_order(frags, normalise(page.get("raw_columns") or "")):
        return "pdf"
    if found_in_order(frags, normalise(page.get("parsed") or "")):
        return "parsed"
    return "failed"


def from_figure(quote: str, page: dict | None) -> bool:
    """Is the quote inside a block the parser took from a figure or image."""
    frags = fragments(quote)
    return bool(page and frags) and any(found_in_order(frags, normalise(b)) for b in page.get("parsed_figures") or [])
