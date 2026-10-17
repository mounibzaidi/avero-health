"""Part A: a PDF's two text layers, per page, and its printed page numbers.

- raw (free): `pdftotext -layout` per page, and a column-split copy (each line cut at the gutter, left then right);
- parsed: LlamaParse markdown, only for the pages that need it (tables or figures among the pages the routing kept;
  references, author lists and relationship-with-industry appendices never), sent as one sub-PDF. Tier
  "cost_effective" by default (3 credits a page: the cheapest tier that reads charts and keeps tables;
  LLAMAPARSE_TIER in .env.local for "agentic"). The other pages use the column-split text. Blocks that come from a
  figure or an image are flagged.
Printed pages come from the running header or footer of the raw layer ("2136 Rao et al", "Rao et al 2137"): the offset
that most pages agree on. Layers are stored once per PDF (by its sha256) in the table pdf_pages.
"""

import re
import subprocess
import tempfile
from datetime import datetime, timezone
from collections import Counter
from pathlib import Path

from ..settings import env

DEFAULT_TIER = "cost_effective"


def raw_pages(pdf: Path) -> list[str]:
    """pdftotext -layout, one string per PDF page."""
    out = subprocess.run(["pdftotext", "-enc", "UTF-8", "-layout", str(pdf), "-"], capture_output=True, check=True, timeout=300)
    pages = out.stdout.decode("utf-8", errors="replace").split("\f")
    return pages[:-1] if pages and not pages[-1].strip() else pages


def gutter(lines: list[str]) -> int | None:
    """The character position, in the middle of the page, where most text lines have whitespace: the column gutter
    of a two-column page. None for a one-column page."""
    long = [l for l in lines if len(l.rstrip()) > 60]
    if len(long) < 8:
        return None
    width = max(len(l) for l in long)
    best, best_share = None, 0.0
    for pos in range(int(width * 0.3), int(width * 0.7)):
        blank = sum(1 for l in long if pos >= len(l) or l[pos - 1: pos + 2].strip() == "")
        share = blank / len(long)
        if share > best_share:
            best, best_share = pos, share
    return best if best_share >= 0.8 else None


def split_columns(page: str) -> str:
    """The page with two columns read left then right; a one-column page unchanged."""
    lines = page.split("\n")
    g = gutter(lines)
    if g is None:
        return page
    left = [l[:g].rstrip() for l in lines]
    right = [l[g:].strip() for l in lines]
    return "\n".join([*left, *right])


_EDGE_NUMBER = re.compile(r"(?<![\d.,/-])(\d{1,5})(?![\d.,/%-])")


def detect_offset(pages: list[str]) -> tuple[int | None, bool]:
    """(offset, consistent): printed page = PDF page (1-based) + offset, from the numbers in each page's first and
    last lines. Consistent when at least 60 % of the pages with a candidate agree."""
    votes: Counter[int] = Counter()
    voters = 0
    for i, page in enumerate(pages, start=1):
        lines = [l for l in page.split("\n") if l.strip()]
        edge = lines[:2] + lines[-2:]
        candidates = {int(m.group(1)) - i for l in edge for m in _EDGE_NUMBER.finditer(l) if 0 < int(m.group(1)) < 100000}
        if candidates:
            voters += 1
            votes.update(candidates)
    if not votes:
        return None, False
    offset, n = votes.most_common(1)[0]
    return offset, voters > 0 and n / voters >= 0.6


_FIGURE = re.compile(r"^\s*(!\[[^\]]*\]\([^)]*\)|<figure|\*\*?figure\s+\d+|figure\s+\d+[.:])", re.I | re.M)


def figure_blocks(markdown: str) -> list[str]:
    """The markdown blocks of a page that come from a figure or an image (image links, "Figure N" captions and the
    block that follows them)."""
    blocks = [b for b in re.split(r"\n\s*\n", markdown) if b.strip()]
    out = []
    for i, b in enumerate(blocks):
        if _FIGURE.search(b):
            out.append(b)
            if i + 1 < len(blocks):
                out.append(blocks[i + 1])
    return out


