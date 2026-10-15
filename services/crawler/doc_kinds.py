"""Which of a HAS publication's PDFs are the guideline itself, and which are supporting documents;
and, below, what kind of document a topic search result is.

The guideline texts are the recommandations (long/short), synthèse, fiche mémo, algorithme /
logigramme, points / messages clés. Everything around them (argumentaire, note de cadrage, rapport
d'élaboration, reading-group results, English versions, patient leaflets, press releases, audit
criteria, WHO web annexes) is supporting material. HAS names these consistently in the document
title or file name. A document that matches nothing is kept as a guideline: better one extra PDF than a missed one.
"""

import re
import unicodedata

# (reason shown in the dashboard, pattern on the folded "title filename")
_SUPPORTING = [
    ("argumentaire", r"argumentaire"),
    ("annexe web", r"web[ _-]?annex|annexe[ _-]?web|supplementary|\bannex(es)?\b"),
    ("note de cadrage", r"note de cadrage|note_de_cadrage|cadrage"),
    ("rapport d'élaboration", r"rapport d.?elaboration|rapport complet|rapport d.?orientation|revue de (la )?litterature|base methodologique"),
    ("avis du groupe de lecture", r"groupe de lecture|resultat[_ ]gl\b|_gl\.pdf"),
    ("version anglaise", r"english|anglaise|guidelines?\b|quick reference|stroke|recommendations for"),
    ("document patient", r"\bvotre\b|\bvos\b|patients? et (leurs )?proches|information (du|des|au) patient|guide (patient|usager)"),
    ("communiqué de presse", r"communique de presse|dossier de presse"),
    ("critères d'évaluation", r"criteres de qualite|grille de recueil|serie de criteres"),
]
_COMPILED = [(reason, re.compile(p)) for reason, p in _SUPPORTING]


def fold(text: str) -> str:
    """Lower case without accents, apostrophes unified."""
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return text.lower().replace("’", "'")


def supporting_reason(title: str, url: str = "", ignore: tuple[str, ...] = ()) -> str | None:
    """None for a guideline text, else why the document is supporting material. `ignore` drops
    rules that do not apply to a source (WHO publishes in English first: "version anglaise")."""
    text = fold(f"{title} {url.rsplit('/', 1)[-1]}")
    for reason, pattern in _COMPILED:
        if reason not in ignore and pattern.search(text):
            return reason
    return None


# ─── What kind of document a search result is ───────────────────────────────────────────────────
#
# A topic search (search_sources.py) and the catalogues (topics.py) bring back documents of every
# sort. Each one is classified on its title and address, with fixed rules, so that guidance comes
# first and what is not a clinical text stays out of the way. The first rule that matches wins: a
# press release about new guidelines is news, a commentary on guidelines is a commentary, a consensus
# conference is a consensus and not an event. A page that matches nothing is "research": the lowest
# kind still shown.

RESULT_KINDS = ("guideline", "pocket", "consensus", "position", "systematic_review", "research", "news", "course", "commentary", "patient_story")
HIDDEN_KINDS = ("news", "course", "commentary", "patient_story")  # hidden unless asked for
_GUIDELINE = r"recommand|recommend|guideline|guidance|lignes? directrices?|protocol|referentiel|fiche memo|conduite a tenir|bonnes? pratiques?|algorithm|prise en charge|\brfe\b|\brpc\b|standards? of care"
# A short form of a guideline: only when the title is also a guideline's.
_POCKET = re.compile(r"pocket|quick reference|key messages?|messages? cles?|points? cles?|synthese|\bsummary\b|\bresume\b|essentiel|at a glance|aide[- ]memoire")
_RESULT = [
    # a page that asks for research ("research recommendation"), a study group: not guidance
    ("research", r"research[- ]?recommendation|study[- ]groups?|working[- ]groups?|groupes? de travail"),
    ("consensus", r"conference de consensus|consensus conference"),
    ("patient_story", r"temoignage|patient stor(y|ies)|my story|survivor[- ](stor|support)|for-survivors|\bstor(y|ies)\b|vecu des? patients?|get-involved|paroles? de patients?"),
    ("position", r"position (paper|statement)|prise de position|(scientific|clinical) statement|expert (opinion|statement)|avis d'experts?"),
    ("commentary", r"\bcommentar(y|ies)\b|\bcommentaires?\b|\bcomments\b|\bthoughts on\b|\bedito(r?i?als?)?\b|letter to the editor|\berrat(um|a)\b|corrigendum|\bcomment on\b|\bviewpoint\b|point de vue"),
    ("news", r"/news|/nouvelles?\b|nouvelle ressource|/actualites?\b|/actus?/|/press\b|press[- ]release|communique|news[- ]?room|newsletter|\bblog\b|session report|\blaunch(es|ed)?\b|hot line|breves?\b"),
    ("course", r"/diplomes?\b|\bdiplomes?\b|\bcours\b|\bcourses?\b|\bformations?\b|webinar|webinaire|e-?learning|\btraining\b|workshop|\bateliers?\b|\bcongres\b|\bcongress\b|\bmooc\b|/events?\b"),
    ("systematic_review", r"systematic review|revue systematique|meta-?analys|scoping review|evidence update|revue de (la )?litterature|cochrane|\breview\b|mise au point|state of the art"),
    ("consensus", r"consensus|\bcostr\b"),
    ("guideline", _GUIDELINE),
]
_RESULT_COMPILED = [(kind, re.compile(p)) for kind, p in _RESULT]
_YEAR = re.compile(r"(?<!\d)(19[89]\d|20\d\d)(?!\d)")


