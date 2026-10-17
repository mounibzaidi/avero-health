"""Regression test of the guideline search (live: queries PubMed and Europe PMC).

    .venv/bin/python -m pytest tests -v

Each query must show these guidelines among its first five results (the current version of each family, in rank
order). A guideline is recognised by its issuing body, its year and words of its title.
"""

import pytest

import librarian
import literature
from topics import load_topics

CASES = {
    "embolie pulmonaire": [
        ("ESC", 2019, ["acute pulmonary embolism"]),
        ("AHA/ACC", 2026, ["acute pulmonary embolism"]),
    ],
    "insuffisance cardiaque": [
        ("ESC", 2026, ["heart failure"]),
    ],
    "maladie rénale chronique cardiovasculaire": [
        ("ESC", 2026, ["cardiovascular disease", "chronic kidney disease"]),
    ],
}


def _is(entry: dict, body: str, year: int, words: list[str]) -> bool:
    title = entry["title"].lower()
    return entry["body_name"] == body and entry["version_year"] == year and all(w in title for w in words)


@pytest.mark.parametrize("query", CASES)
def test_expected_guidelines_in_top_5(query):
    result = literature.search(query)
    top5 = literature.top(result, 5)
    shown = [f"{e['body_name'] or '?'} {e['version_year']} | {e['title'][:90]}" for e in top5]
    print(f"\n{query}:\n  " + "\n  ".join(shown))
    for body, year, words in CASES[query]:
        assert any(_is(e, body, year, words) for e in top5), f"absent du top 5 : {body} {year} {words}\n" + "\n".join(shown)


TOPIC_CASES = {
    # the reference guidelines say "acute coronary syndromes": the topic's singular name must still find them
    "acs": [
        ("AHA/ACC", 2025, ["acute coronary syndromes"]),
        ("ESC", 2023, ["acute coronary syndromes"]),
    ],
}


@pytest.mark.parametrize("topic_id", TOPIC_CASES)
def test_topic_reference_guidelines_first(topic_id):
    topic = next(t for t in load_topics()[0] if t["id"] == topic_id)
    result = literature.search(None, topic, with_librarian=False, with_classifier=False)  # the PubMed layer alone must find them
    top = literature.top(result, len(TOPIC_CASES[topic_id]))
    shown = [f"{e['body_name'] or '?'} {e['version_year']} | {e['title'][:90]}" for e in literature.top(result, 5)]
    print(f"\n{topic_id}:\n  " + "\n  ".join(shown))
    for body, year, words in TOPIC_CASES[topic_id]:
        assert any(_is(e, body, year, words) for e in top), f"absent en tête : {body} {year} {words}\n" + "\n".join(shown)


# Offline: titles seen in the ACS search of 2026-10-17, each a paper about a guideline, a translation or a reprint.
NOT_GUIDELINES = [
    "[ESC guidelines 2015. Non-ST-elevation acute coronary syndrome]",
    "Type of evidence supporting ACC/AHA and ESC clinical practice guidelines for acute coronary syndrome",
    "Critical appraisal of the 2020 ESC guideline recommendations on diagnosis and risk assessment in patients with suspected NSTE-ACS",
    "Questions and answers on antithrombotic therapy and revascularization strategies in non-ST-elevation acute coronary syndrome (NSTE-ACS): a companion document of the 2020 ESC Guidelines",
    "Temporary Emergency Guidance to STEMI Systems of Care During the COVID-19 Pandemic: AHA's Mission: Lifeline",
    "Summary of 2017 ESC guidelines on valvular heart disease, peripheral artery disease, STEMI and on dual antiplatelet therapy",
    "Clinical guideline highlights for the hospitalist: Updated guidelines on acute coronary syndrome 2025",
    "Comments on the 2023 ESC guidelines for the management of acute coronary syndromes",
    "Antiplatelet and Anticoagulant Therapy in the 2025 ACC/AHA Guideline for Acute Coronary Syndromes",
    "America vs Europe and the 2014 Non-ST Elevation Acute Coronary Syndrome Guidelines",
]
GUIDELINES = [
    "2023 ESC Guidelines for the management of acute coronary syndromes",
    "2025 ACC/AHA/ACEP/NAEMSP/SCAI Guideline for the Management of Patients With Acute Coronary Syndromes: A Report of the American College of Cardiology/American Heart Association Joint Committee on Clinical Practice Guidelines",
    "2019 ESC Guidelines for the diagnosis and management of acute pulmonary embolism developed in collaboration with the European Respiratory Society (ERS)",
]


@pytest.mark.parametrize("title", NOT_GUIDELINES)
def test_about_a_guideline_is_an_article(title):
    assert literature.classify({"title": title, "pubtypes": ["Practice Guideline"]})[0] == "article"


