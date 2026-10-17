"""Fiche generation (app/fichegen), offline: recorded raw layers of the 2025 ACC/AHA ACS guideline
(tests/fixtures/acs_2025_raw.json, from pdftotext -layout) and made-up section answers. No API is called.
The live acceptance run (LlamaParse + Claude) records tests/fixtures/acs_2025_live.json; its tests skip until then."""

import copy
import json
from pathlib import Path

import pytest

from app.fichegen import assemble, check, coverage, ingest
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


def test_rule_4_exam_condition_branch_stays_in_conduite():
    answers = {"5_conduite": {"state": "filled", "nodes": [{"node": "Douleur thoracique", "branches": []}]}}
    kept = {"5_conduite": [("node:0", line("Si STEMI à l'ECG : reperfusion immédiate.", "quote a"), ok()),
                           ("node:0", line("Stratégie invasive dans les 24 h.", "quote b", condition="troponine élevée"), ok())]}
    fiche, _, _ = build(kept, answers)
    assert len(fiche["sections"]["5_conduite"]["nodes"][0]["branches"]) == 2 and not fiche["sections"]["6_examens"]["elements"]


def test_rule_4_exam_lines_go_to_examens_and_do_not_lines_to_8():
    answers = {"5_conduite": {"state": "filled", "nodes": [{"node": "Arrivée", "branches": []}]}}
    kept = {"5_conduite": [("node:0", line("Réaliser un ECG 12 dérivations dans les 10 minutes.", "quote c"), ok()),
                           ("node:0", line("Pas de fibrinolyse en cas de sous-décalage ST isolé à l'ECG.", "should not be used"), ok())],
            "1_essentiel": [("elements", line("Doser la troponine hs à l'arrivée.", "quote d"), ok()),
                            ("elements", line("En cas de troponine élevée, stratégie invasive.", "quote e"), ok())]}
    fiche, _, _ = build(kept, answers)
    secs = fiche["sections"]
    assert sorted(e["text"][:8] for e in secs["6_examens"]["elements"]) == ["Doser la", "Réaliser"]
    assert [e["text"][:6] for e in secs["8_ne_pas_faire"]["elements"]] == ["Pas de"]  # do-not even with ECG, even from a branch
    assert [e["text"][:8] for e in secs["1_essentiel"]["elements"]] == ["En cas d"]


def test_line_meta_rows_all_have_the_same_keys():
    from app.fichegen import pipeline
    kept = {"7_traitement": [("posologies", dose("ticagrélor", "180 mg", "Loading dose 180 mg orally"), ok())]}
    fiche, side, dropped = build(kept)
    rows = pipeline.meta_rows("d", side, [{"section": "8_ne_pas_faire", "line": line("x", "y"), "reason": "doublon"}], "claude-haiku-5-5")
    assert len(rows) == 2 and len({tuple(sorted(r)) for r in rows}) == 1


# ─── Coverage ────────────────────────────────────────────────────────────────────────────────────


def cpage(printed):
    return {**page(printed), "printed_page": printed, "skip": False}


def test_recommendation_rows_parsed_with_cor_and_loe():
    rows = coverage.rec_rows(RAW["pages"]["2147"], 2147)
    assert [r["number"] for r in rows] == [1, 2, 3, 4] and all(r["cor"] and r["loe"] for r in rows)
    assert rows[1]["text"].startswith("2. In patients with suspected ACS in which the initial ECG is non-diagnostic")
    assert rows[2]["loe"] == "B-NR" and "PCI-capable hospital" in rows[2]["text"]


def test_dose_rows_carry_the_drug_down():
    rows = coverage.dose_rows(RAW["pages"]["2157"], 2157)
    tica = [r for r in rows if r["drug"] == "Ticagrelor"]
    assert [r["doses"] for r in tica] == [["180mg"], ["90mg"]]
    assert {r["drug"] for r in rows} == {"Aspirin", "Clopidogrel", "Prasugrel", "Ticagrelor"}


def test_rows_matched_by_quote_overlap():
    rows = coverage.rows_of([cpage(2147), cpage(2157)])
    rec = next(r for r in rows if r["kind"] == "rec" and r["number"] == 3)
    tica = next(r for r in rows if r["kind"] == "dose" and r["drug"] == "Ticagrelor" and r["doses"] == ["180mg"])
    items = [{"section": "9_orientation", "page": 2147, "quote": "immediate emergency medical services (EMS) transport to a PCI-capable hospital", "extra": ""},
             {"section": "7_traitement", "page": 2157, "quote": "Loading dose 180 mg orally", "extra": "180 mg", "dose": True}]
    hits = coverage.match(rows, items)
    assert hits[rec["id"]] == [0] and hits[tica["id"]] == [1]
    assert coverage.report(rows, items, set())["matched"] == 2
    items[1]["dose"] = False  # a dose only in an element's text does not cover a dose row
    assert tica["id"] not in coverage.match(rows, items)


