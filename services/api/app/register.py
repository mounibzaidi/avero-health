"""Gate 3, register match (strict): which presentations of the national register a dose row may show.

A brand is shown only if DCI, form, strength and indication match, and only if it is registered today:
- status: only "enregistre" presentations are candidates; "non_renouvele" and "retire" ones never are;
- DCI: the exact base DCI (scripts/dz_brands.py), never a class, never a component of a combination;
- form: the presentation's form fits the row's route (an injectable for IV, a tablet for the oral route);
  a form that is none of the known families (a collyre, a cream) fits no route, a row without a known
  route fits no form, and an injectable that names its own routes ("SOL. INJ. IM") is not offered for
  another one (IV);
- strength and indication: only a rule of shared/register_rules.yaml says them, per DCI and topic
  ("tenecteplase for stroke = 25 mg only"). Nothing else in the register states an indication.

A presentation that fails one of these is "non_indique": the app hides it or says "non indiqué ici".
A drug without a rule for the topic has its strength and indication unchecked: the completeness check
lists it, and a person decides. No LLM, no fuzzy match.
"""

import re
from functools import lru_cache
from pathlib import Path

import yaml

from .dci import dci_key, fold

RULES = Path(__file__).resolve().parents[3] / "shared" / "register_rules.yaml"

# Route -> the family of forms that fits it. A row without a known route, or a form outside these
# families, fits nothing.
_ROUTES = (
    ("injectable", re.compile(r"\b(IV|IVD|IVL|IVSE|IM|SC|INTRAVEINEU\w*|INTRAMUSCULAIRE|SOUS[- ]CUTANEE?|INJECT\w*|PERFUSION|BOLUS|INTRAVENOUS|INTRAMUSCULAR|SUBCUTANEOUS)\b")),
    ("oral", re.compile(r"\b(ORALE?|PER OS|PO|ORALLY|BUVABLE)\b")),
    ("inhaled", re.compile(r"\b(INHAL\w*|NEBULIS\w*|AEROSOL)\b")),
    ("rectal", re.compile(r"\b(RECTALE?|INTRARECTALE?)\b")),
)
_FORMS = (
    ("injectable", re.compile(r"\bINJ|PERF")),
    ("inhaled", re.compile(r"INHAL|AEROSOL|NEBUL")),
    ("rectal", re.compile(r"SUPPO|RECT")),
    ("oral", re.compile(r"\bCOMP|\bCPR?\b|\bGLES|GELULE|CAPSULE|SIROP|SACHET|GRANUL|BUV|ORAL|ORODISP")),
)


# The injectable routes a text names: a form that names some is only for those.
_INJECTABLE = (
    ("IV", re.compile(r"(?<![A-Z])I\.?V\.?(?![A-Z])|(?<![A-Z])IV(D|L|SE)(?![A-Z])|INTRAVEIN|INTRAVENOUS|PERF|BOLUS")),
    ("IM", re.compile(r"(?<![A-Z])I\.?M\.?(?![A-Z])|INTRAMUSC")),
    ("SC", re.compile(r"(?<![A-Z])S\.?C\.?(?![A-Z])|SOUS[- ]CUTAN|SUBCUTAN")),
)


def injectable_routes(text: str | None) -> set[str]:
    folded = fold(text or "")
    return {name for name, pattern in _INJECTABLE if pattern.search(folded)}


def fits(route: str | None, form: str | None) -> bool:
    """Whether a presentation's form can be given by the row's route."""
    family = route_family(route)
    if not family or family != form_family(form):
        return False
    asked, offered = injectable_routes(route), injectable_routes(form)
    return family != "injectable" or not asked or not offered or bool(asked & offered)


def _family(text: str | None, table) -> str | None:
    folded = fold(text or "")
    return next((name for name, pattern in table if pattern.search(folded)), None)


def route_family(route: str | None) -> str | None:
    return _family(route, _ROUTES)


def form_family(form: str | None) -> str | None:
    return _family(form, _FORMS)


def _strength(dosage: str) -> str:
    """A strength for comparison: "25 mg" == "25MG"."""
    return re.sub(r"\s+", "", fold(dosage)).replace(",", ".")


@lru_cache(maxsize=1)
def rules() -> dict:
    """shared/register_rules.yaml: {"rules": [...], "exceptions": [...]}, each DCI as its base key."""
    data = (yaml.safe_load(RULES.read_text(encoding="utf-8")) or {}) if RULES.exists() else {}
    return {
        "rules": [{**r, "dci": dci_key(r["dci"])} for r in data.get("rules") or []],
        "exceptions": [{**h, "dci": dci_key(h["dci"])} for h in data.get("exceptions") or []],
    }


def presentations(register: dict, drug: str, exceptions: bool = True) -> tuple[str, list[dict]] | None:
    """The drug's base DCI and its registered presentations: those of the nomenclature, then (unless
    exceptions is False) the exceptions of the rules file. None if there is none."""
    key = dci_key(drug)
    listed = [e for e in register.get(key) or [] if e.get("status", "enregistre") == "enregistre"]
    found = [*listed, *(h for h in rules()["exceptions"] if exceptions and h["dci"] == key)] if key else []
    return (key, found) if found else None


def withdrawn(register: dict, drug: str) -> list[dict]:
    """The drug's presentations that are no longer registered (non_renouvele, retire)."""
    return [e for e in register.get(dci_key(drug)) or [] if e.get("status", "enregistre") != "enregistre"]


def rule_for(key: str, topic_id: str | None) -> dict | None:
    return next((r for r in rules()["rules"] if r["dci"] == key and r["topic"] == topic_id), None)


def match(register: dict, dose: dict, topic_id: str | None) -> dict | None:
    """The row's presentations with their verdict: {"key", "rule", "brands": [{brand, form, dosage,
    pack, hospital, status, reason}]}. status "ok" means nothing checkable contradicts it; "rule" says whether
    strength and indication were checked. None if the register does not have the DCI."""
    # an exception is hand-written: it is offered only where a rule checks its strength
    rule = rule_for(dci_key(dose["drug"]), topic_id)
    found = presentations(register, dose["drug"], exceptions=rule is not None)
    if found is None:
        return None
    key, entries = found
    allowed = {_strength(s) for s in rule["dosage"]} if rule else None
    brands = []
    for e in entries:
        reason = None
        if not fits(dose.get("route"), e.get("form")):
            reason = "forme"
        elif allowed is not None and _strength(e.get("dosage", "")) not in allowed:
            reason = "indication"
        brands.append({"brand": e["brand"], "form": e.get("form", ""), "dosage": e.get("dosage", ""), "pack": e.get("pack", ""),
                       "hospital": bool(e.get("hospital", False)), "status": "non_indique" if reason else "ok", "reason": reason})
    return {"key": key, "rule": rule is not None, "brands": brands}
