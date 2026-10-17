"""Fiche generation (app/fichegen), offline: recorded raw layers of the 2025 ACC/AHA ACS guideline
(tests/fixtures/acs_2025_raw.json, from pdftotext -layout) and made-up section answers. No API is called.
The live acceptance run (LlamaParse + Claude) records tests/fixtures/acs_2025_live.json; its tests skip until then."""

import copy
import json
from pathlib import Path

import pytest

from app.fichegen import assemble, check, ingest
from app.fichegen.schema import validate

FIX = Path(__file__).resolve().parent / "fixtures"
RAW = json.loads((FIX / "acs_2025_raw.json").read_text(encoding="utf-8"))
LIVE = FIX / __import__("os").environ.get("FICHEGEN_LIVE", "acs_2025_live.json")  # another recording: FICHEGEN_LIVE=<file>


def page(printed: int) -> dict:
    text = RAW["pages"][str(printed)]
    return {"raw_layout": text, "raw_columns": ingest.split_columns(text), "parsed": "", "parsed_figures": []}


# ─── Part A ──────────────────────────────────────────────────────────────────────────────────────


def test_offset_pdf_page_1_is_printed_2135():
    pages = ["\n".join(e["lines"]) for e in RAW["edges"]]
    offset, consistent = ingest.detect_offset(pages)
    assert consistent and 1 + offset == 2135


def test_raw_layer_of_2163_has_the_ufh_line():
    assert check.check("Loading dose 60 IU/kg (max 4,000 IU)", page(2163)) == "pdf"


def test_two_column_pages_are_split_and_table_pages_kept():
    p = page(2168)  # two columns of text
    assert ingest.gutter(p["raw_layout"].split("\n")) is not None and p["raw_columns"] != p["raw_layout"]
    t = page(2157)  # a full-width dose table: no gutter, left as is
    assert ingest.gutter(t["raw_layout"].split("\n")) is None and t["raw_columns"] == t["raw_layout"]


# ─── Part C ──────────────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("quote,printed", [
    ("Loading dose 180 mg orally", 2157),
    ("PR interval >0.24 milliseconds", 2168),
    ("Start at 10 µg/min and titrate to pain relief", 2154),
    ("a 12-lead ECG should be acquired [...] within 10 minutes of first medical contact", 2147),
])
def test_quotes_found_on_their_printed_page(quote, printed):
    assert check.check(quote, page(printed)) == "pdf"


def test_fragments_must_keep_their_order():
    assert check.check("within 10 minutes of first medical contact [...] a 12-lead ECG should be acquired", page(2147)) == "failed"


def test_wrong_page_fails():
    assert check.check("Loading dose 60 IU/kg (max 4,000 IU)", page(2147)) == "failed"


def test_glyph_substitutions_and_table_tokens():
    assert check.normalise("≤ 90 min") == check.normalise("# 90 min")
    assert check.normalise("10 µg") == check.normalise("10 mg")
    assert check.normalise("aspirin is\n1 B-R\nrecommended") == check.normalise("aspirin is recommended")


def test_parsed_layer_used_when_raw_misses():
    p = {"raw_layout": "nothing here", "raw_columns": "", "parsed": "| GRACE Risk Score >140 | early |", "parsed_figures": []}
    assert check.check("GRACE Risk Score >140", p) == "parsed"


# ─── Schema and assembly ─────────────────────────────────────────────────────────────────────────

FORM = {"title": "SCA (test)", "topic_id": "sca-test", "template": "urgence", "audience": ["MG", "urgences"],
        "source": {"source_id": "accaha2025", "type": "full_guideline", "title": "2025 ACC/AHA ACS", "citation": "Rao SV et al. JACC 2025"},
        "licence_text": "internal", "licence_scope": "internal"}


def line(text, quote, page=2157, **kw):
    return {"text": text, "type": "action", "condition": None, "source": {"page": page, "quote": quote}, "from_figure": False,
            "grade": None, "risk": "high", "origin": "explicit", "missing": [], **kw}


def dose(dci, d, quote):
    return {"drug_dci": dci, "dose": d, "dose_max": None, "route": "orale", "administration": None, "frequency_or_duration": "dose de charge",
            "condition": None, "source": {"page": 2157, "quote": quote}, "from_figure": False, "missing": [], "note": None}


def build(kept, answers=None):
    return assemble.assemble(FORM, answers or {}, kept, ["salle de cathétérisme"])


def ok(meta_status="pdf"):
    return {"quote_status": meta_status, "from_figure": False, "retries": 0, "model": "claude-haiku-5-5"}