def result_kind(title: str, url: str = "") -> str:
    """guideline | pocket | consensus | position | systematic_review | research | news | course | commentary | patient_story."""
    text = fold(f"{title} {url}")
    kind = next((kind for kind, pattern in _RESULT_COMPILED if pattern.search(text)), "research")
    return "pocket" if kind == "guideline" and _POCKET.search(fold(title)) else kind


def result_year(title: str, url: str = "", lastmod: str | None = None, this_year: int = 9999) -> int | None:
    """How recent a result is: the latest year its title names (the year of the document: "2023 Acute
    Coronary Syndromes"), else the year the site last modified the page, else a year in its address.
    Never one in the future."""
    for text in (title, lastmod[:4] if lastmod and lastmod[:4].isdigit() else "", url):
        years = [int(y) for y in _YEAR.findall(text) if int(y) <= this_year]
        if years:
            return max(years)
    return None


# ─── The score of a result for a topic ──────────────────────────────────────────────────────────
#
# One number per result, the sum of the points below, each with its reason (the dashboard shows them
# on hover, so the weights can be tuned here). Results are shown by where they come from (origin_of:
# Algeria, France, Europe, USA and Canada, international), then by score; a document of more than
# OLD_YEARS years ("ancienne") or of another country comes below all of those, and one whose title
# does not name the topic last (rank_key); the versions of one recommendation (short and long, a society's copy) are one entry
# (group_versions). Some results are hidden whatever their score.

