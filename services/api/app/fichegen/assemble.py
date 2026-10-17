"""Part B3: Claude's section answers assembled into a fiche-protocole fiche, by code only.

Ids `{topic_id}-{nnn}`, "translated" for a non-French quote, branch "order", source_id from the form, every dose's
"algerie" block left for the reviewer (statut null, "algerie.statut" in its missing list). The per-line pipeline data
(quote status, figure, retries, model) never enters the fiche: it is returned apart, by element id, for the side
table. Lines found in two sections keep the place rule 4 gives them (symptoms in 2, ECG and biology in 6, do-not
lines in 8); the other copy is dropped with its reason.
"""

import re

from .check import normalise
from .schema import SECTIONS

NOT_CHECKED = "Nomenclature algérienne non consultée : marques et statut à compléter."
_FR = re.compile(r"\b(le|la|les|des|du|et|pour|chez|avec|une?|est|sont|dans|patients?)\b", re.I)
_SYMPTOM = re.compile(r"\b(douleur|dyspn|symptôme|signe|malaise|syncope|palpitation|sueur|nausée)", re.I)
_EXAM = re.compile(r"\b(ECG|électrocardiogramme|troponine|biolog|dosage|bilan|hémogramme|créatinine|kaliémie|échograph|scanner|IRM|radiograph)", re.I)
_DONOT = re.compile(r"\b(ne pas|pas de|éviter|contre-indiqu|should not|not recommended|avoid)\b", re.I)
# Rule 4, enforced by code: an ECG or biology line belongs in 6_examens, a do-not line in 8_ne_pas_faire.
_ECG_BIO = re.compile(r"\b(ECG|électrocardiogramme|troponine|cTn|biolog\w*|kaliémie|créatinine|hémogramme|glycémie|bilan lipidique)\b", re.I)
_DONOT_LINE = re.compile(r"^\s*(ne (pas|jamais)|pas d[e']|éviter|ne doit pas)\b", re.I)
_DONOT_QUOTE = re.compile(r"\b(should not|is not recommended|are not recommended|avoid)\b", re.I)


def placed(section: str, place: str, line: dict) -> tuple[str, str]:
    """Where rule 4 puts a line: (section, place). Doses, contraindications and decision-tree branches stay put."""
    if place in ("posologies", "contre_indications") or place.startswith("node:"):
        return section, place
    if section != "8_ne_pas_faire" and (_DONOT_LINE.search(line.get("text", "")) or _DONOT_QUOTE.search(line["source"]["quote"])):
        return "8_ne_pas_faire", "elements"
    if section not in ("6_examens", "8_ne_pas_faire") and _ECG_BIO.search(line.get("text", "")):
        return "6_examens", "elements"
    return section, place


def is_french(text: str) -> bool:
    return len(_FR.findall(text or "")) >= 3


def empty_fiche(form: dict) -> dict:
    src = form["source"]
    return {
        "meta": {
            "title": form["title"], "topic_id": form["topic_id"], "template": form.get("template") or "urgence",
            "audience": form.get("audience") or ["MG", "urgences"], "version": "0.1", "status": "draft", "reviewer": None, "reviewed_at": None,
            "siblings": form.get("siblings") or [],
            "sources": [{"source_id": src["source_id"], "type": src.get("type") or "full_guideline", "title": src["title"],
                         "citation": src["citation"], "licence": form.get("licence_text") or ""}],
            "excluded_by_audience": [], "quote_check": "0/0",
        },
        "sections": {
            "1_essentiel": {"state": "non_traité", "elements": []},
            "2_presentation": {"state": "non_traité", "signes_typiques": [], "formes_trompeuses": [], "examen_clinique": []},
            "3_champ": {"state": "non_traité", "elements": []},
            "4_gravite": {"state": "non_traité", "signes_de_gravite": [], "gestes_immediats": {"state": "non_traité", "elements": []}},
            "5_conduite": {"state": "non_traité", "nodes": []},
            "6_examens": {"state": "non_traité", "elements": []},
            "7_traitement": {"state": "non_traité", "elements": [], "contre_indications": {"state": "non_traité", "elements": []}, "posologies": []},
            "8_ne_pas_faire": {"state": "non_traité", "elements": []},
            "9_orientation": {"state": "non_traité", "elements": []},
            "10_surveillance": {"state": "non_traité", "elements": []},
            "11_suivi": {"state": "non_traité", "elements": []},
            "12_ordonnance": {"state": "sans_objet", "elements": []},
            "13_definitions": {"state": "non_traité", "elements": []},
        },
    }


def lines_of(answer: dict, section: str) -> list[tuple[str, dict]]:
    """(place, line) for every line of one section's answer; place names the list it goes in."""
    if section == "2_presentation":
        return [(k, x) for k in ("signes_typiques", "formes_trompeuses", "examen_clinique") for x in answer.get(k) or []]
    if section == "4_gravite":
        return [(k, x) for k in ("signes_de_gravite", "gestes_immediats") for x in answer.get(k) or []]
    if section == "5_conduite":
        return [(f"node:{i}", x) for i, n in enumerate(answer.get("nodes") or []) for x in n.get("branches") or []]
    if section == "7_traitement":
        return ([(k, x) for k in ("elements", "contre_indications") for x in answer.get(k) or []]
                + [("posologies", x) for x in answer.get("posologies") or []])
    return [("elements", x) for x in answer.get("elements") or []]


