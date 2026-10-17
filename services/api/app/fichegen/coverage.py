"""The coverage check, by code only: is every recommendation and every dose of the guideline in the fiche.

Rows are read from the pdftotext layout layer:
- recommendation-table rows: number + COR + LOE + text ("2. In patients with a history of stroke [...]", "3: Harm",
  "B-R"), column by column (the COR and LOE tokens sit left of the row's text, on any of its lines);
- dose-table rows: inside a numbered table ("TABLE 7 ...") holding doses, every line with a dose ("Loading dose 180 mg
  orally"), with the drug of its first column carried down.
A recommendation row is covered when a fiche quote overlaps its text; a dose row when a posology quoted on its page
holds all its doses (a dose only in an element's text does not count). Rows the targeted call puts out of the audience's practice count as covered (excluded_by_audience).
Rows with COR "3: Harm" or "3: No Benefit" must be covered in 8_ne_pas_faire: matched lines elsewhere are moved there.
"""

import re

from .check import fragments, normalise
from .ingest import gutter

_COR = r"1|2a|2b|3:\s*No Benefit|3:\s*Harm"
_LOE = r"A|B-R|B-NR|C-LD|C-EO"
_TOKENS = re.compile(rf"(?<!\S)({_COR})\s+({_LOE})(?!\S)")
_START = re.compile(r"^(\d{1,2})\.\s+\S")
_CAPTION = re.compile(r"^\s*TABLE\s+(\d+)\b", re.I)
_TABLE_END = re.compile(r"\bindicates\b|^\s*(Adapted|Modified|Reproduced) ", re.I)
_MARK = re.compile(r"^\s*([*†‡§]+)")
DOSE = re.compile(r"(?<![\w.,])\d+(?:[.,]\d+)?(?:\s*(?:-|–|to|or)\s*\d+(?:[.,]\d+)?)?[\s-]*(?:mg|µg|μg|mcg|g|U|IU|units?|mL)(?:/(?:kg|min|h|d|day))*(?![A-Za-z/])")  # not lab values (mg/dL, g/dL, mL/min)
_DRUG = re.compile(r"^([A-Z][A-Za-z-]{2,})\*?(?:\s|$)")
_HEADERS = {"agent", "agents", "medication", "drug", "drugs", "dosing", "setting", "route", "class", "adults", "patients", "age", "these", "severe"}
HARM = re.compile(r"^3:\s*(Harm|No Benefit)$", re.I)


def _join(lines: list[str]) -> str:
    out = ""
    for l in lines:
        out = out + l if out.endswith("-") and l[:1].islower() else f"{out} {l}".strip()
    return out


def rec_rows(layout: str, printed: int) -> list[dict]:
    """The recommendation-table rows of one page: [{kind, page, number, cor, loe, text}]."""
    lines = layout.split("\n")
    g = gutter(lines)
    columns = [[l[:g] for l in lines], [l[g:] for l in lines]] if g else [lines]
    rows: list[dict] = []
    for col in columns:
        cur, pending, blanks = None, None, 0
        for raw in col:
            tok = None
            m = _TOKENS.search(raw)
            if m and not raw[:m.start()].strip():  # the tokens open the line: COR and LOE columns
                tok = (" ".join(m.group(1).split()), m.group(2))
                raw = raw[:m.start()] + " " * (m.end() - m.start()) + raw[m.end():]
            text = raw.strip()
            indent = len(raw) - len(raw.lstrip())
            if text:
                blanks = 0
            if _START.match(text):
                cur = {"kind": "rec", "page": printed, "number": int(_START.match(text).group(1)), "cor": None, "loe": None, "lines": [text], "indent": indent}
                rows.append(cur)
                if pending:
                    cur["cor"], cur["loe"], pending = *pending, None
            elif not text:
                blanks = 0 if tok else blanks + 1
                if blanks >= 2:
                    cur = None  # two blank lines end the row (pdftotext puts single ones inside rows)
            elif cur and indent >= cur["indent"] - 1:
                cur["lines"].append(text)
            else:
                cur = None
            if tok:
                if cur and cur["cor"] is None:
                    cur["cor"], cur["loe"] = tok
                else:
                    pending = tok
    return [{"kind": "rec", "page": r["page"], "number": r["number"], "cor": r["cor"], "loe": r["loe"], "text": _join(r["lines"])}
            for r in rows if r["cor"]]


