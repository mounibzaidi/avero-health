"""The quote check of a fiche (Protocol v1.1): each evidence quote on its cited page of the source's stored PDF
(quotecheck.py). The dashboard sends the evidence with a key per line and index (quoteKey in packages/schema), and
gets found / not found per key back. Admin only."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from . import quotecheck
from . import supabase as sb

router = APIRouter(prefix="/checks", tags=["checks"])

_TEXT: dict[str, quotecheck.PdfText] = {}  # stored PDF path -> its text (a stored file never changes: its name holds its hash)


class SourceIn(BaseModel):
    id: str
    page_offset: int = 0


class EvidenceIn(BaseModel):
    key: str
    source_id: str
    page: int | None
    quote: str


class QuotesIn(BaseModel):
    subject_id: str  # the fiche: a source's PDF is the one linked for this fiche
    sources: list[SourceIn]
    evidence: list[EvidenceIn]


def _pdf(caller: sb.Caller, path: str) -> quotecheck.PdfText | None:
    if path not in _TEXT:
        body = sb.download(caller, path)
        if body is None:
            return None
        _TEXT[path] = quotecheck.PdfText.from_bytes(body)
    return _TEXT[path]


@router.post("/quotes")
def quotes(body: QuotesIn, caller: sb.Caller = Depends(sb.require_admin)):
    offsets = {s.id: s.page_offset for s in body.sources}
    ids = sorted({e.source_id for e in body.evidence if e.source_id})
    rows = sb.rest(caller, "GET", "source_pdfs", {"select": "source_id,pdf_path", "subject_id": f"eq.{body.subject_id}", "source_id": f"in.({','.join(ids)})"}) if ids else []
    paths = {r["source_id"]: r["pdf_path"] for r in rows or []}

    results = []
    for e in body.evidence:
        def out(found: bool, message: str | None, pdf_page: int | None = None, score: int | None = None):
            results.append({"key": e.key, "found": found, "pdf_page": pdf_page, "message": message, "score": score})

        if e.source_id not in offsets:
            out(False, "source not in the fiche")
        elif e.page is None or not e.quote.strip():
            out(False, "page or quote missing")
        elif e.source_id not in paths:
            out(False, "no PDF linked to this source")
        elif (text := _pdf(caller, paths[e.source_id])) is None:
            out(False, f"PDF not found in storage: {paths[e.source_id]}")
        else:
            r = quotecheck.check_quote(text, e.quote, e.page, offsets[e.source_id])
            out(r.found, r.message, r.pdf_page, r.score)
    return {"checked": len(results), "found": sum(r["found"] for r in results), "results": results}
