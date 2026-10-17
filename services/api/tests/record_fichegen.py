"""Run the fiche pipeline live on a guideline PDF and record it as a test fixture (no dashboard).

    .venv/bin/python tests/record_fichegen.py <pdf> [model] [--batch] [--fallback=<model>|none] [--tag=<name>]

Reads and writes the knowledge base directly (documents, document_pages, generation_calls): the PDF's free layers are
stored once; LlamaParse runs only for routed pages with a numbered table and pages with failed quotes, never twice for
a page, so a rerun pays Claude only. Prints the cost split, the coverage, the dose checklist and the GRACE criteria, and
records tests/fixtures/acs_2025_live[_<model>][_<tag>].json.
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
    out = {"llamaparse": 0.0, "routing": 0.0, "generation": 0.0, "retries": 0.0, "coverage": 0.0}
    for c in calls:
        key = {"llamaparse": "llamaparse", "routing": "routing", "retry": "retries", "coverage": "coverage"}.get(c["stage"], "generation")
        out[key] = round(out[key] + float(c["cost_usd"]), 6)
    return out


def doses(fiche: dict) -> dict:
    """The dose checklist: each drug's doses in 7_traitement, and the IV nitroglycerin and fentanyl doses in µg."""
    pos = fiche["sections"]["7_traitement"]["posologies"]
    of = lambda name: [f"{d['dose']} ({d['route']})" for d in pos if name in d["drug_dci"].lower()]  # noqa: E731
    micro = lambda d: any(u in f"{d['dose']} {d.get('dose_max') or ''}" for u in ("µg", "μg", "mcg"))  # noqa: E731
    iv = lambda d: any(w in d["route"].lower() for w in ("iv", "intraveineu"))  # noqa: E731
    return {"ticagrelor": of("ticag"), "prasugrel": of("prasug"), "clopidogrel": of("clopid"), "tenecteplase": of("ténect") + of("tenect"),
            "nitroglycerin_iv_ug": any(micro(d) and iv(d) for d in pos if "nitro" in d["drug_dci"].lower()),
            "fentanyl_ug": any(micro(d) for d in pos if "fentanyl" in d["drug_dci"].lower())}


def grace(fiche: dict, side: dict) -> list[dict]:
    """The lines with GRACE criteria (> 140, 109-140), from text or from the Figure 8 image."""
    out = []
    for sec in fiche["sections"].values():
        lists = [v for v in sec.values() if isinstance(v, list)] + [v["elements"] for v in sec.values() if isinstance(v, dict) and "elements" in v]
        lists += [n["branches"] for n in sec.get("nodes") or []]
        for el in (e for lst in lists for e in lst if isinstance(e, dict) and "id" in e):
            blob = f"{el['text']} {el['source']['quote']}"
            if "GRACE" in blob and ("140" in blob or "109" in blob):
                out.append({"id": el["id"], "page": el["source"]["page"], "text": el["text"], "quote": el["source"]["quote"],
                            "quote_status": side.get(el["id"], {}).get("quote_status"), "from_figure": side.get(el["id"], {}).get("from_figure")})
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
    cov = report["coverage"]
    print("validation :", validate(fiche) or "ok", "| citations", fiche["meta"]["quote_check"], "| écartées", len(dropped), "| erreurs", errors)
    print("LlamaParse :", report["llamaparse_pages"], "page(s) payée(s) ce run (", report["table_pages"], "tableaux +", report["lazy_pages"], "paresseuses ) |",
          report["llamaparse_pages_needed"], "page(s) pour un premier run =", f"${report['llamaparse_usd_needed']}", "| figures en image :", report["figure_pages"])
    print("couverture :", f"{cov['pct_before']} % avant l'appel ciblé ->", f"{cov['pct']} %", f"({cov['matched']} couvertes + {cov['excluded']} hors public / {cov['rows']} :",
          f"{cov['rec_rows']} recommandations, {cov['dose_rows']} posologies) | 3: Harm/No Benefit en 8 : {cov['harm_in_8']}/{cov['harm_rows']} | non couvertes :", len(cov["uncovered"]))
    per = {}
    for name, sec in fiche["sections"].items():
        lists = [v for v in sec.values() if isinstance(v, list)] + [v["elements"] for v in sec.values() if isinstance(v, dict) and "elements" in v]
        per[name] = sum(1 for lst in lists + [n["branches"] for n in sec.get("nodes") or []] for e in lst if isinstance(e, dict) and "source" in e)
    print("lignes par section :", per)
    print("posologies :", json.dumps(doses(fiche), ensure_ascii=False))
    print("GRACE :", json.dumps(grace(fiche, side), ensure_ascii=False))
    claude = round(sum(v for k, v in costs.items() if k != "llamaparse"), 4)
    print("coût :", costs, "| Claude", claude, "| fiche premier run (Claude + LlamaParse nécessaire)", round(claude + report["llamaparse_usd_needed"], 4))
    tag = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--tag=")), None)
    name = "acs_2025_live" + ("" if model == llm.DEFAULT_MODEL else f"_{model}") + (f"_{tag}" if tag else "")
    out = FIX / f"{name}.json"
    out.write_text(json.dumps({"model": model, "batch": batch, "fallback": fallback, "fiche": fiche, "side": side, "dropped": dropped, "errors": errors,
                               "report": report, "costs": costs, "doses": doses(fiche), "grace": grace(fiche, side), "calls": calls},
                              ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print("enregistré :", out.name)