_SKIP = re.compile(r"\b(references|relationships? with industry|author relationships|peer reviewer relationships|"
                   r"writing committee|appendix \d+\.?\s*(author|reviewer))\b", re.I)
_REF_LINE = re.compile(r"^\s*\d{1,3}\.\s+[A-Z][A-Za-z'’-]+\s+[A-Z]{1,3}[,.]")
_CAPTION = re.compile(r"^\s*(Figure|Table)\s+\d+", re.I | re.M)


def skip_page(text: str) -> bool:
    """References, author lists and relationship-with-industry appendices: never routed, never parsed."""
    lines = [l for l in text.split("\n") if l.strip()]
    if not lines:
        return True
    if any(_SKIP.search(l) and len(l.strip()) < 90 for l in lines[:6]):
        return True
    refs = sum(1 for l in lines for part in re.split(r"\s{3,}", l) if _REF_LINE.match(part))
    return refs >= 0.3 * len(lines)


def images_per_page(pdf: Path) -> dict[int, int]:
    """Images large enough to be a figure (over 150 px a side), by PDF page."""
    out = subprocess.run(["pdfimages", "-list", str(pdf)], capture_output=True, text=True, timeout=120).stdout.splitlines()[2:]
    counts: dict[int, int] = {}
    for row in out:
        cols = row.split()
        if len(cols) > 4 and cols[0].isdigit() and int(cols[3]) > 150 and int(cols[4]) > 150:
            counts[int(cols[0])] = counts.get(int(cols[0]), 0) + 1
    return counts


_TABLE = re.compile(r"^\s*Table\s+\d+", re.I | re.M)
_FIGURE_CAPTION = re.compile(r"^\s*Figure\s+\d+", re.I | re.M)
_HEADING = re.compile(r"^\s*(\d+(?:\.\d+){1,4})\.?\s{1,3}([A-Z][^\n]{3,90}?)\s*$")


def has_table(text: str) -> bool:
    """A numbered table ("Table 6"): recommendation tables (COR, LOE) are text that pdftotext reads well."""
    return bool(_TABLE.search(text))


def has_figure(text: str, images: int) -> bool:
    return bool(images) or bool(_FIGURE_CAPTION.search(text))


def heading(text: str) -> str | None:
    """The last numbered section heading on the page ("4.3.1. Aspirin"), read in column order."""
    found = [f"{m.group(1)} {m.group(2).strip()}" for l in text.split("\n") if (m := _HEADING.match(l))]
    return found[-1] if found else None


def llamaparse_cost(pages: int, tier: str | None = None) -> float:
    from .llm import PRICES

    lp = PRICES["llamaparse"]
    return round(pages * lp["tiers"].get(tier or tier_name(), 3) * lp["credit_usd"], 6)


def tier_name() -> str:
    return env().get("LLAMAPARSE_TIER") or DEFAULT_TIER


def llamaparse_pages(pdf_bytes: bytes, filename: str, pdf_pages: list[int]) -> dict[int, str]:
    """LlamaParse markdown of these PDF pages only, sent as one sub-PDF: {pdf page: markdown}."""
    if not pdf_pages:
        return {}
    with tempfile.TemporaryDirectory() as tmp:
        src = Path(tmp) / "src.pdf"
        src.write_bytes(pdf_bytes)
        parts = []
        for n in pdf_pages:
            part = Path(tmp) / f"p{n:05d}.pdf"
            subprocess.run(["pdfseparate", "-f", str(n), "-l", str(n), str(src), str(part)], check=True, timeout=60)
            parts.append(str(part))
        sub_pdf = Path(tmp) / "sub.pdf"
        if len(parts) == 1:
            sub_pdf = Path(parts[0])
        else:
            subprocess.run(["pdfunite", *parts, str(sub_pdf)], check=True, timeout=120)
        md = llamaparse(sub_pdf.read_bytes(), filename)
    return {n: md[i] if i < len(md) else "" for i, n in enumerate(pdf_pages)}