POINTS = {
    "name": 60,          # the title names the topic
    "synonym": 40,       # the title names a keyword, an acronym or one half of the topic's name
    "core": 40,          # the title names the topic without its qualifier ("heart failure" for acute heart failure)
    "broader": -10,      # the title only names a broader topic that covers this one (topics.yaml, broader): kept, below what names the topic
    "address_only": -20, # found by its address or link text: the title does not name the topic
    "neighbor": -40,     # the title names a neighbouring topic (topics.yaml, neighbors)
    # "research" is whatever is not guidance (a study, an organisation's page): it sinks below every kind of guidance
    "kind": {"guideline": 30, "pocket": 25, "consensus": 20, "position": 14, "systematic_review": 8, "research": -15},
    "procedure": -20,    # interventional or surgical document, for a GP or emergency topic
    "executive_summary": -30,  # an executive summary, an abridged version: the recommendations without what supports them
    "narrow": -25,       # narrow scope: telemedicine, organisation of care, registries, quality indicators, costs
    "old": -15,          # more than OLD_YEARS years old ("ancienne": also listed below every recent result)
    "recent": {3: 10, 5: 5},  # at most this many years old
    "no_year": -5,
    "language": {"fr": 10, "en": 5},
    # where the document comes from (origin_of); the order shown is ORIGIN_TIER, these only keep the score in line with it
    "origin": {"dz": 30, "fr": 25, "eu": 15, "na": 10, "maghreb": 0, "intl": 0, "other": -30},
    "buildable": 8,      # may be downloaded and built on, against "lien seulement"
}
OLD_YEARS = 8
KIND_LABEL = {
    "guideline": "recommandation", "pocket": "version courte d'une recommandation", "consensus": "consensus", "position": "prise de position",
    "systematic_review": "revue", "research": "article ou page qui n'est pas une recommandation", "news": "actualité", "course": "formation", "commentary": "commentaire",
    "patient_story": "témoignage",
}
_HIDE = [
    ("document de la période COVID", re.compile(r"covid|sars[- ]cov|coronavirus|pandemi")),
    ("document temporaire", re.compile(r"\btemporar|\binterim\b|\bprovisoires?\b|\btemporaires?\b")),
    ("document remplacé", re.compile(r"superseded|replaced by|\bobsolete\b|\bwithdrawn\b|\barchived?\b|remplacee? par|\babrogee?\b|\bcaduque?\b")),
]
_PROCEDURE = re.compile(r"percutaneous|percutanee?|\bpci\b|angioplast|catheteri[sz]|catheterisme|coronarograph|\bstents?\b|surg(ery|ical)|chirurgi|bypass|pontage|\bcabg\b|\btavi\b|ablation|transplant|\bgreffe|interventional|interventionnel|endovascul|\bimplant")
# Qualifiers a title often drops: "heart failure" still names "acute heart failure" (search_sources.py GENERIC).
_EXECUTIVE = re.compile(r"executive summary|resume executif|synthese executive|abridged|version abregee|summary of (the )?(main )?recommendations")
_NARROW = re.compile(
    r"tele(cardiolog|medicine|medecine|health|sante|consult|monitoring|surveillance|expertise)|(?<!health )\borgani[sz]ation(al|nel|nelle)?\b|\bfilieres?\b|"
    r"quality indicators?|indicateurs? de qualite|\bregistr(y|ies|es?)\b|cost[- ]effective|medico-?economi|health[- ]econom|\bworkforce\b|\bstaffing\b"
)
_QUALIFIERS = frozenset("aigu aigue grave severe bacterienne bacterial acute adulte adult communautaire community acquired chronique chronic symptomatique symptomatic".split())
_STOP = set("de du des la le les l d et en au aux a un une pour chez par sur son sa ses of the and in for with an to on or".split())
_FRENCH = re.compile(r"\b(de|du|des|la|le|les|et|chez|pour|aux?|une?|dans|sur|prise en charge|recommandations?)\b")
_ENGLISH = re.compile(r"\b(of|the|and|for|in|with|on|to|management|guidelines?|recommendations)\b")


def stem(word: str) -> str:
    """One form for a word's plural and for its British and American spellings: "emergencies" and
    "emergency", "allergies" and "allergie", "hypoglycaemia" and "hypoglycemia", "oedema" and "edema"."""
    if len(word) > 4:
        word = word.replace("ae", "e").replace("oe", "e")
        if word.endswith("ies"):
            return word[:-3] + "i"
        if word.endswith("ie"):
            return word[:-2] + "i"
        if word.endswith("y"):
            return word[:-1] + "i"
    return word[:-1] if len(word) > 3 and word[-1] in "sx" else word


def _words(text: str) -> frozenset[str]:
    """Content words, folded and stemmed (the rule of topics.py tokens)."""
    words = re.split(r"[^a-z0-9+]+", fold(text).replace("œ", "oe"))
    return frozenset(stem(w) for w in words if w and w not in _STOP)


def _topic_terms(topic: dict) -> tuple[list[str], list[str], list[str]]:
    """(names, synonyms, acronyms) of a topics.yaml entry. Its `synonyms` are other names of the topic."""
    names = [topic["fr"], *(p.strip() for p in re.split(r"\s*/\s*|\s*\(|\)", topic.get("en", "")) if len(p.strip()) > 2), *(topic.get("synonyms") or [])]
    halves = [h for n in names for h in re.split(r"\s+(?:et|and)\s+", n) if h != n]
    keywords = topic.get("keywords_fr") or []
    acronyms = [k for k in keywords if re.fullmatch(r"[A-Z0-9+]{2,6}", k)]
    return names, [*halves, *(k for k in keywords if k not in acronyms)], acronyms