def dose_rows(layout: str, printed: int) -> list[dict]:
    """The dose-table rows of one page: [{kind, page, table, drug, doses (normalised), text}]."""
    out: list[dict] = []
    lines = layout.split("\n")
    i = 0
    while i < len(lines):
        cap = _CAPTION.match(lines[i])
        if not cap:
            i += 1
            continue
        region, blanks, j = [], 0, i + 1
        while j < len(lines) and not _TABLE_END.search(lines[j]) and blanks < 3:
            blanks = blanks + 1 if not lines[j].strip() else 0
            region.append(lines[j])
            j += 1
        i = j
        filled = [l for l in region if l.strip()]
        if sum(len(DOSE.findall(l)) for l in filled) < 2:
            continue  # not a dose table
        margin = min(len(l) - len(l.lstrip()) for l in filled)
        drug, marked = None, {}
        for l in filled:
            note = _MARK.match(l)
            if note:  # a footnote ("*30 mg for weight <60 kg") belongs to the drug whose row carries its mark
                drug = marked.get(note.group(1), drug)
            else:
                m = _DRUG.match(l.strip())
                if m and len(l) - len(l.lstrip()) <= margin + 2 and m.group(1).lower() not in _HEADERS:
                    drug = m.group(1)
                for mark in re.findall(r"[a-z)\d]([*†‡§]+)", l):
                    marked.setdefault(mark, drug)
            doses = [d for d in DOSE.findall(l) if not normalise(d).endswith("mlmin")]  # creatinine clearance, not a dose
            if doses and drug:
                out.append({"kind": "dose", "page": printed, "table": int(cap.group(1)), "drug": drug,
                            "doses": [normalise(d) for d in doses], "text": f"{drug} : {' '.join(l.split())}"})
    return out


def rows_of(pages: list[dict]) -> list[dict]:
    """Every recommendation and dose row of the guideline's pages (pipeline layers, references skipped), numbered."""
    rows = []
    for p in pages:
        if p.get("skip"):
            continue
        rows += rec_rows(p["raw_layout"] or "", p["printed_page"]) + dose_rows(p["raw_layout"] or "", p["printed_page"])
    for i, r in enumerate(rows):
        r["id"] = i
    return rows


def _rec_match(row_norm: str, quote: str) -> bool:
    """A quote overlaps a recommendation row: one of its parts (30 characters at least, or most of the row) is inside
    the row, or the row's start is inside the quote."""
    need = min(30, int(len(row_norm) * 0.6))
    if any(len(f) >= need and f in row_norm for f in fragments(quote)):
        return True
    return len(row_norm) >= 30 and row_norm[:60] in normalise(quote)


def match(rows: list[dict], items: list[dict]) -> dict[int, list[int]]:
    """{row id: indexes of the items covering it}. An item: {section, page, quote, extra} (extra: the dose fields)."""
    norm_items = [(normalise(f"{it['quote']} {it.get('extra') or ''}"), it) for it in items]
    out: dict[int, list[int]] = {}
    for r in rows:
        hits = []
        if r["kind"] == "rec":
            rn = normalise(r["text"])
            hits = [k for k, (_, it) in enumerate(norm_items) if _rec_match(rn, it["quote"])]
        else:
            hits = [k for k, (n, it) in enumerate(norm_items) if it.get("dose") and it["page"] == r["page"] and all(d in n for d in r["doses"])]
        if hits:
            out[r["id"]] = hits
    return out


def items_of_kept(kept: dict[str, list]) -> list[dict]:
    """The checked lines before assembly as coverage items, with a pointer back to their place."""
    items = []
    for section, lines in kept.items():
        for k, (place, line, _meta) in enumerate(lines):
            extra = f"{line.get('dose', '')} {line.get('dose_max') or ''}" if place == "posologies" else ""
            items.append({"section": section, "place": place, "index": k, "page": line["source"]["page"], "quote": line["source"]["quote"], "extra": extra,
                          "dose": place == "posologies"})
    return items