def preferred(line: dict) -> str | None:
    """The section rule 4 assigns a line to, if any."""
    text = f"{line.get('text', '')} {line.get('source', {}).get('quote', '')}"
    if _DONOT.search(text):
        return "8_ne_pas_faire"
    if _EXAM.search(text):
        return "6_examens"
    if _SYMPTOM.search(text):
        return "2_presentation"
    return None


def assemble(form: dict, answers: dict[str, dict], kept: dict[str, list[tuple[str, dict, dict]]], excluded: list[str]) -> tuple[dict, dict, list[dict]]:
    """(fiche, side data by element id, dropped duplicates). `kept[section]` = [(place, line, meta)] after the quote
    check; `answers` gives each section's node labels."""
    fiche = empty_fiche(form)
    fiche["meta"]["excluded_by_audience"] = excluded
    sid, tid = form["source"]["source_id"], form["topic_id"]
    side: dict[str, dict] = {}
    dropped: list[dict] = []

    # rule 4: lines in the wrong section move to the right one (before the duplicates are found)
    moved: dict[str, list] = {}
    for section in SECTIONS:
        for place, line, meta in kept.get(section, []):
            to, where = placed(section, place, line)
            moved.setdefault(to, []).append((where, line, meta))
    kept = moved

    # duplicates across sections: same normalised quote or near-identical text
    seen: dict[str, str] = {}
    for section in SECTIONS:
        for place, line, meta in list(kept.get(section, [])):
            key = normalise(line["source"]["quote"])[:200] or normalise(line.get("text", ""))[:200]
            if seen.get(key) == section:  # the same line twice in one section (e.g. after a rule 4 move): keep the first
                kept[section] = [t for t in kept[section] if t[1] is not line]
                dropped.append({"section": section, "line": line, "reason": f"doublon dans la section {section}"})
            elif key in seen:
                first = seen[key]
                want = preferred(line)
                loser = section if want != section else first
                if loser == first:  # the earlier copy is in the wrong section: drop it there instead
                    kept[first] = [t for t in kept[first] if (normalise(t[1]["source"]["quote"])[:200] or normalise(t[1].get("text", ""))[:200]) != key]
                    seen[key] = section
                else:
                    kept[section] = [t for t in kept[section] if t[1] is not line]
                dropped.append({"section": loser, "line": line, "reason": f"doublon (gardé en {seen[key]})"})
            else:
                seen[key] = section

    n = 0
    total = verified = 0
    for section in SECTIONS:
        items = kept.get(section, [])
        sec = fiche["sections"][section]
        answer = answers.get(section) or {}
        if section == "5_conduite":
            nodes = [{"node": nd.get("node") or "", "branches": []} for nd in answer.get("nodes") or []]
        for place, line, meta in items:
            total += 1
            verified += meta.get("quote_status") in ("pdf", "parsed")
            quote = line["source"]["quote"]
            if place == "posologies":
                missing = list(line.get("missing") or [])
                if "algerie.statut" not in missing:
                    missing.append("algerie.statut")
                note = " ".join(x for x in [line.get("note"), NOT_CHECKED] if x)
                sec["posologies"].append({
                    "drug_dci": line["drug_dci"], "dose": line["dose"], "dose_max": line.get("dose_max"), "route": line["route"],
                    "administration": line.get("administration"), "frequency_or_duration": line["frequency_or_duration"],
                    "condition": line.get("condition"), "risk": "high",
                    "source": {"source_id": sid, "page": line["source"]["page"], "quote": quote}, "translated": not is_french(quote),
                    "missing": missing, "algerie": {"brands": [], "statut": None}, "note": note,
                })
                side[f"dose-{len(sec['posologies'])}"] = {**meta, "section": section}
                continue
            n += 1
            el = {"id": f"{tid}-{n:03d}", "text": line["text"], "type": line["type"], "condition": line.get("condition"), "order": None,
                  "source": {"source_id": sid, "page": line["source"]["page"], "quote": quote}, "translated": not is_french(quote),
                  "grade": line.get("grade"), "risk": line["risk"], "origin": "explicit", "conflict_group": None, "missing": list(line.get("missing") or [])}
            side[el["id"]] = {**meta, "section": section}
            if place.startswith("node:"):
                branches = nodes[int(place.split(":")[1])]["branches"]
                el["order"] = len(branches) + 1
                branches.append(el)
            elif place == "gestes_immediats":
                sec["gestes_immediats"]["elements"].append(el)
            elif place == "contre_indications":
                sec["contre_indications"]["elements"].append(el)
            else:
                sec[place].append(el)
        if section == "5_conduite":
            sec["nodes"] = [nd for nd in nodes if nd["branches"]]
        if section != "12_ordonnance":
            filled = any(isinstance(v, list) and v for v in sec.values()) or any(isinstance(v, dict) and v.get("elements") for v in sec.values())
            sec["state"] = "filled" if filled else "non_traité"
            for sub in ("gestes_immediats", "contre_indications"):
                if sub in sec:
                    sec[sub]["state"] = "filled" if sec[sub]["elements"] else "non_traité"
    fiche["meta"]["quote_check"] = f"{verified}/{total}"
    return fiche, side, dropped