def language_of(title: str, default: str | None = None) -> str | None:
    """"fr" or "en" from the title's small words; the source's own language when the title does not say."""
    text = fold(title)
    fr, en = len(_FRENCH.findall(text)), len(_ENGLISH.findall(text))
    return "fr" if fr > en else "en" if en > fr else default


# ─── Where a document comes from ────────────────────────────────────────────────────────────────
#
# The source's own region (shared/sources.yaml, region) when it has a country; for an international
# source or one without a region (PubMed Central), what the title names first, then the journal's
# name, then (without a region) a French title; else "intl". ORIGIN_TIER is the order results are shown in.

ORIGIN_TIER = {"dz": 0, "fr": 1, "eu": 2, "na": 3, "maghreb": 4, "intl": 4, "other": 5}
ORIGIN_LABEL = {"dz": "Algérie", "fr": "France", "eu": "Europe", "na": "États-Unis ou Canada", "maghreb": "Maghreb", "intl": "internationale", "other": "autre pays"}
_ORIGIN_WORDS = [(o, re.compile(p)) for o, p in (
    ("dz", r"\balgeri"),
    ("maghreb", r"\btunisi|\bmaroc|\bmorocc|\bmaghreb"),
    ("fr", r"\bfrance\b|\bfrench\b|\bfrancais|\bfrancophone"),
    ("eu", r"\beurope|\bbritish\b|\bunited kingdom\b|\bengland\b|\bscottish\b|\bscotland\b|\birish\b|\bireland\b|\bgerman|\bitalian\b|\bitaly\b|\bspanish\b|\bspain\b|"
           r"\bdutch\b|\bnetherlands\b|\bbelgi|\bswiss\b|\bswitzerland\b|\baustrian?\b|\bportugue|\bportugal\b|\bdanish\b|\bdenmark\b|\bswedish\b|\bsweden\b|\bnorwegian\b|"
           r"\bnorway\b|\bfinnish\b|\bfinland\b|\bnordic\b|\bscandinavian?\b|\bpolish\b|\bpoland\b|\bgreek\b|\bgreece\b|\bhellenic\b|\bczech|\bhungar|\bromanian?\b|\bcroatian?\b|"
           r"\bsloven|\bslovak|\bbulgarian?\b|\bserbian?\b"),
    ("na", r"\bamerican?\b|\bunited states\b|\busa\b|\bcanad|\bquebec"),
    ("other", r"\bpakistan|\bindian?\b|\biran|\bchina\b|\bchinese\b|\bjapan|\bkorea|\bbra[sz]il|\bsaudi|\barabian?\b|\barab\b|\begypt|\bturk(ey|ish|iye)\b|\bmalaysia|\bthai|\btaiwan|"
              r"\bindonesia|\bvietnam|\bphilippin|\bbanglades|\bsri lanka|\bnepal|\baustralia|\bnew zealand\b|\baustralasia|\basian?\b|\basia[- ]pacific|\blatin[- ]america|\bsouth[- ]america|\bibero[- ]?america|"
              r"\bpan[- ]?america|\bmexic|\bargentin|\bchilean?\b|\bcolombia|\bperu(vian)?\b|\bsub[- ]saharan|\bsouth africa|\bnigeria|\bkenya|\bethiopia|\bghana|\buganda|\btanzania|"
              r"\bisrael|\bleban|\biraq|\bkuwait|\bqatar|\bemirat|\brussia|\bukrain|\bsingapore|\bhong kong|\bmongolia|\bcuba|\bvenezuel|\buruguay|\becuador|\bsenegal|\bcameroon"),
)]
# societies and agencies a title names by their initials (matched as written, in capitals)
_ORIGIN_ACRONYMS = [(o, re.compile(r"(?<![A-Za-z0-9])(?:" + p + r")(?![A-Za-z0-9])")) for o, p in (
    ("fr", "HAS|SFAR|SFMU|SPILF|SRLF|SPLF|CNGOF|SFNV"),
    ("eu", "ESC|ERS|ESICM|EASL|EULAR|ESMO|ESPEN|ESPGHAN|EAU|ESH|EAN|ESO|ERC|ESCMID|EAACI|ESAIC|NICE|BTS|UK"),
    ("na", "AHA|IDSA|ATS|ACOG|AAP|ACEP|CDC|AAN|AASLD|ACG|SCCM|ASCO|NCCN|USPSTF|USA|U\\.S\\.|ADA"),
)]
# a journal that carries a country in its (abbreviated) name; "other" is read first ("Arq Bras Cardiol", "Acta Med Iran")
_ORIGIN_JOURNALS = [(o, re.compile(p)) for o, p in (
    ("other", r"\b(pak|indian?|iran|chin|jpn|japan|korean?|bra[sz]|saudi|egypt|turk|malays|thai|taiwan|indones|vietnam|philipp|bangladesh|nepal|aust|n z|asian?|afr|niger|ethiop|ghana|isr|arab|singapore|hong kong|mex|argent|colomb)\b"),
    ("dz", r"\balger"),
    ("maghreb", r"\b(tunis|maroc)"),
    ("fr", r"\b(fr|francais|rev mal respir|presse med)\b"),
    ("na", r"\b(am|can|cmaj|mmwr|jama)\b"),
    ("eu", r"\b(eur|europace|european|esmo|br|ital|dtsch|ger|scand|swiss|neth|belg|pol|esp|dan|r coll)\b"),
)]


