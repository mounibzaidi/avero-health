"""Check the topic registry for newer guideline versions (run by the API, results written by it as alerts).

    python registry_check.py < rows.json      # rows: [{id, topic_id, body_id, current_year, current_ref, current_title}]

For each topic, one search (literature.py: PubMed + Europe PMC by topic and guideline type, the French bodies through
their listing pages); then, for each followed body, the newest guideline of that body on the topic. It is reported
when it is newer than the registered one (or when none is registered yet). Never replaces anything: the dashboard
asks a person.
"""

import json
import sys

import literature
from topics import load_topics


def _ref(v: dict) -> str:
    return f"https://doi.org/{v['doi']}" if v.get("doi") else v["url"]


def newest_for(result: dict, body_id: str) -> dict | None:
    """The body's newest guideline (current version of its families) in a search result."""
    best = None
    for fam in result["families"]:
        v = fam["versions"][0]
        if fam["body"] == body_id and v["kind"] == "guideline" and (best is None or (v["version_year"] or 0) > (best["version_year"] or 0)):
            best = v
    return best


def check(rows: list[dict]) -> list[dict]:
    topics = {t["id"]: t for t in load_topics()[0]}
    out, searches = [], {}
    for row in rows:
        topic = topics.get(row["topic_id"])
        if not topic:
            out.append({"id": row["id"], "error": f"thème inconnu : {row['topic_id']}"})
            continue
        try:
            if row["topic_id"] not in searches:
                searches[row["topic_id"]] = literature.search(topic=topic)
            v = newest_for(searches[row["topic_id"]], row["body_id"])
        except Exception as exc:  # noqa: BLE001 - reported per row, the others are still checked
            out.append({"id": row["id"], "error": f"{type(exc).__name__}: {exc}"[:200]})
            continue
        if v is None:
            out.append({"id": row["id"], "found": None})
            continue
        found = {"title": v["title"], "year": v["version_year"], "ref": _ref(v)}
        newer = row.get("current_year") is None or (v["version_year"] or 0) > row["current_year"]
        same = (row.get("current_ref") or "").lower() == found["ref"].lower()
        out.append({"id": row["id"], "found": found, "newer": newer and not same})
    return out


if __name__ == "__main__":
    print(json.dumps(check(json.load(sys.stdin)), ensure_ascii=False))