def test_posology_wins_over_the_same_dose_as_an_element():
    q = "Loading dose 180 mg orally"
    kept = {"7_traitement": [("elements", line("Ticagrélor : charge 180 mg.", q), ok()), ("posologies", dose("ticagrélor", "180 mg", q), ok())]}
    fiche, _, dropped = build(kept)
    assert fiche["sections"]["7_traitement"]["posologies"] and not fiche["sections"]["7_traitement"]["elements"] and len(dropped) == 1


def test_harm_rows_moved_to_ne_pas_faire():
    rows = [{"id": 0, "kind": "rec", "page": 2156, "number": 2, "cor": "3: Harm", "loe": "B-R",
             "text": "2. In patients with a history of stroke or transient ischemic attack, prasugrel should not be administered because of worse net clinical outcomes."}]
    kept = {"7_traitement": [("contre_indications", line("Prasugrel contre-indiqué après AVC ou AIT.", "prasugrel should not be administered because of worse net clinical outcomes"), ok())]}
    assert coverage.harm_to_8(rows, kept) == 1
    assert not kept["7_traitement"] and kept["8_ne_pas_faire"][0][0] == "elements"
    assert coverage.section_for(rows[0], {}) == "8_ne_pas_faire"


# ─── Live acceptance run (recorded once, then offline) ───────────────────────────────────────────


def live() -> dict:
    if not LIVE.exists():
        pytest.skip("pas d'enregistrement du run réel : lancer tests/record_fichegen.py")
    return json.loads(LIVE.read_text(encoding="utf-8"))


def test_live_quote_check_at_least_95_percent():
    x, y = map(int, live()["fiche"]["meta"]["quote_check"].split("/"))
    assert y and x / y >= 0.95


def test_live_exam_lines_only_in_examens():
    """Rule 4: a line about performing or reading an ECG or biology is in 6_examens; a 5_conduite branch may have an
    exam result as its condition; do-not lines are in 8 whatever they mention."""
    secs = live()["fiche"]["sections"]
    for name, sec in secs.items():
        if name in ("6_examens", "8_ne_pas_faire"):
            continue
        lists = [v for v in sec.values() if isinstance(v, list)] + [v["elements"] for v in sec.values() if isinstance(v, dict) and "elements" in v]
        branches = [b for n in sec.get("nodes") or [] for b in n["branches"]]
        for el in [e for lst in lists for e in lst if isinstance(e, dict) and "text" in e]:
            assert not assemble.is_exam(el), (name, el["text"])
        for b in branches:
            assert not assemble.is_exam(b) or assemble.exam_condition(b), (name, b["text"])


def test_live_coverage_reported():
    cov = live()["report"]["coverage"]
    assert cov["rows"] and cov["harm_in_8"] == cov["harm_rows"]


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


def test_cost_cap_blocks_paid_calls_and_fallback_is_off_by_default():
    from app.fichegen import llm, pipeline
    budget = pipeline.Budget(lambda e: None, 0.10)
    budget({"cost_usd": 0.09})
    assert budget.tight() and not budget.over()
    budget({"cost_usd": 0.02})
    with pytest.raises(llm.BudgetExceeded):
        llm.call({"model": "claude-haiku-5-5"}, budget, "section")  # refused before any request is sent
    assert pipeline.fallback_model() is None or "FICHEGEN_FALLBACK_MODEL" in __import__("app.settings", fromlist=["env"]).env()


# ─── Manual select-to-add ────────────────────────────────────────────────────────────────────────


def test_grade_next_to_a_selection_acc_and_esc():
    from app.fichegen import manual
    acc = {**page(2147), "printed_page": 2147}
    assert manual.grade_near(acc, "immediate emergency medical services (EMS) transport to a PCI-capable hospital") == "COR 1 / LOE B-NR"
    esc = {"printed_page": 3920, "raw_layout": (
        " It is recommended to measure BP using a validated and calibrated device, to enforce the correct measurement technique, and to apply a\n"
        "                                                                                                         I           B\n"
        " consistent approach to BP measurement for each patient.\n")}
    assert manual.grade_near(esc, "It is recommended to measure BP using a validated and calibrated device") == "Classe I / Niveau B"
    assert manual.grade_near(esc, "nothing like this on the page") is None


