"""The quote check of Protocol v1.1: is each evidence quote on its cited page of the stored source PDF.

Deterministic, no LLM. The PDF page is the printed page + the source's page_offset. The page is read with pdftotext
(poppler-utils) three ways (default, -raw, -layout), since each one breaks a different PDF layout (columns, tables);
the quote passes if any reading holds it. Both sides are normalised first: Unicode forms and ligatures, curly
quotes and dashes, soft hyphens, words cut by a hyphen at a line end, whitespace and case. Numbers are checked by
the publication gate (packages/schema), not here.
"""

import re
import subprocess
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path

MODES: tuple[tuple[str, ...], ...] = ((), ("-raw",), ("-layout",))
# A quote shorter than this (letters and digits after normalisation) proves nothing by being found.
MIN_QUOTE_CHARS = 12

_QUOTES = dict.fromkeys(map(ord, "‘’‚‛′´`"), "'") | dict.fromkeys(map(ord, "“”„‟«»″"), '"')
_DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−"), "-")
_LINE_END_HYPHEN = re.compile(r"(\w)-[ \t]*\r?\n\s*(\w)")


def _clean(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).replace("­", "").translate(_QUOTES).translate(_DASHES)
    return text.replace("\f", "\n")


def _words(text: str) -> str:
    """Lowercase words and numbers, one space apart: punctuation, quotes and whitespace no longer matter."""
    return " ".join(re.findall(r"[^\W_]+", text.lower()))


def page_forms(text: str) -> set[str]:
    """The normalised forms of a page. A hyphen at a line end is either a cut word ("throm-|bolysis") or a real
    hyphen ("age-|adjusted"); both readings are kept, so the quote may be written either way."""
    t = _clean(text)
    return {_words(_LINE_END_HYPHEN.sub(r"\1\2", t)), _words(t)}


_HYPHEN = re.compile(r"(\w)-(\w)")


def quote_forms(quote: str) -> list[str]:
    """The quote as written, and with its hyphens joined: pdftotext itself may join "age-|adjusted" into "ageadjusted"."""
    q = _LINE_END_HYPHEN.sub(r"\1\2", _clean(quote))
    return list(dict.fromkeys([_words(q), _words(_HYPHEN.sub(r"\1\2", q))]))


def _contains(hay: str, needle: str) -> bool:
    """Needle in hay on word boundaries: "5 mg" is not found inside "0 5 mg" -> "05 mg"."""
    return f" {needle} " in f" {hay} "


def pdftotext_pages(pdf: Path, mode: tuple[str, ...]) -> list[str]:
    """The text of every page of the PDF (index 0 = PDF page 1), read in one pdftotext mode."""
    out = subprocess.run(["pdftotext", "-enc", "UTF-8", *mode, str(pdf), "-"], capture_output=True, check=True, timeout=300)
    pages = out.stdout.decode("utf-8", errors="replace").split("\f")
    return pages[:-1] if pages and not pages[-1].strip() else pages


class PdfText:
    """A PDF's pages in every mode, normalised once."""

    def __init__(self, pdf: Path):
        self.modes = [[page_forms(p) for p in pdftotext_pages(pdf, m)] for m in MODES]
        self.page_count = max(len(m) for m in self.modes)

    def on_page(self, needles: list[str], index: int) -> bool:
        return any(index < len(m) and any(_contains(f, n) for f in m[index] for n in needles) for m in self.modes)

    def pages_with(self, needles: list[str]) -> list[int]:
        return [i + 1 for i in range(self.page_count) if self.on_page(needles, i)]

    @classmethod
    def from_bytes(cls, body: bytes) -> "PdfText":
        with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
            f.write(body)
            f.flush()
            return cls(Path(f.name))


@dataclass
class QuoteResult:
    found: bool
    pdf_page: int | None
    message: str | None = None


def check_quote(text: PdfText, quote: str, page: int, page_offset: int) -> QuoteResult:
    """Is `quote` on printed page `page` (PDF page = page + page_offset)."""
    pdf_page = page + page_offset
    needles = quote_forms(quote)
    if len(needles[0].replace(" ", "")) < MIN_QUOTE_CHARS:
        return QuoteResult(False, pdf_page, "citation trop courte pour être vérifiée")
    if not 1 <= pdf_page <= text.page_count:
        return QuoteResult(False, pdf_page, f"page {page} hors du document (PDF page {pdf_page}, {text.page_count} pages)")
    if text.on_page(needles, pdf_page - 1):
        return QuoteResult(True, pdf_page)
    elsewhere = [p - page_offset for p in text.pages_with(needles)]
    if elsewhere:
        return QuoteResult(False, pdf_page, "trouvée page " + ", ".join(map(str, elsewhere)) + f", pas page {page}")
    return QuoteResult(False, pdf_page, f"absente de la page {page}")
