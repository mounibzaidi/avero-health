"""The fiche generation pipeline for one draft (table fiche_drafts), run in the background by the routes.

ingest: the PDF's free layers (pdftotext) into document_pages, once per document; the draft waits at
"needs_offset" when the printed page offset is not clear.
generate: routing (Haiku, on the free layers), then LlamaParse only for the routed pages with a table or a figure that
have no parsed layer yet, one call per section, the quote check of every line, up to MAX_RETRIES correction calls,
and, for a section still failing, one rerun on the fallback model (FICHEGEN_FALLBACK_MODEL, default Sonnet; "none"
turns it off). Then assembly and validation: a fiche that fails validation is not saved. Text layers are read from
document_pages; every call's cost (LlamaParse included) goes to generation_calls; per-line data to fiche_line_meta.
"""

import hashlib

from .. import supabase as sb
from ..settings import env
from . import assemble, check, ingest, llm
from .schema import SECTIONS, validate
from .store import RestStore, now

MAX_RETRIES = 2


def fallback_model() -> str | None:
    m = (env().get("FICHEGEN_FALLBACK_MODEL") or "claude-sonnet-5-5").strip()
    return None if m == "none" or m not in llm.MODELS else m


def _now() -> str:
    return now()


def _update(caller, draft_id: str, **fields) -> None:
    sb.rest(caller, "PATCH", "fiche_drafts", {"id": f"eq.{draft_id}"}, {**fields, "updated_at": _now()})


def _draft(caller, draft_id: str) -> dict:
    rows = sb.rest(caller, "GET", "fiche_drafts", {"id": f"eq.{draft_id}", "select": "*"})
    if not rows:
        raise RuntimeError("brouillon introuvable")
    return rows[0]


def ingest_draft(caller, draft_id: str) -> None:
    d = _draft(caller, draft_id)
    try:
        _update(caller, draft_id, stage="ingesting", stage_detail="pdftotext (gratuit)", error=None)
        store = RestStore(caller)
        doc = d["document_id"]

        def pdf() -> bytes:
            body = sb.download(caller, d["pdf_path"])
            if body is None:
                raise RuntimeError("PDF introuvable dans le stockage")
            return body

        _, offset, consistent = ingest.ensure_pages(store, doc, pdf)
        _update(caller, draft_id, page_offset=offset, offset_detected=consistent, stage="ready" if consistent else "needs_offset",
                stage_detail=None if consistent else "décalage des pages imprimées non détecté : à saisir")
    except Exception as exc:
        _update(caller, draft_id, stage="error", error=f"Ingestion : {type(exc).__name__} {exc}"[:500])


def _section_lines(section, answer, by_printed, model, jobs, audience, source, log, errors) -> list:
    """One section's lines checked on the PDF, corrected up to MAX_RETRIES times: [place, line, meta]."""
    lines = []
    for place, line in assemble.lines_of(answer, section):
        page = by_printed.get(line["source"]["page"])
        lines.append([place, line, {"quote_status": check.check(line["source"]["quote"], page),
                                    "from_figure": bool(line.get("from_figure")) or check.from_figure(line["source"]["quote"], page),
                                    "retries": 0, "model": model}])
    # a verbatim quote cited on the wrong page: code finds its page among the section's pages (free, before any retry)
    for t in lines:
        if t[2]["quote_status"] == "failed":
            hits = [p["printed_page"] for p in jobs.get(section, []) if check.check(t[1]["source"]["quote"], p) != "failed"]
            if len(hits) == 1:
                t[1]["source"]["page"] = hits[0]
                t[2]["quote_status"] = check.check(t[1]["source"]["quote"], by_printed[hits[0]])
    for attempt in range(1, MAX_RETRIES + 1):
        failed = [t for t in lines if t[2]["quote_status"] == "failed"]
        if not failed:
            break
        # only the pages the failed quotes cite, and their neighbours: resending the whole section cost as much as generating it
        near = sorted({n for t in failed for n in (t[1]["source"]["page"] - 1, t[1]["source"]["page"], t[1]["source"]["page"] + 1) if n in by_printed})
        retry_pages = [by_printed[n] for n in near] or jobs[section]
        try:
            fixes = llm.fix(section, [t[1] for t in failed], audience, source, retry_pages, model, log)
        except Exception as exc:
            errors.append(f"{section} (correction) : {exc}")
            break
        for fx in fixes:
            if not 0 <= fx["index"] < len(failed):
                continue
            t = failed[fx["index"]]
            t[2]["retries"] = attempt
            if fx["drop"]:
                t[2]["quote_status"], t[2]["reason"] = "dropped", "abandonnée par le modèle à la correction"
                continue
            if fx.get("page") is not None:
                t[1]["source"]["page"] = fx["page"]
            if fx.get("quote"):
                t[1]["source"]["quote"] = fx["quote"]
            t[2]["quote_status"] = check.check(t[1]["source"]["quote"], by_printed.get(t[1]["source"]["page"]))
    return lines


