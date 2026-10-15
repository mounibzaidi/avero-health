"""Import the old fiches (carryover/content) into the MedGuides fiche schema (packages/schema).

    python3 tools/import/import_content.py [path/to/carryover]

Writes content/fiches/<topic>.json and content/fiches/import-report.txt. Mechanical only: no clinical
text is written; every text, quote and dose field comes from the input files. Whatever does not fit is
reported, never forced or guessed. Started from carryover/conversion_check/convert.py.

Sources (decision Q8, 2026-10-14): stroke and ACS from their numbered v1 files, eclampsia from the
agreed skill format (as_given.json). HTA and cardiac arrest are not imported.
"""

import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
CARRYOVER = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT.parent / "carryover"
OUT = ROOT / "content" / "fiches"

# (topic in topics.yaml, input file, format)
JOBS = [
    ("stroke", "content/protocols/stroke/e61174cfe7/v0001.json", "v1"),
    ("acs", "content/protocols/acs/32b53e31a1/v0001.json", "v1"),
    ("eclampsia", "content/protocols/eclampsia/220e69e1/as_given.json", "skill"),
]
# The v4 draft of eclampsia is not imported (Q8); its quotes missing from as_given are listed for review.
ECLAMPSIA_V4 = "content/protocols/eclampsie.json"

SECTION_KEYS = {1: "1_essentiel", 2: "2_presentation", 3: "3_champ", 4: "4_gravite", 5: "5_conduite", 6: "6_examens",
                7: "7_traitement", 8: "8_ne_pas_faire", 9: "9_orientation", 10: "10_surveillance", 11: "11_suivi",
                12: "12_ordonnance", 13: "13_definitions"}
# protocol_v1 register codes -> the skill's labels (CONFIRM Q15). Codes with no 1:1 label are reported.
STATUT_V1 = {"enregistre": "Enregistré", "absent_du_registre": "Aucune présentation enregistrée",
             "retire_ou_non_renouvele": None, "enregistre_dosage_non_verifie": None, "aucune_presentation_adaptee": None}
STATUT_LABELS = {"Enregistré", "Non renouvelé", "Retiré", "Aucune présentation enregistrée"}
REF = re.compile(r"voir fiche ([a-z0-9-]+)")

findings: dict[str, list[str]] = {}


def note(topic, msg):
    findings.setdefault(topic, []).append(msg)


def statut(topic, pid, v):
    if v is None or v in STATUT_LABELS:
        return v, None
    label = STATUT_V1.get(v)
    if label is None:
        note(topic, f"posologie {pid}: algerie.statut {v!r} has no label (Q15); kept in note, statut null")
        return None, f"Algérie : {v}"
    return label, None


def specialites():
    d = yaml.safe_load((ROOT / "shared/topics.yaml").read_text(encoding="utf-8"))
    out = {}
    for kind in ("emergencies", "gp_consultations"):
        for group, items in (d.get(kind) or {}).items():
            for t in items or []:
                out[t["id"]] = d["groups"][kind][group]
    return out


def empty_sections(template):
    s = {k: {"state": "non_traité", "elements": []} for k in SECTION_KEYS.values()}
    s["2_presentation"] = {"state": "non_traité", "signes_typiques": [], "formes_trompeuses": [], "examen_clinique": [],
                           "criteres_diagnostiques": [], "diagnostics_differentiels": []}
    s["4_gravite"] = {"state": "non_traité", "signes_de_gravite": [], "gestes_immediats": {"state": "non_traité", "elements": []}}
    if template == "urgence":
        s["4_gravite"]["decision_initiale"] = {"state": "non_traité", "elements": []}
    s["5_conduite"] = {"state": "non_traité", "nodes": []}
    s["7_traitement"] = {"state": "non_traité", "elements": [], "contre_indications": {"state": "non_traité", "elements": []}, "posologies": []}
    s["11_suivi"] = {"state": "non_traité", "elements": [], "conseils_patient": []}
    return s


def source_ref(src, sid):
    if not src:
        return None
    out = {"source_id": sid.get(src["source_id"], src["source_id"]), "page": src["page"], "quote": src["quote"]}
    if src.get("page_end"):
        out["page_end"] = src["page_end"]
    return out