def origin_of(title: str, region: str | None = None, journal: str | None = None, language: str | None = None) -> str:
    """Where a document comes from: a key of ORIGIN_TIER.

    region: the source's (sources.yaml); journal: the journal's name when there is one."""
    if region in ORIGIN_TIER and region != "intl":
        return region
    folded = fold(title)
    hits = [(m.start(), o) for o, rx in _ORIGIN_WORDS if (m := rx.search(folded))]
    hits += [(m.start(), o) for o, rx in _ORIGIN_ACRONYMS if (m := rx.search(title))]
    if hits:
        return min(hits)[1]  # the first one named: "Korean adaptation of the European guideline" is Korean
    if journal:
        name = fold(journal)
        if origin := next((o for o, rx in _ORIGIN_JOURNALS if rx.search(name)), None):
            return origin
    # a French title of a source without a region is French; an international source's French edition stays international
    return "fr" if language == "fr" and region is None else "intl"


def rank(result: dict, topic: dict, this_year: int) -> dict:
    """{"rank": score, "reasons": [{"points", "why"}], "hidden": why or None} for one result.

    result: title, kind (result_kind), year, and optionally url, language ("fr", "en"), buildable (bool),
    region (the source's, sources.yaml) and journal, for origin_of.
    topic: a topics.yaml entry (fr, en, keywords_fr, neighbors)."""
    title, folded, have = result["title"], fold(result["title"]), _words(result["title"])
    reasons = []

    def add(points: int, why: str) -> None:
        reasons.append({"points": points, "why": why})

    names, synonyms, acronyms = _topic_terms(topic)
    named = next((n for n in names if _words(n) and _words(n) <= have), None)
    synonym = next((x for x in synonyms if _words(x) and _words(x) <= have), None) or next(
        (a for a in acronyms if re.search(r"(?<![A-Za-z0-9])" + re.escape(a) + r"(?![A-Za-z0-9])", title)), None)
    # only the topic's own names lose a qualifier: a synonym is matched as written
    own = names[: len(names) - len(topic.get("synonyms") or [])]
    cores = [(n, _words(n) - _QUALIFIERS) for n in own]
    core = next((" ".join(w for w in re.split(r"[^a-z0-9+]+", fold(n)) if w and w not in _QUALIFIERS and w not in _STOP)
                 for n, head in cores if head and head != _words(n) and len("".join(head)) >= 5 and head <= have), None)
    if named:
        add(POINTS["name"], f"le titre nomme le thème : « {named} »")
    elif synonym:
        add(POINTS["synonym"], f"le titre nomme un synonyme : « {synonym} »")
    elif core:
        add(POINTS["core"], f"le titre nomme le thème sans son qualificatif : « {core} »")
    elif broader := next((b for b in topic.get("broader") or [] if _words(b) and _words(b) <= have), None):
        add(POINTS["broader"], f"le titre nomme un thème plus large, qui peut traiter celui-ci : « {broader} »")
    else:
        add(POINTS["address_only"], "le titre ne nomme pas le thème (trouvé par l'adresse ou le lien)")
    neighbor = next((n for n in topic.get("neighbors") or [] if fold(n) in folded), None)
    if neighbor:
        add(POINTS["neighbor"], f"thème voisin : « {neighbor} »")

    kind = result["kind"]
    if kind in POINTS["kind"]:
        add(POINTS["kind"][kind], f"type : {KIND_LABEL[kind]}")
    if _PROCEDURE.search(folded):
        add(POINTS["procedure"], "document interventionnel ou chirurgical")

    if _EXECUTIVE.search(folded):
        add(POINTS["executive_summary"], "résumé exécutif ou version abrégée")
    if _NARROW.search(folded):
        add(POINTS["narrow"], "champ étroit (télémédecine, organisation, registre, indicateurs, coûts)")

    year = result.get("year")
    old = year is not None and this_year - year > OLD_YEARS
    if year is None:
        add(POINTS["no_year"], "année inconnue")
    elif old:
        add(POINTS["old"], f"ancienne : plus de {OLD_YEARS} ans ({year})")
    elif bonus := next((points for age, points in sorted(POINTS["recent"].items()) if this_year - year <= age), 0):
        add(bonus, f"récente ({year})")

    language = result.get("language") if result.get("language") in ("fr", "en") else language_of(title)
    if language in POINTS["language"]:
        add(POINTS["language"][language], "en français" if language == "fr" else "en anglais")
    origin = origin_of(title, result.get("region"), result.get("journal"), language)
    add(POINTS["origin"][origin], f"origine : {ORIGIN_LABEL[origin]}")
    if result.get("buildable"):
        add(POINTS["buildable"], "téléchargeable")
    else:
        add(0, "lien seulement")

    hidden = KIND_LABEL[kind] if kind in HIDDEN_KINDS else next((why for why, pattern in _HIDE if pattern.search(folded)), None)
    return {"rank": sum(r["points"] for r in reasons), "reasons": reasons, "hidden": hidden, "language": language, "old": old,
            "origin": origin, "on_topic": bool(named or synonym or core)}