@pytest.mark.parametrize("title", GUIDELINES)
def test_guideline_stays_a_guideline(title):
    assert literature.classify({"title": title, "pubtypes": ["Journal Article"]})[0] == "guideline"


def test_number_forms():
    assert literature.number_forms("Acute coronary syndrome") == ["Acute coronary syndrome", "Acute coronary syndromes"]
    assert literature.number_forms("sepsis") == ["sepsis"]
    assert literature.number_forms("STEMI") == ["STEMI"]


# The librarian (LLM) only proposes; PubMed decides. Live PubMed, no LLM call.
def test_librarian_takes_identifiers_from_pubmed_not_the_model():
    proposal = {"title": "2023 ESC Guidelines for the management of acute coronary syndromes", "year": 2023,
                "journal": "Eur Heart J", "pmid": "12345678", "doi": None}  # wrong PMID, as a model might give
    rec = librarian.verify(proposal)
    assert rec and rec["pmid"] == "37622654" and rec["doi"] == "10.1093/eurheartj/ehad191"


def test_librarian_rejects_an_invented_guideline():
    proposal = {"title": "2024 ESC Guidelines for the management of acute coronary syndromes in Mars colonists", "year": 2024,
                "journal": "Eur Heart J", "pmid": None, "doi": None}
    assert librarian.verify(proposal) is None


def test_librarian_skips_translations_and_commentaries():
    proposal = {"title": "2025 ACC/AHA/ACEP/NAEMSP/SCAI Guideline for the Management of Patients With Acute Coronary Syndromes",
                "year": 2025, "journal": "Circulation", "pmid": None, "doi": None}
    rec = librarian.verify(proposal)
    assert rec and rec["pmid"] == "40014670"  # the guideline itself, not one of its three corrections


def test_same_title_tolerates_a_dropped_subtitle_only():
    full = "2025 ACC/AHA/ACEP/NAEMSP/SCAI Guideline for the Management of Patients With Acute Coronary Syndromes: A Report of the American College of Cardiology"
    assert librarian.same_title("2025 ACC/AHA Guideline for the Management of Patients With Acute Coronary Syndromes", full)
    assert not librarian.same_title("2024 ESC Guidelines for the management of chronic coronary syndromes",
                                    "2023 ESC Guidelines for the management of acute coronary syndromes")


def test_model_answer_json_is_found_inside_fences():
    assert librarian._json('```json\n{"guidelines": []}\n```') == {"guidelines": []}


# French sources (society catalogue: SFMU, SFAR, SFC, SPILF). Live search, no LLM.
FRENCH_CASES = {
    # SFMU/SRLF 2018, titled in the plural ("états de mal épileptiques")
    "status-epilepticus": ("SFMU", 2018, ["mal épileptiques"]),
    # one HAS text that SFMU and SFAR also list: one entry, the others as co-publishers
    "acs": ("HAS", 2012, ["infarctus du myocarde"]),
}


@pytest.mark.parametrize("topic_id", FRENCH_CASES)
def test_french_guideline_shown(topic_id):
    topic = next(t for t in load_topics()[0] if t["id"] == topic_id)
    result = literature.search(None, topic, with_librarian=False, with_classifier=False)
    body, year, words = FRENCH_CASES[topic_id]
    top = literature.top(result, 5)
    shown = [f"{e['body_name']} {e['version_year']} | {e['title'][:80]}" for e in top]
    assert any(_is(e, body, year, words) for e in top), "\n".join(shown)
    same_text = [e for e in literature.top(result, 40) if "infarctus du myocarde à la phase aiguë" in e["title"].lower()]
    assert len(same_text) <= 1, "un même texte HAS/SFMU/SFAR affiché plusieurs fois"


def test_french_title_matches_in_the_plural():
    import listings
    from literature import fold
    assert listings.matches("Prise en charge des états de mal épileptiques", [["État de mal épileptique"]], fold)
    assert not listings.matches("Prise en charge de l'épilepsie", [["État de mal épileptique"]], fold)


@pytest.mark.parametrize("title", [
    "RECOVER Guidelines: First Aid. Evidence, Treatment Recommendations, Knowledge Gap Analysis, and Consensus Statements",
    "Pearls for practice from the 2023 joint task force anaphylaxis practice parameter",
    "Intranasal Epinephrine: Where Might It Fit in Guidelines for Managing Anaphylaxis",
    "Brochure – La prévention cardiovasculaire des femmes",
])
def test_more_titles_that_are_not_guidelines(title):
    assert literature.classify({"title": title, "pubtypes": ["Practice Guideline"]})[0] == "article"


