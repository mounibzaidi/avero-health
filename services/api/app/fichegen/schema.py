"""The fiche-protocole format, exactly: the JSON Schema a generated fiche must pass before it is saved, and the
schemas Claude answers in (content fields only: code fills ids, order, source_id, translated, conflict_group).

Allowed values follow the agreed format. One explicit exception, in `validate` and nowhere else: a dose's
algerie.statut may be null only while meta.status is "draft" (until a reviewer fills it from the nomenclature).
"""

from jsonschema import Draft202012Validator

STATES = ["filled", "non_traité", "sans_objet"]
STATUTS = ["Enregistré", "Non renouvelé", "Retiré", "Aucune présentation enregistrée"]
SECTIONS = ["1_essentiel", "2_presentation", "3_champ", "4_gravite", "5_conduite", "6_examens", "7_traitement",
            "8_ne_pas_faire", "9_orientation", "10_surveillance", "11_suivi", "12_ordonnance", "13_definitions"]

_null_str = {"type": ["string", "null"]}
SOURCE = {"type": "object", "additionalProperties": False, "required": ["source_id", "page", "quote"],
          "properties": {"source_id": {"type": "string"}, "page": {"type": ["integer", "null"]}, "quote": {"type": "string"}}}
ELEMENT = {
    "type": "object", "additionalProperties": False,
    "required": ["id", "text", "type", "condition", "order", "source", "translated", "grade", "risk", "origin", "conflict_group", "missing"],
    "properties": {
        "id": {"type": "string"}, "text": {"type": "string"}, "type": {"enum": ["action", "conditional", "info", "row"]},
        "condition": _null_str, "order": {"type": ["integer", "null"]}, "source": SOURCE, "translated": {"type": "boolean"},
        "grade": _null_str, "risk": {"enum": ["high", "medium", "low"]}, "origin": {"enum": ["explicit", "local_adaptation"]},
        "conflict_group": _null_str, "missing": {"type": "array", "items": {"type": "string"}},
    },
}
DOSE = {
    "type": "object", "additionalProperties": False,
    "required": ["drug_dci", "dose", "dose_max", "route", "administration", "frequency_or_duration", "condition", "risk", "source",
                 "translated", "missing", "algerie", "note"],
    "properties": {
        "drug_dci": {"type": "string"}, "dose": {"type": "string"}, "dose_max": _null_str, "route": {"type": "string"},
        "administration": _null_str, "frequency_or_duration": {"type": "string"}, "condition": _null_str, "risk": {"const": "high"},
        "source": SOURCE, "translated": {"type": "boolean"}, "missing": {"type": "array", "items": {"type": "string"}},
        "algerie": {"type": "object", "additionalProperties": False, "required": ["brands", "statut"],
                    "properties": {"brands": {"type": "array", "items": {"type": "string"}}, "statut": {"enum": [*STATUTS, None]}}},
        "note": _null_str,
    },
}
_list = {"type": "array", "items": ELEMENT}
_state = {"enum": STATES}


def _sec(**props) -> dict:
    return {"type": "object", "additionalProperties": False, "required": ["state", *props], "properties": {"state": _state, **props}}


FICHE = {
    "type": "object", "additionalProperties": False, "required": ["meta", "sections"],
    "properties": {
        "meta": {
            "type": "object", "additionalProperties": False,
            "required": ["title", "topic_id", "template", "audience", "version", "status", "reviewer", "reviewed_at", "siblings", "sources",
                         "excluded_by_audience", "quote_check"],
            "properties": {
                "title": {"type": "string"}, "topic_id": {"type": "string"}, "template": {"enum": ["urgence", "pathologie"]},
                "audience": {"type": "array", "items": {"type": "string"}}, "version": {"type": "string"},
                "status": {"enum": ["draft", "review", "published"]}, "reviewer": _null_str, "reviewed_at": _null_str,
                "siblings": {"type": "array", "items": {"type": "string"}},
                "sources": {"type": "array", "items": {
                    "type": "object", "additionalProperties": False, "required": ["source_id", "type", "title", "citation", "licence"],
                    "properties": {"source_id": {"type": "string"}, "type": {"enum": ["full_guideline", "synthesis", "update_only", "product_info"]},
                                   "title": {"type": "string"}, "citation": {"type": "string"}, "licence": {"type": "string"}}}},
                "excluded_by_audience": {"type": "array", "items": {"type": "string"}}, "quote_check": {"type": "string"},
            },
        },
        "sections": {
            "type": "object", "additionalProperties": False, "required": SECTIONS,
            "properties": {
                "1_essentiel": _sec(elements=_list),
                "2_presentation": _sec(signes_typiques=_list, formes_trompeuses=_list, examen_clinique=_list),
                "3_champ": _sec(elements=_list),
                "4_gravite": _sec(signes_de_gravite=_list, gestes_immediats=_sec(elements=_list)),
                "5_conduite": _sec(nodes={"type": "array", "items": {
                    "type": "object", "additionalProperties": False, "required": ["node", "branches"],
                    "properties": {"node": {"type": "string"}, "branches": _list}}}),
                "6_examens": _sec(elements=_list),
                "7_traitement": _sec(elements=_list, contre_indications=_sec(elements=_list), posologies={"type": "array", "items": DOSE}),
                **{k: _sec(elements=_list) for k in ["8_ne_pas_faire", "9_orientation", "10_surveillance", "11_suivi", "12_ordonnance", "13_definitions"]},
            },
        },
    },
}
_VALIDATOR = Draft202012Validator(FICHE)