def items_of_fiche(fiche: dict) -> list[dict]:
    """Every line of an assembled fiche as coverage items."""
    items = []
    for section, sec in fiche["sections"].items():
        lists = [v for v in sec.values() if isinstance(v, list)]
        lists += [v["elements"] for v in sec.values() if isinstance(v, dict) and "elements" in v]
        lists += [n["branches"] for n in sec.get("nodes") or []]
        for lst in lists:
            for el in lst:
                if isinstance(el, dict) and "source" in el:
                    items.append({"section": section, "page": el["source"]["page"], "quote": el["source"]["quote"],
                                  "extra": f"{el.get('dose', '')} {el.get('dose_max') or ''}" if "drug_dci" in el else "", "dose": "drug_dci" in el})
    return items


def harm_to_8(rows: list[dict], kept: dict[str, list]) -> int:
    """Lines covering a "3: Harm" / "3: No Benefit" row moved to 8_ne_pas_faire (doses stay). Returns how many moved."""
    harm = [r for r in rows if r["kind"] == "rec" and HARM.match(r["cor"] or "")]
    items = items_of_kept(kept)
    hits = match(harm, items)
    if any(items[k]["section"] == "8_ne_pas_faire" for ks in hits.values() for k in ks):
        pass  # rows already covered in 8 still move their other copies: assembly drops the duplicates
    move = sorted({(items[k]["section"], items[k]["index"]) for ks in hits.values() for k in ks
                   if items[k]["section"] != "8_ne_pas_faire" and items[k]["place"] != "posologies"}, reverse=True)
    for section, k in move:
        _place, line, meta = kept[section].pop(k)
        kept.setdefault("8_ne_pas_faire", []).append(("elements", line, meta))
    return len(move)


def report(rows: list[dict], items: list[dict], excluded_ids: set[int]) -> dict:
    """Coverage of the rows by the items: %, counts, and the rows still not covered (for the reviewer)."""
    hits = match(rows, items)
    harm = [r for r in rows if r["kind"] == "rec" and HARM.match(r["cor"] or "")]
    harm_ok = sum(1 for r in harm if r["id"] in excluded_ids or any(items[k]["section"] == "8_ne_pas_faire" for k in hits.get(r["id"], [])))
    covered = [r for r in rows if r["id"] in hits or r["id"] in excluded_ids]
    uncovered = [r for r in rows if r["id"] not in hits and r["id"] not in excluded_ids]
    return {"rows": len(rows), "rec_rows": sum(r["kind"] == "rec" for r in rows), "dose_rows": sum(r["kind"] == "dose" for r in rows),
            "matched": sum(1 for r in rows if r["id"] in hits), "excluded": len(excluded_ids), "harm_rows": len(harm), "harm_in_8": harm_ok,
            "pct": round(100 * len(covered) / len(rows), 1) if rows else 100.0,
            "uncovered": [{k: r[k] for k in ("kind", "page", "text", "cor", "loe") if k in r} for r in uncovered]}


# the section a row's targeted call writes in: harm rows in 8, doses in 7, else by its words, else the routing
_SECTION_WORDS = [("6_examens", re.compile(r"\b(ECG|electrocardiogra\w*|troponin|cTn|imaging|echocardiograph\w*)\b", re.I)),
                  ("9_orientation", re.compile(r"\b(transfer\w*|transport\w*|EMS|referr\w*|PCI-capable|regional system)\b", re.I)),
                  ("11_suivi", re.compile(r"\b(discharge|rehabilitation|follow-up|education|immuniz\w*|vaccin\w*|smoking)\b", re.I)),
                  ("10_surveillance", re.compile(r"\b(monitor\w*|telemetry|length of stay)\b", re.I)),
                  ("7_traitement", re.compile(r"\b(administered|therapy|inhibitor|aspirin|statin|anticoagula\w*|beta[- ]blocker|dose)\b", re.I))]
_PRIORITY = ["7_traitement", "5_conduite", "6_examens", "4_gravite", "9_orientation", "10_surveillance", "11_suivi", "2_presentation",
             "1_essentiel", "13_definitions", "3_champ"]


def section_for(row: dict, routing: dict[str, list[int]]) -> str:
    if row["kind"] == "dose":
        return "7_traitement"
    if HARM.match(row["cor"] or ""):
        return "8_ne_pas_faire"
    routed = [s for s in _PRIORITY if row["page"] in routing.get(s, [])]
    for s, rx in _SECTION_WORDS:
        if rx.search(row["text"]) and (not routed or s in routed):
            return s
    return routed[0] if routed else "5_conduite"