def element(topic, e, src):
    """An element of the final schema from an old one (v1 or skill). Fields the schema has no place for are reported."""
    out = {"id": e["id"], "text": e["text"], "type": e.get("type") or "info", "condition": e.get("condition"), "order": e.get("order"),
           "source": src, "translated": bool(e.get("translated")), "grade": e.get("grade"), "risk": e["risk"],
           "origin": e.get("origin") or "explicit", "conflict_group": e.get("conflict_group"), "variant_group": None,
           "missing": e.get("missing") or [], "refs": REF.findall(e["text"]), "attached_to": [], "delai": None}
    for opt in ("timing", "reason", "reviewer", "checked"):
        if e.get(opt) is not None:
            out[opt] = e[opt]
    if e.get("cells") is not None:
        out["cells"] = {k: (v if isinstance(v, str) else "") for k, v in e["cells"].items()}
    known = set(out) | {"subsection", "group", "dose", "algerie", "cells", "page_end"}
    extra = sorted(k for k in e if k not in known and e[k] not in (None, [], ""))
    if extra:
        note(topic, f"element {e['id']}: no field for {extra}")
    return out


def posologie(topic, pid, e, dz, src, sid_checked):
    st, st_note = statut(topic, pid, (e.get("algerie") or {}).get("statut"))
    p = {"id": pid, "drug_dci": dz["drug_dci"], "dose": dz["dose"], "dose_max": dz.get("dose_max"), "route": dz.get("route") or "",
         "administration": dz.get("administration"), "frequency_or_duration": dz.get("frequency_or_duration") or dz.get("duree_frequence") or "",
         "condition": e.get("condition"), "risk": e["risk"], "source": src, "translated": bool(e.get("translated")),
         "missing": e.get("missing") or [], "titration": None,
         "algerie": {"brands": (e.get("algerie") or {}).get("brands", []), "statut": st}, "note": e.get("note") or st_note}
    if sid_checked:
        p["checked"] = sid_checked
    lost = [f for f in ("grade", "timing", "reason", "conflict_group") if e.get(f)]
    if lost:
        note(topic, f"posologie {pid}: no field on a posologie for {lost} (values: {[e[f] for f in lost]})")
    if not p["route"]:
        note(topic, f"posologie {pid}: route empty in the source file; reviewer to fill from the quote")
    return p


def attach_by_drug(topic, el, posologies):
    """A local-adaptation line written under a dose ("Ticagrelor : ...") is attached to that drug's posologies."""
    head = el["text"].split(":", 1)[0].strip().upper()
    ids = [p["id"] for p in posologies if p["drug_dci"].upper() in head or head in p["drug_dci"].upper()]
    el["attached_to"] = ids
    note(topic, f"{el['id']} (local adaptation, no dose fields, was under posologies): imported as a 7_traitement line, "
                f"attached to {ids or 'nothing (no posologie of that drug)'}")


# ─── numbered v1 ─────────────────────────────────────────────────────────────────────────────

