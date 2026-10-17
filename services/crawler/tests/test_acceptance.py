"""Acceptance tests of the guideline search (task spec, part C), on recorded searches (tests/fixtures/<topic>.json,
written by tests/record_fixture.py). Offline and free; re-record to test the live pipeline."""

import json
import re
from datetime import date
from pathlib import Path

import pytest

FIXTURES = Path(__file__).resolve().parent / "fixtures"
CRAWL_STATUSES = re.compile(r"^(trouvé \(\d+\)|applique .+|crawlé, rien trouvé|site inaccessible|non crawlable \(ajout manuel\))$")


def load(topic: str) -> dict:
    path = FIXTURES / f"{topic}.json"
    if not path.exists():
        pytest.skip(f"pas d'enregistrement pour {topic} : lancer tests/record_fixture.py {topic}")
    return json.loads(path.read_text(encoding="utf-8"))


def section(result: dict, sid: str) -> dict:
    return next(s for s in result["sections"] if s["id"] == sid)


def heads(result: dict, sid: str) -> list[dict]:
    return [f["versions"][0] for f in section(result, sid).get("families") or []]


def where(result: dict, pattern: str) -> list[tuple[str, str | None, bool]]:
    """Every place a title matching `pattern` is shown: (section, article group or None, is the family head)."""
    rx, out = re.compile(pattern, re.I), []
    for s in result["sections"]:
        for f in s.get("families") or []:
            for i, v in enumerate(f["versions"]):
                if rx.search(v["title"]) or rx.search(v.get("title_en") or ""):
                    out.append((s["id"], None, i == 0))
        for g in s.get("groups") or []:
            for r in g["items"]:
                if rx.search(r["title"]) or rx.search(r.get("title_en") or ""):
                    out.append((s["id"], g["label"], True))
    return out


def no_cross_body_banner(result: dict) -> None:
    for s in result["sections"]:
        for f in s.get("families") or []:
            if f.get("newer_elsewhere"):
                assert f["newer_elsewhere"]["body"] == f["versions"][0]["body_name"], f["versions"][0]["title"]


# ─── Syndrome coronarien aigu ────────────────────────────────────────────────────────────────────


def test_acs_international_top_two():
    top = heads(load("acs"), "international")[:2]
    titles = " | ".join(f"{h['body_name']} {h['version_year']} {h['title'][:60]}" for h in top)
    assert any(h["body"] == "esc" and h["version_year"] == 2023 and "acute coronary syndromes" in h["title"].lower() for h in top), titles
    assert any(h["body"] == "aha-acc" and h["version_year"] == 2025 and "acute coronary syndromes" in h["title"].lower() for h in top), titles


def test_acs_no_cross_body_newer_banner():
    no_cross_body_banner(load("acs"))


def test_acs_has_2012_in_french_section_and_old():
    r = load("acs")
    has = [h for h in heads(r, "france") if h["body"] == "has" and "infarctus du myocarde" in h["title"].lower()]
    assert has and has[0]["version_year"] == 2012 and date.today().year - 2012 > 10


def test_acs_sfc_consensus_st_plus_if_sfc_crawl_works():
    r = load("acs")
    sfc = next((l for l in r.get("crawl_log") or [] if l.get("source") == "sfc"), None)
    if not sfc or not sfc.get("pdfs_found"):
        pytest.skip("le crawl SFC n'a trouvé aucun PDF pour ce thème")
    assert any(h["body"] == "sfc" and h["version_year"] == 2013 for h in heads(r, "france")), [h["title"][:70] for h in heads(r, "france")]


def test_acs_aha_corrections_once_each_in_corrections():
    r = load("acs")
    places = where(r, r"^correction to: 2025 ACC/AHA")
    assert places and all(p[:2] == ("articles", "corrections") for p in places), places
    group = next(g for g in section(r, "articles")["groups"] if g["label"] == "corrections")
    keys = [x.get("pmid") or x["url"] for x in group["items"]]
    assert len(keys) == len(set(keys))


@pytest.mark.parametrize("pattern", [r"non-ST.elevation acute coronary syndromes \(2024\)", r"Dutch College of General Practitioners|NHG"])
def test_acs_national_guidelines_in_other_countries(pattern):
    places = where(load("acs"), pattern)
    assert places and all(p[0] == "autres" for p in places), places


# ─── Dissection aortique ─────────────────────────────────────────────────────────────────────────


def test_aortic_international_references():
    r = load("aortic-dissection")
    intl = heads(r, "international")
    assert any(h["body"] == "esc" and h["version_year"] == 2024 and "aortic" in h["title"].lower() for h in intl)
    assert any(h["body"] == "aha-acc" and h["version_year"] == 2022 and "aortic disease" in h["title"].lower() for h in intl)
    assert not any("ACC/AHA" in (u.get("body") or "") and u.get("year") == 2022 for u in (r.get("librarian") or {}).get("unverified", []))


def test_aortic_esvs_2026_only():
    r = load("aortic-dissection")
    esvs = [h for s in ("international", "autres") for h in heads(r, s) if h["body"] == "esvs" and "thoracic" in h["title"].lower()]
    assert esvs and esvs[0]["version_year"] == 2026
    assert not any(u.get("body") == "ESVS" and u.get("year") == 2024 for u in (r.get("librarian") or {}).get("unverified", []))


@pytest.mark.parametrize("pattern,group", [
    (r"Modeling of predissection aortic size", "études"),
    (r"Cardiology patient page", "documents patients"),
    (r"reporting standards", "méthodologie"),
])
def test_aortic_articles_by_label(pattern, group):
    places = where(load("aortic-dissection"), pattern)
    assert places and all(p[:2] == ("articles", group) for p in places), places


def test_aortic_clarification_under_2022():
    r = load("aortic-dissection")
    fam = next(f for f in section(r, "international")["families"] if f["versions"][0]["body"] == "aha-acc" and f["versions"][0]["version_year"] == 2022)
    assert any("clarification" in v["title"].lower() for v in fam["versions"][1:]), [v["title"][:60] for v in fam["versions"]]


def test_aortic_jcs_edition_and_publication_year():
    jcs = [h for s in ("international", "autres") for h in heads(load("aortic-dissection"), s) if h["body"] == "jcs"]
    assert jcs and jcs[0]["version_year"] == 2020 and jcs[0]["year"] == 2023


def test_aortic_french_bodies_have_crawl_status():
    r = load("aortic-dissection")
    french = section(r, "france").get("bodies") or []
    assert french and all(CRAWL_STATUSES.match(b["status"]) for b in french), french
