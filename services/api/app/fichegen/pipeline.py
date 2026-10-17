"""The fiche generation pipeline for one draft (table fiche_drafts), run in the background by the routes.

ingest: the PDF's free layers (pdftotext) into document_pages, once per document; the draft waits at
"needs_offset" when the printed page offset is not clear.
generate:
1. routing (Haiku, on the free layers);
2. LlamaParse for the routed pages with a dose table; the routed pages with a figure rendered to PNG for Claude;
3. one call per section (chunks of pages, figure images included);
4. the quote check of every line; a quote cited on the wrong page moved by code; a line read from a figure image is
   kept as "parsed" + from_figure, for the reviewer to confirm;
5. lazy parsing: LlamaParse for the pages where quotes still fail on the pdftotext text, then the check again;
6. up to MAX_RETRIES correction calls, then, for a section still failing, one rerun on the fallback model
   (FICHEGEN_FALLBACK_MODEL, default Sonnet; "none" turns it off);
7. coverage (coverage.py): every recommendation and dose row must be covered; "3: Harm"/"3: No Benefit" rows in
   8_ne_pas_faire; one targeted call per section for the rows left; rows still left go to the reviewer ("Non couvert");
8. assembly and validation: a fiche that fails validation is not saved.
Text layers are read from document_pages; every call's cost (LlamaParse included) goes to generation_calls; per-line
data to fiche_line_meta; the coverage report to fiche_drafts.coverage.
"""

import hashlib

from .. import supabase as sb
from ..settings import env
from concurrent.futures import ThreadPoolExecutor

from . import assemble, check, coverage, ingest, llm
from .schema import SECTIONS, validate
from .store import RestStore, now

MAX_RETRIES = 2
LAZY_MAX = 12  # pages LlamaParse may read for failed quotes in one run
COVER_ROWS = 20


def fallback_model() -> str | None:
    """The model rerunning a section still failing after its corrections: none unless FICHEGEN_FALLBACK_MODEL names
    one (a Sonnet rerun of every failing section cost $2.23 on a 107-page guideline)."""
    m = (env().get("FICHEGEN_FALLBACK_MODEL") or "none").strip()
    return None if m == "none" or m not in llm.MODELS else m


def max_usd() -> float:
    """The cost cap of one generation (FICHEGEN_MAX_USD, default $0.25)."""
    try:
        return float(env().get("FICHEGEN_MAX_USD") or 0.25)
    except ValueError:
        return 0.25


class Budget:
    """The cost log of one generation with its cap: every call's cost goes through it; llm.call refuses a paid call
    once it is spent, and the optional steps (retries, fallback, coverage) are skipped past SOFT of it."""

    SOFT = 0.8

    def __init__(self, log, limit: float):
        self.log, self.limit, self.spent = log, limit, 0.0

    def __call__(self, entry: dict) -> None:
        self.spent += float(entry.get("cost_usd") or 0)
        self.log(entry)

    def over(self) -> bool:
        return self.spent >= self.limit

    def tight(self) -> bool:
        return self.spent >= self.SOFT * self.limit


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
        return
    if consistent:
        start_if_auto(caller, draft_id)


def start_if_auto(caller, draft_id: str) -> None:
    """Generation right after ingestion when the upload asked for it (form.auto_generate): the default model,
    interactive (someone is waiting), the default fallback."""
    d = _draft(caller, draft_id)
    if not (d["form"] or {}).get("auto_generate") or d["page_offset"] is None:
        return
    _update(caller, draft_id, options={"model": llm.DEFAULT_MODEL, "batch": False}, stage="routing", stage_detail=None)
    generate_draft(caller, draft_id)


def _wrong_page(lines: list, pages: list[dict]) -> None:
    """A verbatim quote cited on the wrong page: its page found by code among `pages` (free, before any retry)."""
    for t in lines:
        if t[2]["quote_status"] == "failed":
            hits = [p for p in pages if check.check(t[1]["source"]["quote"], p) != "failed"]
            if len(hits) == 1:
                t[1]["source"]["page"] = hits[0]["printed_page"]
                t[2]["quote_status"] = check.check(t[1]["source"]["quote"], hits[0])