def from_v1(topic, d):
    m = d["meta"]
    template = m["template"]
    sid = {s["source_id"]: (s.get("cited_as") or s["source_id"]) for s in m["sources"]}
    sources = []
    for s in m["sources"]:
        src = {"source_id": sid[s["source_id"]], "type": s.get("type"), "title": s["title"], "citation": s.get("citation") or s.get("org"),
               "licence": s.get("licence") or "", "language": s.get("language")}
        if s.get("page_offset"):
            src["page_offset"] = s["page_offset"]
        if s.get("pdf"):
            src["pdf_path"] = s["pdf"]
        for k in sorted(set(s) - {"source_id", "cited_as", "type", "title", "citation", "org", "licence", "language", "page_offset", "pdf"}):
            note(topic, f"meta.sources {sid[s['source_id']]}: no field for {k!r} ({str(s[k])[:80]!r})")
        sources.append({k: v for k, v in src.items() if v is not None})
    meta = {"title": m["title"], "topic_id": m["topic_id"], "template": template,
            "audience": m["audience"] if isinstance(m["audience"], list) else [m["audience"]],
            "version": str(m["version"]), "status": m["status"], "reviewer": m.get("reviewer"), "reviewed_at": m.get("reviewed_at"),
            "siblings": m.get("siblings") or [], "sources": sources, "excluded_by_audience": m.get("excluded_by_audience") or []}
    S = empty_sections(template)
    present = set()
    later = []  # local-adaptation lines from under posologies, attached once all posologies are known
    for sec in d["sections"]:
        n, key = sec["n"], SECTION_KEYS[sec["n"]]
        present.add(n)
        nodes: dict[str, list] = {}
        for e in sec["elements"]:
            src = source_ref(e.get("source"), sid)
            sub = e.get("subsection")
            if not src and e.get("origin") != "local_adaptation":
                note(topic, f"{key} {e['id']}: explicit line without a quote, not imported: {e['text']!r}")
                continue
            if sub == "posologies":
                dz = e.get("dose") or {}
                if dz.get("drug_dci") and dz.get("dose") and src:
                    S[key]["posologies"].append(posologie(topic, e["id"], e, dz, src, e.get("checked")))
                    continue
                el = element(topic, e, src)
                S[key]["elements"].append(el)
                later.append(el)
                continue
            el = element(topic, e, src)
            if n == 2:
                S[key][sub or "signes_typiques"].append(el)
            elif n == 4:
                (S[key]["gestes_immediats"]["elements"] if sub == "gestes_immediats" else S[key]["signes_de_gravite"]).append(el)
            elif n == 5:
                if not e.get("group"):
                    note(topic, f"5_conduite {e['id']}: no group, so no node label; placed under the node of the previous line")
                label = e.get("group") or (list(nodes)[-1] if nodes else "")
                nodes.setdefault(label, []).append(el)
            elif n == 7:
                if e.get("group"):
                    note(topic, f"7_traitement {e['id']}: situation group {e['group']!r} has no field")
                (S[key]["contre_indications"]["elements"] if sub == "contre_indications" else S[key]["elements"]).append(el)
            else:
                S[key]["elements"].append(el)
        if n == 5:
            S[key]["nodes"] = [{"node": k, "branches": v} for k, v in nodes.items()]
            if "" in nodes:
                note(topic, "5_conduite: a node has no label in the source file")
        S[key]["state"] = sec["state"]
        if n == 4:
            S[key]["gestes_immediats"]["state"] = "filled" if S[key]["gestes_immediats"]["elements"] else "non_traité"
        if n == 7:
            S[key]["contre_indications"]["state"] = "filled" if S[key]["contre_indications"]["elements"] else "non_traité"
    for el in later:
        attach_by_drug(topic, el, S["7_traitement"]["posologies"])
    if 12 not in present:
        S["12_ordonnance"]["state"] = "sans_objet"
        note(topic, "12_ordonnance absent from the v1 urgence order: imported as sans_objet (hidden), to confirm by the reviewer")
    for k in ("saved_at", "imported_from", "published_as_given"):
        if m.get(k):
            note(topic, f"meta.{k} not kept: {m[k]!r}")
    return meta, S


# ─── skill format (as_given.json) ────────────────────────────────────────────────────────────

def from_skill(topic, d):
    m = d["meta"]
    template = m["template"]
    sid = {s["source_id"]: s["source_id"] for s in m["sources"]}
    S = empty_sections(template)
    src_sections = d["sections"]
    for key, sec in src_sections.items():
        S[key]["state"] = sec["state"]
        for sub, val in sec.items():
            if sub == "state":
                continue
            if sub == "posologies":
                for i, e in enumerate(val, 1):
                    pid = f"{m['topic_id']}-pos{i:02d}"
                    S[key]["posologies"].append(posologie(topic, pid, e, e, source_ref(e.get("source"), sid), e.get("checked")))
                note(topic, f"{len(val)} posologies had no id; given {m['topic_id']}-pos01 to -pos{len(val):02d} in file order")
                continue
            if sub == "nodes":
                S[key]["nodes"] = [{"node": nd["node"], "branches": [element(topic, e, source_ref(e.get("source"), sid)) for e in nd["branches"]]} for nd in val]
                continue
            lst = val["elements"] if isinstance(val, dict) else val
            out = [element(topic, e, source_ref(e.get("source"), sid)) for e in lst]
            if isinstance(val, dict):
                S[key][sub] = {"state": val.get("state", "filled" if out else "non_traité"), "elements": out}
            else:
                S[key][sub] = out
    meta = {k: m[k] for k in ("title", "topic_id", "template", "audience", "version", "status", "reviewer", "reviewed_at", "siblings",
                              "sources", "excluded_by_audience") if k in m}
    meta["version"] = str(meta["version"])
    if m.get("quote_check"):
        meta["quote_check"] = m["quote_check"]
    for k in sorted(set(m) - set(meta)):
        note(topic, f"meta.{k} not kept: {m[k]!r}")
    return meta, S


