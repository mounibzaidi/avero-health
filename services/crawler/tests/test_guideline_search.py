"""Regression test of the guideline search (live: queries PubMed and Europe PMC).

    .venv/bin/python -m pytest tests -v

Each query must show these guidelines among its first five results (the current version of each family, in rank
order). A guideline is recognised by its issuing body, its year and words of its title.
"""

import pytest

import literature

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