def rank_key(r: dict) -> tuple:
    """Results in the order they are shown. First the recent ones whose title names the topic, by
    origin (ORIGIN_TIER: Algeria, France, Europe, USA and Canada, international), then the best score
    (a French text has more points) and the most recent. Below them, in the same order, the old
    ones ("ancienne"; an Algerian document stays on top whatever its age) and those of another
    country. Last, the results whose title does not name the topic."""
    origin = r.get("origin") or "intl"
    below = origin == "other" or (bool(r.get("old")) and origin != "dz")
    return (not r.get("on_topic", True), below, ORIGIN_TIER[origin], -r.get("rank", 0), -(r.get("year") or 0), r.get("title", ""))


# What tells two versions of one recommendation apart, and nothing else: the form (long or short
# text, synthesis, fiche mémo, argumentaire), not the subject.
_VERSION_WORDS = frozenset(stem(w) for w in (
    "recommandation recommandations recommendation recommendations guideline guidelines synthese summary resume fiche memo texte text court courte "
    "long longue short full version argumentaire rapport complet complete messages message cles cle points point pocket executive abridged "
    "abregee update updated actualisation mise jour pdf corrige corrigee revise revisee revised "
    "janvier fevrier mars avril mai juin juillet aout septembre octobre novembre decembre"
).split())


def version_key(title: str) -> frozenset[str]:
    """The words of a title that name its subject: two documents with the same ones are versions of
    one recommendation (its short and long texts, a society's copy of it)."""
    return frozenset(w for w in _words(title) if w not in _VERSION_WORDS and not re.fullmatch(r"(19|20)\d\d", w))


def group_versions(rows: list[dict]) -> list[dict]:
    """The rows, in the same order, with the versions of one recommendation as one entry: the first
    (best ranked) one, the others under its "versions". A hidden row, and a title that names its
    subject in fewer than two words, stays on its own."""
    out, first = [], {}
    for r in rows:
        key = version_key(r.get("title", ""))
        if r.get("hidden") or len(key) < 2:
            out.append(r)
        elif key in first:
            first[key].setdefault("versions", []).append(r)
        else:
            first[key] = r
            out.append(r)
    return out