def test_propose_keeps_the_selected_quote_and_runs_the_checks(monkeypatch):
    from app.fichegen import llm, manual
    fiche, _, _ = build({"8_ne_pas_faire": [("elements", line("Pas d'oxygène systématique.", "Loading dose 180 mg orally"), ok())]})
    draft = {"content": fiche, "form": FORM}
    pages = {2157: {**page(2157), "printed_page": 2157}, 2163: {**page(2163), "printed_page": 2163}}
    monkeypatch.setattr(llm, "call", lambda *a, **k: {"text": "Ne pas donner de ticagrélor.", "type": "action", "condition": None, "grade": None,
                                                       "risk": "high", "missing": []})
    parts = [{"page": 2157, "text": "Loading dose 180 mg\n orally"}, {"page": 2163, "text": "Loading dose 60 IU/kg (max 4,000 IU)"}]
    out = manual.propose(None, draft, pages, {"section": "7_traitement", "place": "elements"}, parts, lambda e: None, fill=True)
    assert out["line"]["source"] == {"source_id": "accaha2025", "page": 2157, "quote": "Loading dose 180 mg orally [...] Loading dose 60 IU/kg (max 4,000 IU)"}
    assert out["quote_status"] == "pdf" and out["part_status"] == ["pdf", "pdf"] and out["problems"] == []
    assert out["placement"]["section"] == "8_ne_pas_faire"  # rule 4: a do-not line
    out = manual.propose(None, draft, pages, {"section": "7_traitement", "place": "elements"}, parts[:1], lambda e: None, fill=True)
    assert out["duplicate"]["section"] == "8_ne_pas_faire"


def test_manual_card_is_blank_and_free_by_default(monkeypatch):
    from app.fichegen import llm, manual
    fiche, _, _ = build({})
    pages = {2157: {**page(2157), "printed_page": 2157}}

    def paid(*a, **k):
        raise AssertionError("no model call without fill")

    monkeypatch.setattr(llm, "call", paid)
    out = manual.propose(None, {"content": fiche, "form": FORM}, pages, {"section": "7_traitement", "place": "posologies"},
                         [{"page": 2157, "text": "Loading dose 180 mg orally"}], lambda e: None)
    line = out["line"]
    assert line["source"]["quote"] == "Loading dose 180 mg orally" and out["quote_status"] == "pdf"
    assert (line["dose"], line["route"], line["frequency_or_duration"]) == ("180 mg", "orale", "dose de charge")  # by code
    assert "algerie.statut" in line["missing"]


def test_code_prefill_of_doses_and_french_lines():
    from app.fichegen import manual
    d = manual.prefill_dose("Loading dose 60 IU/kg (max 4,000 IU), with initial infusion 12 IU/kg per h", "UFH")
    assert (d["drug_dci"], d["dose"], d["dose_max"]) == ("héparine non fractionnée", "60 IU/kg", "4,000 IU")
    d = manual.prefill_dose("Maintenance dose 90 mg orally twice daily", "Ticagrelor")
    assert (d["drug_dci"], d["frequency_or_duration"]) == ("ticagrélor", "entretien, 2 fois par jour")
    assert manual.inn_fr("Atorvastatin") == "atorvastatine"
    e = manual.prefill_element("Chez les patients en état de choc, une coronarographie immédiate est recommandée.", "5_conduite")
    assert e["condition"] == "Chez les patients en état de choc" and e["type"] == "conditional" and e["text"].startswith("Chez")
    assert manual.prefill_element("In patients with STEMI, aspirin is recommended.", "6_examens")["text"] == ""  # English: typed in French


def test_esc_rows_with_class_and_level():
    layout = (" It is recommended to measure BP using a validated and calibrated device, to enforce the correct measurement technique, and to apply a\n"
              "                                                                                                                       I           B\n"
              " consistent approach to BP measurement for each patient.\n"
              " Coronary artery calcium scoring may be considered in patients with elevated BP or hypertension when it is likely.   IIb      B\n"
              " Renal denervation is not recommended as a first-line BP-lowering intervention for hypertension.                       III      C\n")
    rows = coverage.esc_rows(layout, 3920)
    assert [(r["cor"], r["loe"]) for r in rows] == [("I", "B"), ("IIb", "B"), ("III", "C")]
    assert rows[0]["text"].endswith("for each patient.") and coverage.HARM.match(rows[2]["cor"])


def test_suggestions_merged_into_a_started_fiche():
    q1, q2 = "Loading dose 180 mg orally", "Maintenance dose 90 mg orally twice daily"
    old, _, _ = build({"7_traitement": [("elements", line("Charge 180 mg.", q1), ok())]})
    new, side, _ = build({"7_traitement": [("elements", line("Charge 180 mg (doublon).", q1), ok()), ("elements", line("Entretien 90 mg x2.", q2), ok())]})
    merged, keyed = assemble.merge(old, new, side)
    els = merged["sections"]["7_traitement"]["elements"]
    assert [e["text"] for e in els] == ["Charge 180 mg.", "Entretien 90 mg x2."] and [e["id"] for e in els] == ["sca-test-001", "sca-test-002"]
    assert list(keyed) == ["sca-test-002"] and validate(merged) == []
