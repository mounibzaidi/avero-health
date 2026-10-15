"""The quote check on a sample PDF built here (made-up text only: no clinical content). Needs pdftotext (poppler-utils)."""

import shutil

import pytest
from fastapi.testclient import TestClient

from app import checks, quotecheck
from app import supabase as sb
from app.main import app

pytestmark = pytest.mark.skipif(shutil.which("pdftotext") is None, reason="pdftotext absent: sudo apt install poppler-utils")

# Printed pages 10, 11, 12 are PDF pages 1, 2, 3: page_offset = PDF page - printed page.
OFFSET = -9
PAGES = [
    ["Another test page, nothing to see."],
    [
        "The test dose is 12 mg twice daily for seven days in the test popu-",
        "lation, with an age-",
        "adjusted test threshold of 0,5 units.",
        "The test patient says ’ok’ and “fine” to the test.",
    ],
    ["Only on page three: a unique test sentence lives here."],
]


def _pdf(pages: list[list[str]]) -> bytes:
    """A minimal PDF, one Helvetica line per entry, WinAnsi text (curly quotes included)."""
    def esc(s: str) -> bytes:
        return s.encode("cp1252").replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")

    objs: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]
    kids = []
    for lines in pages:
        stream = b"BT /F1 11 Tf 72 720 Td 14 TL " + b" ".join(b"(" + esc(l) + b") Tj T*" for l in lines) + b" ET"
        objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        objs.append(b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>" % len(objs))
        kids.append(len(objs))
    objs[1] = b"<< /Type /Pages /Kids [" + b" ".join(b"%d 0 R" % k for k in kids) + b"] /Count %d >>" % len(kids)
    out, offsets = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1) + b"".join(b"%010d 00000 n \n" % o for o in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


@pytest.fixture(scope="module")
def text() -> quotecheck.PdfText:
    return quotecheck.PdfText.from_bytes(_pdf(PAGES))


def check(text, quote, page=11):
    return quotecheck.check_quote(text, quote, page, OFFSET)


def test_found_on_its_page_with_the_offset(text):
    r = check(text, "The test dose is 12 mg twice daily")
    assert r.found and r.pdf_page == 2


def test_word_cut_by_a_line_end_hyphen(text):
    assert check(text, "seven days in the test population").found


def test_real_hyphen_at_a_line_end(text):
    assert check(text, "with an age-adjusted test threshold").found


def test_quotes_and_whitespace_do_not_matter(text):
    assert check(text, 'The test   patient says \'ok\' and "fine"\n to the test.').found


def test_number_inside_a_larger_number_is_not_found(text):
    r = check(text, "adjusted test threshold of 5 units")
    assert not r.found and r.message == "absente de la page 11"


def test_quote_on_another_page(text):
    r = check(text, "a unique test sentence lives here")
    assert not r.found and r.message == "trouvée page 12, pas page 11"


def test_not_found_too_short_and_out_of_the_document(text):
    assert check(text, "this sentence is in no page at all").message == "absente de la page 11"
    assert check(text, "test").message == "citation trop courte pour être vérifiée"
    assert not check(text, "The test dose is 12 mg", page=40).found


def test_endpoint_returns_found_or_not_per_evidence(monkeypatch):
    body = _pdf(PAGES)
    monkeypatch.setattr(checks.sb, "rest", lambda *a, **k: [{"source_id": "src-test", "pdf_path": "t/test.pdf"}])
    monkeypatch.setattr(checks.sb, "download", lambda caller, path: body if path == "t/test.pdf" else None)
    checks._TEXT.clear()
    app.dependency_overrides[sb.require_admin] = lambda: sb.Caller(uid="u", token="t")
    try:
        r = TestClient(app).post("/checks/quotes", json={
            "sources": [{"id": "src-test", "page_offset": OFFSET}, {"id": "src-sans-pdf", "page_offset": 0}],
            "evidence": [
                {"key": "t-1#0", "source_id": "src-test", "page": 11, "quote": "seven days in the test population"},
                {"key": "t-1#1", "source_id": "src-test", "page": 10, "quote": "seven days in the test population"},
                {"key": "t-2#0", "source_id": "src-sans-pdf", "page": 1, "quote": "a quote of a source without a PDF"},
                {"key": "t-3#0", "source_id": "src-test", "page": None, "quote": ""},
            ],
        })
    finally:
        app.dependency_overrides.clear()
    assert r.status_code == 200
    got = {x["key"]: (x["found"], x["message"]) for x in r.json()["results"]}
    assert got == {
        "t-1#0": (True, None),
        "t-1#1": (False, "trouvée page 11, pas page 10"),
        "t-2#0": (False, "aucun PDF associé à cette source"),
        "t-3#0": (False, "page ou citation manquante"),
    }