def test_assembled_fiche_is_valid_and_ids_assigned():
    kept = {"1_essentiel": [("elements", line("DAPT pour tout SCA.", "Dual antiplatelet therapy is recommended"), ok())],
            "7_traitement": [("posologies", dose("ticagrélor", "180 mg", "Loading dose 180 mg orally"), ok())]}
    fiche, side, dropped = build(kept)
    assert validate(fiche) == []
    el = fiche["sections"]["1_essentiel"]["elements"][0]
    assert el["id"] == "sca-test-001" and el["source"]["source_id"] == "accaha2025" and el["translated"] is True
    d = fiche["sections"]["7_traitement"]["posologies"][0]
    assert d["algerie"] == {"brands": [], "statut": None} and "algerie.statut" in d["missing"]
    assert fiche["meta"]["quote_check"] == "2/2" and fiche["meta"]["excluded_by_audience"] == ["salle de cathétérisme"]
    assert "quote_status" not in json.dumps(fiche)  # pipeline data stays out of the fiche
    assert side["sca-test-001"]["quote_status"] == "pdf"


def test_statut_null_allowed_only_in_draft():
    kept = {"7_traitement": [("posologies", dose("ticagrélor", "180 mg", "Loading dose 180 mg orally"), ok())]}
    fiche, _, _ = build(kept)
    assert validate(fiche) == []
    reviewed = copy.deepcopy(fiche)
    reviewed["meta"]["status"] = "review"
    assert any("algerie/statut" in p for p in validate(reviewed))
    reviewed["sections"]["7_traitement"]["posologies"][0]["algerie"]["statut"] = "Enregistré"
    assert validate(reviewed) == []


def test_extra_key_rejected():
    fiche, _, _ = build({})
    fiche["meta"]["quote_status"] = "x"
    assert validate(fiche)


def test_branches_get_their_order():
    answers = {"5_conduite": {"state": "filled", "nodes": [{"node": "STEMI", "branches": []}]}}
    kept = {"5_conduite": [("node:0", line("A.", "quote a"), ok()), ("node:0", line("B.", "quote b"), ok())]}
    fiche, _, _ = build(kept, answers)
    assert [b["order"] for b in fiche["sections"]["5_conduite"]["nodes"][0]["branches"]] == [1, 2]


def test_duplicate_kept_in_its_rule_4_section():
    q = "routine administration of supplemental oxygen is not recommended"
    kept = {"7_traitement": [("elements", line("Pas d'oxygène systématique.", q), ok())],
            "8_ne_pas_faire": [("elements", line("Pas d'oxygène systématique.", q), ok())]}
    fiche, _, dropped = build(kept)
    assert fiche["sections"]["8_ne_pas_faire"]["elements"] and not fiche["sections"]["7_traitement"]["elements"]
    assert len(fiche["sections"]["8_ne_pas_faire"]["elements"]) == 1 and len(dropped) == 1  # moved by rule 4, kept once


# ─── Live acceptance run (recorded once, then offline) ───────────────────────────────────────────


def live() -> dict:
    if not LIVE.exists():
        pytest.skip("pas d'enregistrement du run réel : lancer tests/record_fichegen.py")
    return json.loads(LIVE.read_text(encoding="utf-8"))


def test_live_quote_check_at_least_95_percent():
    x, y = map(int, live()["fiche"]["meta"]["quote_check"].split("/"))
    assert y and x / y >= 0.95


def test_live_no_ecg_or_troponin_outside_examens():
    secs = live()["fiche"]["sections"]
    for name, sec in secs.items():
        if name == "6_examens":
            continue
        for el in [e for v in sec.values() if isinstance(v, list) for e in v if isinstance(e, dict) and "text" in e]:
            assert not any(w in el["text"] for w in ("ECG", "troponine")), (name, el["text"])


@pytest.mark.parametrize("words", [["oxygène"], ["prasugrel"], ["fibrinolyse", "sous-décalage"], ["PDE5"], ["fondaparinux"]])
def test_live_do_not_lines(words):
    texts = [e["text"] for e in live()["fiche"]["sections"]["8_ne_pas_faire"]["elements"]]
    assert any(all(w.lower() in t.lower() for w in words) for t in texts), words


def test_live_beta_blocker_unit_flagged():
    els = [e for s in live()["fiche"]["sections"].values() for v in s.values() if isinstance(v, (list, dict))
           for e in (v if isinstance(v, list) else v.get("elements", [])) if isinstance(e, dict) and "0.24 milliseconds" in e.get("source", {}).get("quote", "")]
    assert els and any(e["missing"] for e in els)


def test_live_micrograms_kept():
    doses = live()["fiche"]["sections"]["7_traitement"]["posologies"]
    for name in ("nitro", "fentanyl"):
        hits = [d for d in doses if name in d["drug_dci"].lower()]
        assert hits and any(("µg" in d["dose"] or "μg" in d["dose"]) for d in hits), name  # micro sign or Greek mu


def test_wrong_page_corrected_by_code_without_a_retry():
    from app.fichegen import pipeline
    pages = {n: {**page(n), "printed_page": n} for n in (2147, 2163)}
    answer = {"state": "filled", "elements": [line("HNF : charge 60 UI/kg.", "Loading dose 60 IU/kg (max 4,000 IU)", page=2147)]}
    calls = []
    lines = pipeline._section_lines("7_traitement", answer, pages, "claude-haiku-5-5", {"7_traitement": list(pages.values())},
                                    "MG", FORM["source"], calls.append, [])
    assert lines[0][1]["source"]["page"] == 2163 and lines[0][2]["quote_status"] == "pdf" and not calls