def _figures(lines: list, pages: list[dict]) -> None:
    """A line the model read from a figure image it was shown: "parsed" + from_figure, the reviewer confirms it."""
    shown = {p["printed_page"] for p in pages if p.get("png")}
    for t in lines:
        if t[2]["quote_status"] == "failed" and t[1].get("from_figure") and t[1]["source"]["page"] in shown:
            t[2].update(quote_status="parsed", from_figure=True, reason="lue sur l'image de la figure : à confirmer")


def _initial(section, answer, by_printed, model, pages) -> list:
    """One section's lines with their first check: [place, line, meta]."""
    lines = []
    for place, line in assemble.lines_of(answer, section):
        page = by_printed.get(line["source"]["page"])
        lines.append([place, line, {"quote_status": check.check(line["source"]["quote"], page),
                                    "from_figure": bool(line.get("from_figure")) or check.from_figure(line["source"]["quote"], page),
                                    "retries": 0, "model": model}])
    _wrong_page(lines, pages)
    _figures(lines, pages)
    return lines


def _retry(section, lines, by_printed, model, jobs, audience, source, log, errors) -> None:
    """Up to MAX_RETRIES correction calls for the section's failed quotes."""
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


def _section_lines(section, answer, by_printed, model, jobs, audience, source, log, errors) -> list:
    """One section's lines checked on the PDF, corrected up to MAX_RETRIES times: [place, line, meta]."""
    lines = _initial(section, answer, by_printed, model, jobs.get(section, []))
    _retry(section, lines, by_printed, model, jobs, audience, source, log, errors)
    return lines


def _verified(meta: dict) -> bool:
    return meta["quote_status"] in ("pdf", "parsed")


