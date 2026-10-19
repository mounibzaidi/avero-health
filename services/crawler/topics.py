"""Match the predefined topics (shared/topics.yaml) against the source catalogues.

    python topics.py match [--top 6]      # -> downloads/topic_matches.json, and a coverage table
    python topics.py show <topic-id>      # the ranked candidates for one topic

For every topic, keeps the entries of the four catalogues (HAS, WHO, PubMed Central, learned
societies) whose title names it: the topic's French and English names count most, its French keywords
and acronyms less, its excludes rule an entry out. The entries kept are then ordered by the score of
doc_kinds.rank (topic match, kind of document, audience, recency, language, origin, licence), each with its
reasons; news, commentaries, COVID-era, temporary and superseded documents are left out and counted.
The output is a shortlist for a person to confirm, not a download list: nothing here fetches a PDF.
"""

import argparse
import json
import os
import re
import unicodedata
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

from doc_kinds import group_versions, rank as rank_result, rank_key, result_kind, stem

ROOT = Path(__file__).resolve().parent
TOPICS = ROOT.parents[1] / "shared" / "topics.yaml"
DOWNLOADS = Path(os.environ.get("AVERO_DOWNLOADS") or ROOT / "downloads")  # AVERO_DOWNLOADS: a writable folder (/tmp on Vercel)
CATALOGUES = {"catalogue.json": "HAS", "who.json": "OMS", "pmc.json": "PubMed Central", "societies.json": None}

# where a catalogue's documents come from (doc_kinds.origin_of): PubMed Central has no region, each title says; the societies are French
CATALOGUE_REGION = {"HAS": "fr", "OMS": "intl", "PubMed Central": None}
NAME, PART, KEYWORD, ACRONYM = 10, 8, 5, 4  # title hit weights
# OMS is not here: it has no collector; a WHO PDF is added by its URL.
COLLECTABLE = {"HAS", "PubMed Central", "SFMU", "SPILF", "SFAR", "SFC"}
MIN_SCORE = 8  # a name (or one half of an "X et Y" name), or two keywords, before an entry counts
STALE_YEARS = 10

STOP = set("de du des la le les l d et en au aux a un une pour chez par sur son sa ses of the and in for with an to on or".split())


def fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s.lower().replace("œ", "oe"))
    return "".join(c for c in s if not unicodedata.combining(c))


def tokens(s: str) -> frozenset[str]:
    """Content words, accents and case folded, one form for plurals and for British and American
    spellings (doc_kinds.stem): 'Dyslipidémies' and 'dyslipidaemia' both give dyslipidemi."""
    words = re.split(r"[^a-z0-9+]+", fold(s))
    return frozenset(stem(w) for w in words if w and w not in STOP)


def load_topics(path: Path = TOPICS) -> tuple[list[dict], list[dict]]:
    """Topics flattened with their section, group and French group label; and the source order."""
    doc = yaml.safe_load(path.read_text(encoding="utf-8"))
    topics = []
    for section in ("emergencies", "gp_consultations"):
        for group, items in doc[section].items():
            for t in items:
                topics.append({**t, "section": section, "group": group, "group_label": doc["groups"][section][group]})
    return topics, doc["sources_priority"]


def english_names(en: str) -> list[str]:
    """'Acute coronary syndrome / STEMI' -> ['acute coronary syndrome', 'stemi']; parentheses kept apart."""
    parts = re.split(r"\s*/\s*|\s*\(|\)", en)
    return [p.strip() for p in parts if len(p.strip()) > 2]


def compile_topic(t: dict) -> dict:
    names = [t["fr"], *english_names(t["en"]), *(t.get("synonyms") or [])]  # synonyms: other names of the topic
    # "Sepsis et choc septique", "Céphalées et migraine": either half alone is a close match.
    parts = [p for n in names for p in re.split(r"\s+(?:et|and)\s+", n) if p != n]
    words, acronyms = [], []
    for k in t.get("keywords_fr", []):
        (acronyms if re.fullmatch(r"[A-Z0-9+]{2,6}", k) else words).append(k)
    return {
        "names": [(n, tokens(n)) for n in names if tokens(n)],
        "parts": [(p, tokens(p)) for p in parts if tokens(p)],
        "keywords": [(k, tokens(k)) for k in words if tokens(k)],
        # acronyms are matched on the raw title, case-sensitive, so "EP" is not "ep" in "sepsis"
        "acronyms": [(a, re.compile(r"(?<![A-Za-z0-9])" + re.escape(a) + r"(?![A-Za-z0-9])")) for a in acronyms],
        "exclude": [fold(x) for x in t.get("exclude", [])],
        # a broader topic that covers this one: enough to keep an entry that names nothing closer
        "broader": [(b, tokens(b)) for b in t.get("broader", []) if tokens(b)],
    }


def load_catalogue_items() -> list[dict]:
    items = []
    for file, default_source in CATALOGUES.items():
        path = DOWNLOADS / file
        if not path.exists():
            continue
        for it in json.loads(path.read_text(encoding="utf-8")).get("items", []):
            if it.get("retired") or it.get("in_progress"):
                continue
            items.append({**it, "source": it.get("source") or default_source, "_folded": fold(it["title"]), "_tokens": tokens(it["title"])})
    return items


def source_rank(sources: list[dict]) -> dict[str, int]:
    rank = {}
    for i, s in enumerate(sources):
        for name in s.get("catalogue") or []:
            rank[name] = i
    return rank


