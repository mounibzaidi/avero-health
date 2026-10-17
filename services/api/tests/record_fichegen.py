"""Run the fiche pipeline live on a guideline PDF and record it as a test fixture (no dashboard).

    .venv/bin/python tests/record_fichegen.py <pdf> [model] [--batch] [--fallback=<model>|none]

Reads and writes the knowledge base directly (documents, document_pages, generation_calls): the PDF's free layers are
stored once; LlamaParse runs only for routed pages with a table or a figure that have no parsed layer yet, so a
rerun with another model pays Claude only. Prints the cost split and records tests/fixtures/acs_2025_live[_<model>].json.
"""

import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.fichegen import ingest, llm, pipeline  # noqa: E402
from app.fichegen.schema import validate  # noqa: E402
from app.fichegen.store import PgStore  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures"
FORM = {"title": "Syndrome coronarien aigu : prise en charge initiale (ACC/AHA 2025)", "topic_id": "sca-accaha-2025", "template": "urgence",
        "audience": ["MG", "urgences"], "siblings": [], "licence_scope": "internal",
        "licence_text": "© 2025 ACCF et AHA. Copie multiple, modification et diffusion interdites sans autorisation expresse de l'ACC.",
        "source": {"source_id": "accaha2025", "type": "full_guideline",
                   "title": "2025 ACC/AHA/ACEP/NAEMSP/SCAI Guideline for the Management of Patients With Acute Coronary Syndromes",
                   "citation": "Rao SV, O'Donoghue ML, Ruel M, et al. J Am Coll Cardiol. 2025;85(22):2135-2237"}}


def split(calls: list[dict]) -> dict:
    out = {"llamaparse": 0.0, "routing": 0.0, "generation": 0.0, "retries": 0.0}
    for c in calls:
        key = {"llamaparse": "llamaparse", "routing": "routing", "retry": "retries"}.get(c["stage"], "generation")
        out[key] = round(out[key] + float(c["cost_usd"]), 6)
    return out


if __name__ == "__main__":
    pdf = Path(sys.argv[1])
    model = next((a for a in sys.argv[2:] if a in llm.MODELS), llm.DEFAULT_MODEL)
    batch = "--batch" in sys.argv
    fb = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--fallback=")), None)
    fallback = None if fb == "none" else (fb or pipeline.fallback_model())
    body = pdf.read_bytes()
    store = PgStore()
    doc = store.document(hashlib.sha256(body).hexdigest(), f"local/{pdf.name}", FORM["source"]["title"], FORM["licence_text"], FORM["licence_scope"])
    rows, offset, consistent = ingest.ensure_pages(store, doc, lambda: body)
    print(f"document {doc} : {len(rows)} pages, décalage {offset} ({'détecté' if consistent else 'à saisir'})")
    calls: list[dict] = []

    def log(entry):
        calls.append(entry)
        store.log_call({**entry, "draft_id": None})

    fiche, side, dropped, errors, report = pipeline.generate(store, doc, offset, lambda: body, pdf.name, FORM, model, batch, log,
                                                             lambda s, d: print("·", s, d), fallback)
    costs = split(calls)
    print("validation :", validate(fiche) or "ok", "| citations", fiche["meta"]["quote_check"], "| écartées", len(dropped), "| erreurs", errors)
    print("LlamaParse :", report["llamaparse_pages"], "page(s) envoyée(s) sur", report["routed_pages"], "retenue(s) | repli :", report["fallback_sections"])
    print("coût :", costs, "| total", round(sum(costs.values()), 4))
    out = FIX / ("acs_2025_live.json" if model == llm.DEFAULT_MODEL else f"acs_2025_live_{model}.json")
    out.write_text(json.dumps({"model": model, "batch": batch, "fallback": fallback, "fiche": fiche, "side": side, "dropped": dropped, "errors": errors,
                               "report": report, "costs": costs, "calls": calls}, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print("enregistré :", out.name)