# ─── checks ──────────────────────────────────────────────────────────────────────────────────

def strings_in(obj, keys):
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in keys and isinstance(v, str) and v.strip():
                out.append(v)
            out += strings_in(v, keys)
    elif isinstance(obj, list):
        for v in obj:
            out += strings_in(v, keys)
    return out


def words(x):
    return set(re.findall(r"[0-9a-zà-ÿœ]+", x.lower()))


def lost_strings(topic, src, dst, keys):
    """Every content string of the input must be in the output, verbatim. A dose line built from its fields
    (posologies have no text field) counts as kept when every word of it is in one posologie's fields."""
    blob = json.dumps(dst, ensure_ascii=False)
    pos_words = [words(json.dumps(p, ensure_ascii=False)) for p in dst["sections"]["7_traitement"]["posologies"]]
    lost = []
    for s in strings_in(src, keys):
        if json.dumps(s, ensure_ascii=False)[1:-1] in blob:
            continue
        if any(words(s) <= pw for pw in pos_words):
            note(topic, f"dose line {s[:70]!r}: no text field on a posologie; every word of it is in that posologie's fields")
            continue
        lost.append(s)
    return lost


def v4_quotes_missing(as_given):
    def norm(s):
        import unicodedata
        s = "".join(c for c in unicodedata.normalize("NFKD", s.lower()) if not unicodedata.combining(c))
        return re.sub(r"[\W_]+", "", s)
    v4 = json.loads((CARRYOVER / ECLAMPSIA_V4).read_text(encoding="utf-8"))
    have = " ".join(norm(q) for q in strings_in(as_given["sections"], {"quote"}))
    return [q for q in strings_in(v4, {"q"}) if norm(q) not in have]


def main():
    # The brand nomenclature's description (its source label is shown under fiches that list brands).
    shared = ROOT / "content" / "shared"
    shared.mkdir(parents=True, exist_ok=True)
    (shared / "dz_brands.meta.json").write_bytes((CARRYOVER / "content/shared/dz_brands.meta.json").read_bytes())
    spec = specialites()
    OUT.mkdir(parents=True, exist_ok=True)
    keys = {"text", "quote", "dose", "dose_max", "route", "administration", "duree_frequence", "frequency_or_duration", "condition",
            "timing", "reason", "grade", "drug_dci", "note", "node"}
    lines = ["IMPORT REPORT", "", f"Source: {CARRYOVER}", ""]
    for topic, path, kind in JOBS:
        d = json.loads((CARRYOVER / path).read_text(encoding="utf-8"))
        meta, sections = (from_v1 if kind == "v1" else from_skill)(topic, d)
        meta.setdefault("motifs", [])
        meta.setdefault("synonymes", [])
        meta["specialite"] = spec.get(topic)
        if meta["topic_id"] != topic:
            note(topic, f"meta.topic_id is {meta['topic_id']!r} but the topic is {topic!r} in topics.yaml; kept as in the file")
        fiche = {"kind": "fiche", "meta": meta, "sections": sections}
        (OUT / f"{topic}.json").write_text(json.dumps(fiche, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        src_strings = strings_in(d["sections"], keys)
        lost = lost_strings(topic, d["sections"], fiche, keys)
        lines.append(f"== {topic} ({path}, {kind}): {len(src_strings)} content strings, {len(src_strings) - len(lost)} found verbatim, {len(lost)} not found")
        for s in lost:
            lines.append(f"   NOT IN OUTPUT: {s[:160]!r}")
        for f in findings.get(topic, []):
            lines.append(f"   - {f}")
        if topic == "eclampsia":
            missing = v4_quotes_missing(d)
            lines.append(f"   v4 draft {ECLAMPSIA_V4}: {len(missing)} quote(s) not in as_given.json (NOT imported, for review):")
            for q in missing:
                lines.append(f"     · {q[:160]!r}")
        lines.append("")
    (OUT / "import-report.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