def validate(fiche: dict) -> list[str]:
    """Problems that keep a fiche from being saved (empty list: valid). The draft-only exception for algerie.statut
    is here, explicit: null is accepted while meta.status is "draft", never after."""
    problems = [f"{'/'.join(map(str, e.absolute_path)) or 'fiche'} : {e.message}" for e in _VALIDATOR.iter_errors(fiche)]
    if not problems and fiche["meta"]["status"] != "draft":
        for i, d in enumerate(fiche["sections"]["7_traitement"]["posologies"]):
            if d["algerie"]["statut"] is None:
                problems.append(f"sections/7_traitement/posologies/{i}/algerie/statut : à remplir avant de quitter le brouillon ({d['drug_dci']})")
    return problems


# ─── What Claude returns (content fields only) ──────────────────────────────────────────────────

_SRC = {"type": "object", "additionalProperties": False, "required": ["page", "quote"],
        "properties": {"page": {"type": "integer"}, "quote": {"type": "string"}}}
LLM_ELEMENT = {
    "type": "object", "additionalProperties": False,
    "required": ["text", "type", "condition", "source", "from_figure", "grade", "risk", "origin", "missing"],
    "properties": {
        "text": {"type": "string"}, "type": {"enum": ["action", "conditional", "info", "row"]}, "condition": _null_str, "source": _SRC,
        "from_figure": {"type": "boolean"}, "grade": _null_str, "risk": {"enum": ["high", "medium", "low"]}, "origin": {"const": "explicit"},
        "missing": {"type": "array", "items": {"type": "string"}},
    },
}
LLM_DOSE = {
    "type": "object", "additionalProperties": False,
    "required": ["drug_dci", "dose", "dose_max", "route", "administration", "frequency_or_duration", "condition", "source", "from_figure", "missing", "note"],
    "properties": {
        "drug_dci": {"type": "string"}, "dose": {"type": "string"}, "dose_max": _null_str, "route": {"type": "string"}, "administration": _null_str,
        "frequency_or_duration": {"type": "string"}, "condition": _null_str, "source": _SRC, "from_figure": {"type": "boolean"},
        "missing": {"type": "array", "items": {"type": "string"}}, "note": _null_str,
    },
}
_llist = {"type": "array", "items": LLM_ELEMENT}
_lstate = {"enum": ["filled", "non_traité"]}


def _lsec(**props) -> dict:
    return {"type": "object", "additionalProperties": False, "required": ["state", *props], "properties": {"state": _lstate, **props}}


def llm_section_schema(section: str) -> dict:
    """The answer schema for one section."""
    if section == "2_presentation":
        return _lsec(signes_typiques=_llist, formes_trompeuses=_llist, examen_clinique=_llist)
    if section == "4_gravite":
        return _lsec(signes_de_gravite=_llist, gestes_immediats=_llist)
    if section == "5_conduite":
        return _lsec(nodes={"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["node", "branches"],
                                                       "properties": {"node": {"type": "string"}, "branches": _llist}}})
    if section == "7_traitement":
        return _lsec(elements=_llist, contre_indications=_llist, posologies={"type": "array", "items": LLM_DOSE})
    return _lsec(elements=_llist)


ROUTING = {
    "type": "object", "additionalProperties": False, "required": ["sections", "excluded_by_audience"],
    "properties": {
        "sections": {"type": "object", "additionalProperties": False, "required": SECTIONS,
                     "properties": {s: {"type": "array", "items": {"type": "integer"}} for s in SECTIONS}},
        "excluded_by_audience": {"type": "array", "items": {"type": "string"}},
    },
}
FIXES = {
    "type": "object", "additionalProperties": False, "required": ["fixes"],
    "properties": {"fixes": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["index", "drop", "page", "quote"],
        "properties": {"index": {"type": "integer"}, "drop": {"type": "boolean"}, "page": {"type": ["integer", "null"]}, "quote": {"type": ["string", "null"]}}}}},
}