def generate(store, document_id: str, offset: int | None, pdf_bytes, filename: str, form: dict, model: str, batch: bool, log,
             progress=lambda stage, detail: None, fallback: str | None = None) -> tuple[dict, dict, list[dict], list[str], dict]:
    """The pipeline: (fiche, side data by element id, dropped lines, section errors, report). Layers are read from
    document_pages (store); `log` receives every call's cost; `progress(stage, detail)` the steps."""
    audience = ", ".join(form.get("audience") or ["MG", "urgences"])
    rows = store.pages(document_id)
    pages = [p for p in ingest.as_layers(rows, offset) if not p["skip"]]
    by_printed = {p["printed_page"]: p for p in pages}

    progress("routing", "répartition des pages par section")
    routing = llm.route(pages, audience, log)
    wanted = {n for s in SECTIONS for n in routing["sections"].get(s, [])}

    progress("parsing", "LlamaParse des pages à tableaux ou figures retenues")
    sent, lp_cost = ingest.parse_pages(store, rows, {by_printed[n]["pdf_page"] for n in wanted if n in by_printed}, pdf_bytes, filename)
    if sent:
        log({"stage": "llamaparse", "section": None, "model": f"llamaparse:{ingest.tier_name()}", "batch": False, "input_tokens": sent,
             "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "cost_usd": lp_cost})
    pages = [p for p in ingest.as_layers(rows, offset) if not p["skip"]]
    by_printed = {p["printed_page"]: p for p in pages}
    jobs = {s: [by_printed[n] for n in routing["sections"][s] if n in by_printed] for s in SECTIONS if s != "12_ordonnance"}
    jobs = {s: ps for s, ps in jobs.items() if ps}

    progress("generating", f"{len(jobs)} section(s), {model}{' en lot' if batch else ''}")
    answers = llm.sections(jobs, audience, form["source"], model, log, batch=batch)

    progress("checking", "vérification des citations")
    kept: dict[str, list] = {}
    dropped: list[dict] = []
    errors: list[str] = []
    fell_back = []
    for section, answer in list(answers.items()):
        if isinstance(answer, Exception):
            errors.append(f"{section} : {answer}")
            continue
        lines = _section_lines(section, answer, by_printed, model, jobs, audience, form["source"], log, errors)
        if fallback and fallback != model and any(t[2]["quote_status"] == "failed" for t in lines):
            # the section still fails after its corrections: one rerun on the fallback model, kept if it verifies more
            again = llm.sections({section: jobs[section]}, audience, form["source"], fallback, log)[section]
            if not isinstance(again, Exception):
                other = _section_lines(section, again, by_printed, fallback, jobs, audience, form["source"], log, errors)
                good = lambda ls: sum(t[2]["quote_status"] in ("pdf", "parsed") for t in ls) - sum(t[2]["quote_status"] == "failed" for t in ls)  # noqa: E731
                if good(other) > good(lines):
                    lines, answers[section] = other, again
                    fell_back.append(section)
        kept[section] = [(pl, ln, m) for pl, ln, m in lines if m["quote_status"] in ("pdf", "parsed")]
        dropped += [{"section": section, "line": ln, "reason": m.get("reason") or f"citation introuvable page {ln['source']['page']} après {MAX_RETRIES} corrections"}
                    for pl, ln, m in lines if m["quote_status"] not in ("pdf", "parsed")]

    good_answers = {k: v for k, v in answers.items() if not isinstance(v, Exception)}
    fiche, side, duplicates = assemble.assemble(form, good_answers, kept, routing["excluded_by_audience"])
    report = {"llamaparse_pages": sent, "llamaparse_usd": lp_cost, "routed_pages": len(wanted), "fallback_sections": fell_back}
    return fiche, side, dropped + duplicates, errors, report


def generate_draft(caller, draft_id: str) -> None:
    d = _draft(caller, draft_id)
    form, opts = d["form"], d["options"] or {}
    model = opts.get("model") if opts.get("model") in llm.MODELS else llm.DEFAULT_MODEL

    def log(entry: dict) -> None:
        sb.rest(caller, "POST", "generation_calls", body={**entry, "draft_id": draft_id})

    try:
        sb.rest(caller, "DELETE", "fiche_line_meta", {"draft_id": f"eq.{draft_id}"})
        _update(caller, draft_id, error=None)

        def pdf() -> bytes:
            body = sb.download(caller, d["pdf_path"])
            if body is None:
                raise RuntimeError("PDF introuvable dans le stockage")
            return body

        fallback = opts.get("fallback", fallback_model()) if opts.get("fallback") != "none" else None
        fiche, side, dropped, errors, _ = generate(RestStore(caller), d["document_id"], d["page_offset"], pdf, d["pdf_path"].rsplit("/", 1)[-1],
                                                   form, model, bool(opts.get("batch")), log,
                                                   lambda stage, detail: _update(caller, draft_id, stage=stage, stage_detail=detail), fallback)
        problems = validate(fiche)
        if problems:
            raise RuntimeError("fiche non conforme, non enregistrée : " + " ; ".join(problems[:5]))
        rows = [{"draft_id": draft_id, "element_id": eid, "section": m["section"], "quote_status": m["quote_status"],
                 "from_figure": m["from_figure"], "retries": m["retries"], "model": m["model"]} for eid, m in side.items()]
        rows += [{"draft_id": draft_id, "element_id": f"dropped-{i + 1}", "section": x["section"], "dropped": True, "dropped_line": x["line"],
                  "reason": x["reason"], "model": model} for i, x in enumerate(dropped)]
        for k in range(0, len(rows), 100):
            sb.rest(caller, "POST", "fiche_line_meta", body=rows[k:k + 100])
        _update(caller, draft_id, content=fiche, stage="done", status="draft",
                stage_detail=f"citations vérifiées {fiche['meta']['quote_check']}, {len(dropped)} ligne(s) écartée(s)",
                error="; ".join(errors)[:500] or None)
    except Exception as exc:
        _update(caller, draft_id, stage="error", error=f"{type(exc).__name__} {exc}"[:500])


def sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def summary(caller, draft_id: str) -> dict:
    """Cost of a draft: totals and per model."""
    calls = sb.rest(caller, "GET", "generation_calls", {"draft_id": f"eq.{draft_id}", "select": "*"}) or []
    by_model: dict[str, float] = {}
    for c in calls:
        by_model[c["model"]] = by_model.get(c["model"], 0) + float(c["cost_usd"])
    return {"calls": len(calls), "cost_usd": round(sum(by_model.values()), 4), "by_model": {k: round(v, 4) for k, v in by_model.items()},
            "input_tokens": sum(c["input_tokens"] for c in calls), "output_tokens": sum(c["output_tokens"] for c in calls),
            "cache_read_tokens": sum(c["cache_read_tokens"] for c in calls), "cache_write_tokens": sum(c["cache_write_tokens"] for c in calls)}