def score(item: dict, c: dict) -> tuple[int, bool, list[str]]:
    """(score, whether a whole topic name matched, what matched)."""
    if any(x in item["_folded"] for x in c["exclude"]):
        return 0, False, []
    have = item["_tokens"]
    total, full, why = 0, False, []
    for label, need in c["names"]:
        if need <= have:
            total, full = total + NAME, True
            why.append(label)
    if not full:
        for label, need in c["parts"]:
            if need <= have:
                total += PART
                why.append(label)
    for label, need in c["keywords"]:
        if need <= have:
            # a phrase ("choc septique", "arrêt cardiaque") is as telling as half a name; a single
            # word ("adrénaline", "pilule") only supports one
            total += PART if len(need) > 1 else KEYWORD
            why.append(label)
    for label, rx in c["acronyms"]:
        if rx.search(item["title"]):
            total += ACRONYM
            why.append(label)
    if total < MIN_SCORE:
        for label, need in c.get("broader", []):
            if need <= have:
                return PART, False, [f"thème plus large : {label}"]
    return total, full, why


def age_years(item: dict) -> float | None:
    """Years since publication; a bare year ("2015") counts from mid-year; unknown -> None."""
    raw = str(item.get("published") or "")
    try:
        when = date(int(raw), 7, 1) if re.fullmatch(r"\d{4}", raw) else date.fromisoformat(raw[:10])
    except ValueError:
        return None
    return (date.today() - when).days / 365.25


def match(top: int) -> dict:
    topics, sources = load_topics()
    rank = source_rank(sources)
    items = load_catalogue_items()
    out = {}
    for t in topics:
        c = compile_topic(t)
        found = []
        for it in items:
            s, full, why = score(it, c)
            if s < MIN_SCORE:
                continue
            age = age_years(it)
            stale = age is not None and age > STALE_YEARS
            collectable = not it.get("link_only") and it["source"] in COLLECTABLE
            language = it.get("language", "fr" if it["source"] != "PubMed Central" else "en")
            # the catalogues list guidance: an entry whose title says nothing more is a guideline
            doc_kind = result_kind(it["title"])
            doc_kind = "guideline" if doc_kind == "research" else doc_kind
            year = int(str(it["published"])[:4]) if str(it.get("published") or "")[:4].isdigit() else None
            ranked = rank_result({"title": it["title"], "kind": doc_kind, "year": year, "language": language, "buildable": collectable,
                                  "region": CATALOGUE_REGION.get(it["source"], "fr"),
                                  "journal": (it.get("themes") or [None])[-1] if it["source"] == "PubMed Central" else None}, t, date.today().year)
            found.append({
                **ranked, "doc_kind": doc_kind, "year": year,
                "title": it["title"],
                "source": it["source"],
                "kind": it.get("kind"),
                "published": it.get("published"),
                "page_url": it["page_url"],
                "language": language,
                "licence": it.get("licence"),
                "link_only": bool(it.get("link_only")),
                # collect.py handles every source (societies through web_scraper.py)
                "collectable": collectable,
                "score": s,
                "matched": why,
                "full_name": full,
                "stale": stale,
                "_rank": rank.get(it["source"], len(sources)),
                "_age": age if age is not None else 99,
            })
        # By origin (Algeria, France, Europe, USA and Canada), then by score (doc_kinds.rank_key), then the preferred source;
        # the versions of one recommendation (short and long, HAS and a society's copy) are one entry.
        hidden = [f for f in found if f["hidden"]]
        found = [f for f in found if not f["hidden"]]
        found.sort(key=lambda f: (*rank_key(f), f["_rank"]))
        for f in [*found, *hidden]:
            f.pop("_rank"), f.pop("_age")
        found = group_versions(found)
        out[t["id"]] = {
            "fr": t["fr"],
            "en": t["en"],
            "section": t["section"],
            "group": t["group_label"],
            "priority": t["priority"],
            "local_program": bool(t.get("local_program")),
            "candidates": found[:top],
            "total": len(found),
            "hidden": [{"title": f["title"], "source": f["source"], "why": f["hidden"]} for f in hidden],
        }
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("match")
    m.add_argument("--top", type=int, default=30)
    m.add_argument("--out", type=Path, default=DOWNLOADS)
    s = sub.add_parser("show")
    s.add_argument("topic")
    args = ap.parse_args()

    if args.cmd == "match":
        topics = match(args.top)
        payload = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "topics": topics}
        args.out.mkdir(parents=True, exist_ok=True)
        (args.out / "topic_matches.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
        found = sum(1 for t in topics.values() if t["candidates"])
        print(f"{found}/{len(topics)} topics have at least one candidate -> downloads/topic_matches.json\n")
        for tid, t in topics.items():
            best = t["candidates"][0] if t["candidates"] else None
            flag = "  [local programme: check MoH/INSP first]" if t["local_program"] else ""
            line = f"{best['source']} {str(best['published'])[:4]}: {best['title'][:70]}" if best else "NO CANDIDATE"
            print(f"P{t['priority']} {tid:24} {t['total']:3}  {line}{flag}")
    else:
        t = match(20)[args.topic]
        print(f"{t['fr']} / {t['en']}  (P{t['priority']}, {t['total']} candidates)")
        for f in t["candidates"]:
            print(f"  {f['score']:3} {f['source']:15} {str(f['published'])[:10]}  {f['title'][:90]}")
            print(f"      matched: {', '.join(f['matched'])}{'  (link only)' if f['link_only'] else ''}{f'  (older than {STALE_YEARS} years)' if f['stale'] else ''}")


if __name__ == "__main__":
    main()
