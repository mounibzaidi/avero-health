"""Record a live search as a test fixture (tests/fixtures/<topic>.json), for test_acceptance.py.

    .venv/bin/python tests/record_fixture.py acs aortic-dissection

Runs the whole pipeline (librarian, body crawls, classifier): the first run of a topic costs LLM calls, a rerun
within the caches' life is free.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import literature  # noqa: E402
from topics import load_topics  # noqa: E402

HERE = Path(__file__).resolve().parent / "fixtures"

if __name__ == "__main__":
    topics = {t["id"]: t for t in load_topics()[0]}
    for tid in sys.argv[1:]:
        result = literature.search(None, topics[tid], ai=True)
        HERE.mkdir(exist_ok=True)
        (HERE / f"{tid}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
        print(tid, "recorded:", sum(len(s.get("families") or []) for s in result["sections"]), "families")