def llamaparse(pdf_bytes: bytes, filename: str) -> list[str]:
    """LlamaParse markdown per PDF page (index 0 = page 1). Raises when the job or a page fails: no partial layer."""
    from llama_cloud import LlamaCloud

    key = env().get("LLAMA_CLOUD_API_KEY")
    if not key:
        raise RuntimeError("LLAMA_CLOUD_API_KEY manquant dans .env.local")
    client = LlamaCloud(api_key=key)
    file = client.files.create(file=(filename, pdf_bytes, "application/pdf"), purpose="parse")
    result = client.parsing.parse(tier=tier_name(), version="latest", file_id=file.id, expand=["markdown"])
    if result.job.status != "COMPLETED":
        raise RuntimeError(f"LlamaParse : {result.job.status} {result.job.error_message}")
    out: dict[int, str] = {}
    for page in result.markdown.pages:
        if not page.success:
            raise RuntimeError(f"LlamaParse : page {page.page_number} en échec ({page.error})")
        out[page.page_number] = page.markdown or ""
    return [out.get(i, "") for i in range(1, max(out, default=0) + 1)]


def page_rows(pdf_bytes: bytes, document_id: str) -> tuple[list[dict], int | None, bool]:
    """The free layers of every page, as document_pages rows, and the detected offset (offset, consistent)."""
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(pdf_bytes)
        f.flush()
        raw = raw_pages(Path(f.name))
        images = images_per_page(Path(f.name))
    offset, consistent = detect_offset(raw)
    rows, last = [], None
    for i, text in enumerate(raw, start=1):
        cols = split_columns(text)
        last = heading(cols) or last
        rows.append({"document_id": document_id, "pdf_page": i, "printed_page": i + offset if offset is not None else None,
                     "raw_text": text, "raw_columns": cols, "parsed_md": None, "parser": "pdftotext", "has_table": has_table(text),
                     "has_figure": has_figure(text, images.get(i, 0)), "skipped": skip_page(text), "section_heading": last, "parsed_at": None})
    return rows, offset, consistent


def ensure_pages(store, document_id: str, pdf_bytes) -> tuple[list[dict], int | None, bool]:
    """The document's pages from document_pages; the free layers computed and stored the first time only.
    `pdf_bytes` is a function, called only when the PDF must be read."""
    rows = store.pages(document_id)
    if rows:
        first = next((r for r in rows if r["printed_page"] is not None), None)
        return rows, (first["printed_page"] - first["pdf_page"]) if first else None, first is not None
    rows, offset, consistent = page_rows(pdf_bytes(), document_id)
    store.save_pages(rows)
    return rows, offset, consistent


def parse_pages(store, rows: list[dict], wanted_pdf_pages: set[int], pdf_bytes, filename: str) -> tuple[int, float]:
    """LlamaParse for the wanted pages that hold a table or a figure, are not skipped and have no parsed_md yet (a
    page is never paid twice); rows updated in place and saved. Returns (pages sent, cost in dollars)."""
    todo = [r for r in rows if r["pdf_page"] in wanted_pdf_pages and (r["has_table"] or r["has_figure"]) and not r["skipped"] and r["parsed_md"] is None]
    if not todo:
        return 0, 0.0
    got = llamaparse_pages(pdf_bytes(), filename, [r["pdf_page"] for r in todo])
    when = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for r in todo:
        r["parsed_md"], r["parser"], r["parsed_at"] = got.get(r["pdf_page"], ""), f"llamaparse:{tier_name()}", when
    store.save_pages(todo)
    return len(todo), llamaparse_cost(len(todo))


def as_layers(rows: list[dict], offset: int | None) -> list[dict]:
    """document_pages rows as the pipeline reads them (printed page from the draft's offset)."""
    return [{"pdf_page": r["pdf_page"], "printed_page": r["pdf_page"] + offset if offset is not None else r["printed_page"],
             "raw_layout": r["raw_text"], "raw_columns": r["raw_columns"], "parsed": r["parsed_md"] or "",
             "parsed_figures": figure_blocks(r["parsed_md"] or ""), "skip": r["skipped"], "section_heading": r["section_heading"]} for r in rows]