def generate(store, document_id: str, offset: int | None, pdf_bytes, filename: str, form: dict, model: str, batch: bool, log,
             progress=lambda stage, detail: None, fallback: str | None = None) -> tuple[dict, dict, list[dict], list[str], dict]:
    """The pipeline: (fiche, side data by element id, dropped lines, section errors, report). Layers are read from
    document_pages (store); `log` receives every call's cost; `progress(stage, detail)` the steps."""
    audience = ", ".join(form.get("audience") or ["MG", "urgences"])
    source = form["source"]
    log = log if isinstance(log, Budget) else Budget(log, max_usd())
    rows = store.pages(document_id)
    pdf_cache: list[bytes] = []

    def pdf() -> bytes:
        if not pdf_cache:
            pdf_cache.append(pdf_bytes())
        return pdf_cache[0]

    needed: set[int] = set()  # PDF pages whose LlamaParse layer this run uses
    pngs: dict[int, bytes] = {}  # figure pages shown to Claude, by printed page

    def layers():
        ps = [p for p in ingest.as_layers(rows, offset, needed) if not p["skip"]]
        for p in ps:
            if p["printed_page"] in pngs:
                p["png"] = pngs[p["printed_page"]]
        return ps, {p["printed_page"]: p for p in ps}

    def llamaparse(pdf_pages: set[int]) -> tuple[int, float]:
        n, usd = ingest.parse_pages(store, rows, pdf_pages, pdf, filename)
        needed.update(pdf_pages)
        if n:
            log({"stage": "llamaparse", "section": None, "model": f"llamaparse:{ingest.tier_name()}", "batch": False, "input_tokens": n,
                 "output_tokens": 0, "cache_read_tokens": 0, "cache_write_tokens": 0, "cost_usd": usd})
        return n, usd

    pages, by_printed = layers()
    progress("routing", "répartition des pages par section")
    routing = llm.route(pages, audience, log)
    wanted = [n for n in dict.fromkeys(n for s in SECTIONS for n in routing["sections"].get(s, [])) if n in by_printed]

    progress("parsing", "LlamaParse des tableaux de posologies retenus ; figures en images")
    dose_tables = coverage.dose_table_pages(pages)
    sent, lp_cost = llamaparse({by_printed[n]["pdf_page"] for n in wanted if n in dose_tables})
    for n in wanted:
        if by_printed[n]["has_figure"]:
            pngs[n] = ingest.page_png(pdf(), by_printed[n]["pdf_page"])
    pages, by_printed = layers()

    def jobs_of():
        js = {s: [by_printed[n] for n in routing["sections"][s] if n in by_printed] for s in SECTIONS if s != "12_ordonnance"}
        return {s: ps for s, ps in js.items() if ps}

    jobs = jobs_of()
    progress("generating", f"{len(jobs)} section(s), {model}{' en lot' if batch else ''}, {len(pngs)} figure(s) en image")
    answers = llm.sections(jobs, audience, source, model, log, batch=batch)

    progress("checking", "vérification des citations")
    errors: list[str] = []
    checked: dict[str, list] = {}
    for section, answer in answers.items():
        if isinstance(answer, Exception):
            errors.append(f"{section} : {answer}")
        else:
            checked[section] = _initial(section, answer, by_printed, model, jobs[section])

    # lazy parsing: the pages where quotes still fail on the pdftotext text
    lazy = sorted({by_printed[t[1]["source"]["page"]]["pdf_page"] for ls in checked.values() for t in ls
                   if t[2]["quote_status"] == "failed" and t[1]["source"]["page"] in by_printed} - needed)[:LAZY_MAX]
    lazy_sent, lazy_cost = 0, 0.0
    if lazy:
        progress("parsing", f"LlamaParse de {len(lazy)} page(s) aux citations introuvables")
        lazy_sent, lazy_cost = llamaparse(set(lazy))
        pages, by_printed = layers()
        jobs = jobs_of()
        for section, lines in checked.items():
            for t in lines:
                if t[2]["quote_status"] == "failed":
                    t[2]["quote_status"] = check.check(t[1]["source"]["quote"], by_printed.get(t[1]["source"]["page"]))
            _wrong_page(lines, jobs.get(section, []))

    kept: dict[str, list] = {}
    dropped: list[dict] = []
    fell_back = []
    for section, lines in checked.items():
        if log.tight():
            errors.append(f"{section} : corrections sautées (plafond de coût {log.limit:.2f} $)")
        else:
            _retry(section, lines, by_printed, model, jobs, audience, source, log, errors)
        if fallback and fallback != model and not log.tight() and any(t[2]["quote_status"] == "failed" for t in lines):
            # the section still fails after its corrections: one rerun on the fallback model, kept if it verifies more
            again = llm.sections({section: jobs[section]}, audience, source, fallback, log)[section]
            if not isinstance(again, Exception):
                other = _section_lines(section, again, by_printed, fallback, jobs, audience, source, log, errors)
                good = lambda ls: sum(_verified(t[2]) for t in ls) - sum(t[2]["quote_status"] == "failed" for t in ls)  # noqa: E731
                if good(other) > good(lines):
                    lines, answers[section] = other, again
                    fell_back.append(section)
        kept[section] = [(pl, ln, m) for pl, ln, m in lines if _verified(m)]
        dropped += [{"section": section, "line": ln, "reason": m.get("reason") or f"citation introuvable page {ln['source']['page']} après {MAX_RETRIES} corrections"}
                    for pl, ln, m in lines if not _verified(m)]

    # coverage: every recommendation and dose row in the fiche, or out of the audience
    progress("coverage", "couverture des recommandations et des posologies")
    rows_c = coverage.rows_of(pages)
    moved = coverage.harm_to_8(rows_c, kept)
    hits = coverage.match(rows_c, coverage.items_of_kept(kept))
    excluded_ids: set[int] = {r["id"] for r in rows_c if r["excluded"]}  # topics outside the audience, never forced in
    topics: list[str] = sorted({r["excluded"] for r in rows_c if r["excluded"]})
    pct_before = round(100 * len(set(hits) | excluded_ids) / len(rows_c), 1) if rows_c else 100.0
    by_section: dict[str, list[dict]] = {}
    for r in rows_c:
        if r["id"] not in hits and r["id"] not in excluded_ids:
            by_section.setdefault(coverage.section_for(r, routing["sections"]), []).append(r)
    # one targeted call per section, COVER_ROWS rows at a time (a long answer gets cut at max_tokens)
    todo = [(s, rs[i:i + COVER_ROWS]) for s, rs in by_section.items() for i in range(0, len(rs), COVER_ROWS)]

    def cover(item):
        section, rs = item
        try:
            return section, rs, llm.cover(section, rs, audience, source, model, log)
        except Exception as exc:
            return section, rs, exc

    if log.tight():
        errors.append(f"couverture : appel ciblé sauté (plafond de coût {log.limit:.2f} $)")
        todo = []
    with ThreadPoolExecutor(llm.PARALLEL) as pool:
        covered = list(pool.map(cover, todo))
    for section, rs, ans in covered:
        if isinstance(ans, Exception):
            errors.append(f"{section} (couverture) : {ans}")
            continue
        for e in ans.get("excluded") or []:
            if 0 <= e["row"] < len(rs):
                excluded_ids.add(rs[e["row"]]["id"])
                topics.append(e["topic"])
        near = [by_printed[n] for n in sorted({r["page"] + d for r in rs for d in (-1, 0, 1)}) if n in by_printed]
        lines = _initial(section, ans, by_printed, model, near)
        for t in lines:
            t[2]["coverage"] = True
        kept.setdefault(section, []).extend((pl, ln, m) for pl, ln, m in lines if _verified(m))
        dropped += [{"section": section, "line": ln, "reason": f"couverture : citation introuvable page {ln['source']['page']}"}
                    for pl, ln, m in lines if not _verified(m)]
    moved += coverage.harm_to_8(rows_c, kept)

    good_answers = {k: v for k, v in answers.items() if not isinstance(v, Exception)}
    excluded = list(dict.fromkeys([*routing["excluded_by_audience"], *topics]))
    fiche, side, duplicates = assemble.assemble(form, good_answers, kept, excluded)
    cov = coverage.report(rows_c, coverage.items_of_fiche(fiche), excluded_ids)
    cov.update(pct_before=pct_before, harm_moved=moved)
    report = {"llamaparse_pages": sent + lazy_sent, "llamaparse_usd": round(lp_cost + lazy_cost, 6), "table_pages": sent, "lazy_pages": lazy_sent,
              # what a first run of this PDF pays LlamaParse (pages already parsed by an earlier run included)
              "llamaparse_pages_needed": len(needed), "llamaparse_usd_needed": ingest.llamaparse_cost(len(needed)),
              "figure_pages": sorted(pngs), "routed_pages": len(wanted), "fallback_sections": fell_back, "coverage": cov,
              "spent_usd": round(log.spent, 4), "cap_usd": log.limit}
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
        fiche, side, dropped, errors, report = generate(RestStore(caller), d["document_id"], d["page_offset"], pdf, d["pdf_path"].rsplit("/", 1)[-1],
                                                   form, model, bool(opts.get("batch")), log,
                                                   lambda stage, detail: _update(caller, draft_id, stage=stage, stage_detail=detail), fallback)
        problems = validate(fiche)
        if problems:
            raise RuntimeError("fiche non conforme, non enregistrée : " + " ; ".join(problems[:5]))
        cov = report["coverage"]
        # the fiche first: a failure while saving the per-line data must not lose a paid generation
        _update(caller, draft_id, content=fiche, stage="done", status="draft", coverage=cov,
                stage_detail=f"citations vérifiées {fiche['meta']['quote_check']}, {len(dropped)} ligne(s) écartée(s), "
                             f"couverture {cov['pct']} % ({len(cov['uncovered'])} non couverte(s))",
                error="; ".join(errors)[:500] or None)
        try:
            rows = meta_rows(draft_id, side, dropped, model)
            for k in range(0, len(rows), 100):
                sb.rest(caller, "POST", "fiche_line_meta", body=rows[k:k + 100])
        except Exception as exc:  # the fiche is saved: the draft stays done, the badges are missing
            _update(caller, draft_id, error=f"Badges des lignes non enregistrés : {type(exc).__name__} {exc}"[:500])
    except Exception as exc:
        _update(caller, draft_id, stage="error", error=f"{type(exc).__name__} {exc}"[:500])


def meta_rows(draft_id: str, side: dict, dropped: list[dict], model: str) -> list[dict]:
    """fiche_line_meta rows: kept lines (by element id) and dropped ones. Every row has the same keys: PostgREST
    rejects a bulk insert whose objects differ (PGRST102)."""
    rows = [{"draft_id": draft_id, "element_id": eid, "section": m["section"], "quote_status": m["quote_status"], "from_figure": m["from_figure"],
             "retries": m["retries"], "model": m["model"], "dropped": False, "dropped_line": None, "reason": m.get("reason")} for eid, m in side.items()]
    rows += [{"draft_id": draft_id, "element_id": f"dropped-{i + 1}", "section": x["section"], "quote_status": None, "from_figure": False,
              "retries": 0, "model": model, "dropped": True, "dropped_line": x["line"], "reason": x["reason"]} for i, x in enumerate(dropped)]
    return rows


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

