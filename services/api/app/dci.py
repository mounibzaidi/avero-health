"""The base DCI of a nomenclature line or a guideline (ported as is from the old backend, scripts/dz_brands.py).
"Key: the base DCI. Uppercase, trimmed, no accents, then fixed rules, no guessing" (see that file's docstring)."""

import re
import unicodedata


# Salt, hydrate and physical-form words: the same active substance, whatever the salt.
SALTS = set("""
CHLORHYDRATE DICHLORHYDRATE HYDROCHLORIDE BROMHYDRATE SODIQUE MONOSODIQUE DISODIQUE SODIUM POTASSIQUE
POTASSIUM CALCIQUE CALCIUM MAGNESIQUE MAGNESIUM BESILATE BESYLATE MESILATE MESYLATE MALEATE FUMARATE
HEMIFUMARATE TARTRATE SUCCINATE CITRATE PHOSPHATE SULFATE HYDROGENOSULFATE OXALATE PAMOATE
TRIHYDRATE TRIHYDRATEE MONOHYDRATE MONOHYDRATEE DIHYDRATE DIHYDRATEE HEMIHYDRATE SESQUIHYDRATE
SESQUIHYDRATEE ANHYDRE MICRONISE MICRONISEE
""".split())
_LINK = re.compile(r"^(DE|DU|D')\s*")
# Esters that make another product (a cream is not the injectable): kept in the key even when the
# file names them only in a parenthesis or before "EXPRIME EN".
# Any hydrate word ("HEPTAHYDRATE", "HEXAHYDRATEE"): never part of the base DCI.
HYDRATES = re.compile(r"\b(?:MONO|DI|TRI|TETRA|PENTA|HEXA|HEPTA|OCTA|NONA|DECA|DODECA|HEMI|HEMIPENTA|SESQUI)?HYDRATEE?\b")
ESTERS = re.compile(r"\b(?:17-)?(DIPROPIONATE|VALERATE|PROPIONATE|FUROATE|BUTYRATE|ACETONIDE)\b")


def fold(s: str) -> str:
    """Uppercase, trimmed, no accents, single spaces."""
    s = "".join(c for c in unicodedata.normalize("NFKD", s.upper()) if not unicodedata.combining(c))
    return " ".join(s.replace("’", "'").split())


def _component(part: str) -> str:
    ester = ESTERS.search(part)
    part = re.sub(r"\([^)]*\)", " ", part).replace("*", " ")  # "(SOUS FORME DE CILEXETIL)**"
    if " EXPRIME EN " in f" {part} ":
        part = part.split("EXPRIME EN", 1)[1]
    part = HYDRATES.sub(" ", re.split(r"\bSOUS FORME\b|\bS/F\b", part)[0])
    if ester and ester.group(1) not in part:
        part = f"{part} {ester.group(1)}"
    words = part.split()
    if words and words[0] in SALTS:  # "PHOSPHATE DE CODEINE", "BESILATE D'AMLODIPINE"
        rest = _LINK.sub("", " ".join(words[1:])).split()
        if all(w in SALTS for w in rest):  # "SULFATE DE MAGNESIUM": the salt is the substance
            return " ".join(words).strip(" -")
        words = rest
    # "CHLORURE DE SODIUM" keeps its SODIUM: after DE or DU the word names the substance
    return " ".join(w for i, w in enumerate(words) if w not in SALTS or (i and words[i - 1] in ("DE", "DU"))).strip(" -")


def dci_key(dci: str) -> str:
    """The base DCI a guideline names: 'AMLODIPINE BESILATE EXPRIME EN AMLODIPINE' -> 'AMLODIPINE'."""
    parts = [_component(p) for p in re.split(r"\s*/\s*|\s\+\s", fold(dci)) if p.strip()]
    return " / ".join(sorted(p for p in parts if p))