# Librarian v2: its search terms widen the search only when they name the topic itself.
ACS_EN = ["Acute coronary syndrome", "STEMI"]
ACS_FR = ["Syndrome coronarien aigu", "SCA", "infarctus du myocarde", "IDM", "ST+"]


@pytest.mark.parametrize("term", ["non-ST elevation acute coronary syndrome", "NSTEMI", "NSTE-ACS"])
def test_librarian_english_synonyms_kept(term):
    assert literature.usable_term(term) and literature.on_topic(term, ACS_EN)


@pytest.mark.parametrize("term", ["antiplatelet therapy", "chest pain", "reperfusion therapy", "myocardial infarction", "ACS"])
def test_librarian_neighbour_terms_dropped(term):
    assert not (literature.usable_term(term) and literature.on_topic(term, ACS_EN))


@pytest.mark.parametrize("term,kept", [("syndrome coronaire aigu", True), ("SCA ST+", True), ("douleur thoracique", False),
                                       ("antiagrégants plaquettaires", False)])
def test_librarian_french_terms(term, kept):
    assert (literature.usable_term(term, french=True) and literature.on_topic(term, ACS_FR)) is kept


def test_supersession_only_within_one_body():
    ref = {"title": "2023 ESC Guidelines for the management of acute coronary syndromes", "body": "esc", "body_name": "ESC",
           "version_year": 2023, "reference": {"supersedes": [{"title": "2014 AHA/ACC Guideline for NSTE-ACS", "year": 2014}]}}
    other = {"title": "2014 AHA/ACC Guideline for NSTE-ACS", "body": "aha-acc", "body_name": "AHA/ACC", "version_year": 2014}
    fams = [{"versions": [ref]}, {"versions": [other]}]
    literature._superseded(fams)
    assert "newer_elsewhere" not in fams[1]


@pytest.mark.parametrize("title,journal,body", [
    ("JCS 2018 Guideline on Diagnosis and Treatment of Acute Coronary Syndrome", "Circ J", "jcs"),
    ("National Heart Foundation of Australia and Cardiac Society of Australia and New Zealand: Australian Clinical Guideline for Diagnosing and Managing Acute Coronary Syndromes 2025", "Med J Aust", "csanz"),
    ("American Society of Hematology 2020 guidelines for management of venous thromboembolism: treatment of deep vein thrombosis and pulmonary embolism", "Blood Adv", "ash"),
    ("The Japanese Clinical Practice Guidelines for Management of Sepsis and Septic Shock 2024", "Acute Med Surg", "jssc"),
    ("Unresolved issues concerning venous thromboembolism. Venous thromboembolism in children. Consensus of the French Society of Vascular Medicine", "J Med Vasc", "sfmv"),
])
def test_national_bodies_attributed(title, journal, body):
    b = literature.issuing_body({"title": title, "journal": journal, "authors": []})
    assert b and b["id"] == body


def test_ccs_acronym_alone_is_not_the_canadian_society():
    # "CCS" also means chronic coronary syndrome: only the full name attributes a document to the Canadian society
    b = literature.issuing_body({"title": "Management of CCS in primary care: a guideline", "journal": "BMJ", "authors": []})
    assert b is None or b["id"] != "ccs"


# French originals on PubMed: their English title is bracketed, they are not translations.
def test_french_original_is_not_a_translation():
    rec = {"title": "[Recommendations of good practice for the management of thromboembolic venous disease in adults. Short version]",
           "pubtypes": ["Journal Article"], "lang": ["fre"], "journal": "Rev Mal Respir"}
    assert literature.classify(rec)[0] == "guideline"
    rec["lang"] = ["ger"]
    assert literature.classify(rec)[0] == "article"


def test_french_pe_guideline_found_with_its_french_title():
    topic = next(t for t in load_topics()[0] if t["id"] == "pulmonary-embolism")
    # the body of a guideline whose title does not name it comes from the classifier (never from the journal)
    result = literature.search(None, topic, with_librarian=False, ai=True)
    top = literature.top(result, 8)
    splf = [e for e in top if e["body"] == "splf" and "maladie veineuse thromboembolique" in e["title"].lower()]
    assert splf, "\n".join(f"{e['body_name']} {e['version_year']} | {e['title'][:80]}" for e in top)
    assert any(len(e.get("chapters") or []) >= 2 for e in splf)  # its question-titled chapters folded in


def test_no_cross_body_newer_banner():
    a = {"title": "Guideline A on topic", "body": "ash", "body_name": "ASH", "version_year": 2020, "kind": "guideline", "official": True}
    b = {"title": "Guideline B on topic", "body": "esvm", "body_name": "ESVM", "version_year": 2025, "kind": "guideline", "official": True}
    assert all("newer_elsewhere" not in g for g in literature.families([a, b]))
