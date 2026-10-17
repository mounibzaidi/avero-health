"""Part B3: Claude's section answers assembled into a fiche-protocole fiche, by code only.

Ids `{topic_id}-{nnn}`, "translated" for a non-French quote, branch "order", source_id from the form, every dose's
"algerie" block left for the reviewer (statut null, "algerie.statut" in its missing list). The per-line pipeline data
(quote status, figure, retries, model) never enters the fiche: it is returned apart, by element id, for the side
table. Rule 4 by code: do-not lines go to 8, wherever they were (decision-tree branches included); lines that tell how
to perform or interpret an exam go to 6, while a branch whose condition is an exam result stays in 5. Lines found in
two sections keep the place rule 4 gives them; the other copy is dropped with its reason.
"""

import re

from .check import normalise
from .schema import SECTIONS

NOT_CHECKED = "Nomenclature algérienne non consultée : marques et statut à compléter."
_FR = re.compile(r"\b(le|la|les|des|du|et|pour|chez|avec|une?|est|sont|dans|patients?)\b", re.I)
_SYMPTOM = re.compile(r"\b(douleur|dyspn|symptôme|signe|malaise|syncope|palpitation|sueur|nausée)", re.I)
# Rule 4, enforced by code: a do-not line belongs in 8_ne_pas_faire, a line about performing or reading an exam in 6_examens.
_ECG_BIO = re.compile(r"\b(ECG|électrocardiogramme|troponine|cTn|biolog\w*|kaliémie|créatinine|hémogramme|glycémie|bilan lipidique)\b", re.I)
_DONOT_LINE = re.compile(r"^\s*(ne (pas|jamais)|pas d[e']|éviter|ne doit pas)\b", re.I)
_DONOT_QUOTE = re.compile(r"\b(should not|is not recommended|are not recommended|avoid)\b", re.I)
# the condition that opens a line ("Si STEMI à l'ECG, ...", "En cas de troponine élevée : ...") is not what the line does
_CONDITION = re.compile(r"^\s*(si|en cas d[e']|chez|lorsqu|quand|devant|après|avant)\b[^,:;]*[,:;]\s*", re.I)
# performing or reading an exam: a verb of doing/reading, or the exam as the subject of the line
_EXAM_ACT = re.compile(r"\b(réalis\w*|enregistr\w*|obten\w*|dos(er|age)|mesur\w*|répét\w*|renouvel\w*|interpr[ée]t\w*|lire|lecture|"
                       r"prélev\w*|demander|effectuer|faire|rechercher|critères?|définit|signe\w* électrique)\b", re.I)
_EXAM_SUBJECT = re.compile(r"^\s*(l['’]\s*|le |la |un |une |les )?(ECG|électrocardiogramme|troponine|cTn|dosage|bilan)", re.I)


def is_donot(line: dict) -> bool:
    return bool(_DONOT_LINE.search(line.get("text", "")) or _DONOT_QUOTE.search(line.get("source", {}).get("quote", "")))


def is_exam(line: dict) -> bool:
    """Does the line tell how to perform or interpret an ECG or biology exam (its action, not its condition)."""
    action = _CONDITION.sub("", line.get("text", ""), count=1)
    return bool(_ECG_BIO.search(action)) and bool(_EXAM_ACT.search(action) or _EXAM_SUBJECT.search(action))


def exam_condition(line: dict) -> bool:
    """Is an exam result the condition of the line (its condition field, or the clause that opens its text)."""
    opening = _CONDITION.match(line.get("text", ""))
    return bool(_ECG_BIO.search(line.get("condition") or "") or (opening and _ECG_BIO.search(opening.group(0))))


def placed(section: str, place: str, line: dict) -> tuple[str, str]:
    """Where rule 4 puts a line: (section, place). Do-not lines go to 8 even from a decision-tree branch; exam lines go
    to 6, except a decision-tree branch whose condition is the exam result. Doses and contraindications stay put."""
    if place in ("posologies", "contre_indications"):
        return section, place
    if section != "8_ne_pas_faire" and is_donot(line):
        return "8_ne_pas_faire", "elements"
    if section not in ("6_examens", "8_ne_pas_faire") and is_exam(line) and not (place.startswith("node:") and exam_condition(line)):
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
    if is_donot(line):
        return "8_ne_pas_faire"
    if is_exam(line):
        return "6_examens"
    if _SYMPTOM.search(line.get("text", "")):
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
