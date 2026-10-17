"""List French learned societies' guidelines (SPILF, SFAR, SFMU, SFC).

    python societies_catalogue.py [--out DIR]

Each society's index page is fetched once (SFC's paginated archive once per page), with a pause
between requests, and only from paths their robots.txt allows. Every entry is collectable: the
collection API downloads its PDFs through web_scraper.py.

Writes <out>/societies.json in the same item shape as catalogue.json (has_catalogue.py), with
`source` naming the society.
"""

import argparse
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

import polite

from doc_kinds import fold, supporting_reason

DEFAULT_OUT = Path(__file__).resolve().parent / "downloads"
USER_AGENT = "MedGuidesBot/0.2 (+guideline catalogue)"
PAUSE_S = 1.5
GUIDELINE = "Recommandation de bonne pratique"
EDITORIAL = "Éditorial / commentaire"

SOCIETIES = {
    "SPILF": {"name": "Société de pathologie infectieuse de langue française", "index": "https://www.infectiologie.com/fr/recommandations.html",
              "terms": "https://www.infectiologie.com/fr/mentions-legales.html"},
    "SFAR": {"name": "Société française d'anesthésie et de réanimation", "index": "https://sfar.org/recommandations/",
             "terms": "https://sfar.org/mentions-legales/"},
    "SFMU": {"name": "Société française de médecine d'urgence", "index": "https://www.sfmu.org/fr/publications/recommandations-de-la-sfmu",
             "terms": "https://www.sfmu.org/fr/mentions-legales"},
    "SFC": {"name": "Société française de cardiologie", "index": "https://www.sfcardio.fr/type-de-publication/recommandations-preconisations/",
            "more": ["https://www.sfcardio.fr/type-de-publication/documents-de-consensus/",
                     "https://www.sfcardio.fr/type-de-publication/consensus-dexperts/"],
            "terms": "https://www.sfcardio.fr/mentions-legales"},
}

_MONTHS = {m: i for i, m in enumerate(
    ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"], 1)}
_YEAR = re.compile(r"\b(19[89]\d|20[0-4]\d)\b")


def text(node) -> str:
    return re.sub(r"\s+", " ", node.get_text(" ")).strip()


def year_of(s: str) -> str | None:
    years = _YEAR.findall(s)
    return max(years) if years else None


def item(source: str, title: str, page_url: str, published: str | None, themes: list[str], links: list[dict], kind: str = GUIDELINE) -> dict:
    return {
        "id": f"{source.lower()}:{page_url}",
        "source": source,
        "title": title,
        "kind": kind,
        "page_url": page_url,
        "published": published,
        "themes": [t for t in dict.fromkeys(themes) if t],
        "retired": bool(re.search(r"\b(abrog|archiv|obsolete)", fold(title))),
        "in_progress": False,
        "link_only": False,
        "collectable": True,
        "pdfs": [{**l, "supporting": supporting_reason(l["title"], l["url"])} for l in links],
    }


def _is_heading(t: str) -> bool:
    """A section label, not a year, a parenthesis or a stray bold word."""
    return len(t) > 3 and not re.fullmatch(r"[\d\s()]+|\(.*\)|[-–:]+", t)


def spilf(html: str, base: str) -> list[dict]:
    """<li> entries under <strong> sub-headings. Entries whose links all go to HAS are dropped:
    those guidelines are already in the HAS catalogue."""
    soup = BeautifulSoup(html, "lxml")
    main = soup.select_one("#mainSection .col-right") or soup
    # Sections are <a id="vacc"> anchors, named by the page's own table of contents.
    sections = {}
    for a in soup.find_all("a", href=re.compile(r"recommandations\.html#\w+$")):
        label = text(a).strip(" -")
        if label and a["href"].split("#")[1] not in sections:
            sections[a["href"].split("#")[1]] = label[0].upper() + label[1:]
    out = []
    for li in main.select("li"):
        links = []
        for a in li.find_all("a", href=True):
            url = urljoin(base, a["href"].strip())
            host = urlparse(url).hostname or ""
            if not url.startswith("http") or re.search(r"\.pptx?$", url, re.I) or "share" in url or host.endswith(("facebook.com", "twitter.com", "linkedin.com")):
                continue
            links.append({"title": text(a) or Path(urlparse(url).path).name, "url": url})
        if not links or len(text(li)) < 12 or li.find("li"):
            continue
        if all("has-sante.fr" in (urlparse(l["url"]).hostname or "") for l in links):
            continue
        anchor = li.find_previous("a", id=lambda i: i in sections)
        own = [l for l in links if "infectiologie.com" in (urlparse(l["url"]).hostname or "")]
        # SPILF's page also curates other bodies' documents (HCSP, CNS, ministère, journals).
        theirs = own or "spilf" in fold(text(li))
        themes = [sections[anchor["id"]] if anchor else "", "" if theirs else "Document d'un autre organisme"]
        out.append(item("SPILF", text(li), (own or links)[0]["url"], year_of(text(li)), themes, links))
    return out


def sfar(html: str, base: str) -> list[dict]:
    """Table rows in accordions (by year and by theme); a guideline appears in several, keep one."""
    soup = BeautifulSoup(html, "lxml")
    kinds = {"table-rfe-border": "RFE", "table-rpp-border": "RPP", "table-preco-border": "Préconisation"}
    seen: dict[str, dict] = {}
    for tr in soup.select("tr.table-rfe-border, tr.table-rpp-border, tr.table-preco-border"):
        a = tr.find("a", href=True)
        if not a:
            continue
        url = urljoin(base, a["href"].split("&refresh=")[0])
        panel = tr.find_parent(class_="fusion-panel")
        heading = text(panel.select_one(".fusion-toggle-heading")) if panel else ""
        sub = tr.find_previous("td", class_=re.compile(r"^titre-rfe"))
        if sub and sub.find_parent("table") is not tr.find_parent("table"):
            sub = None
        date = tr.find("td", class_=re.compile(r"-date"))
        year = year_of(text(date)) if date else None
        year = year or (heading if re.fullmatch(r"\d{4}", heading) else None)
        kind = next((k for c, k in kinds.items() if c in tr.get("class", [])), "")
        themes = [kind] + ([] if re.fullmatch(r"\d{4}", heading) else [heading]) + ([text(sub)] if sub else [])
        themes = [t for t in themes if _is_heading(t)]
        if url in seen:
            seen[url]["themes"] = list(dict.fromkeys(seen[url]["themes"] + [t for t in themes if t]))
            seen[url]["published"] = seen[url]["published"] or year
            continue
        pdf = [{"title": text(a), "url": url}] if re.search(r"\.pdf$|/download/", url) else []
        seen[url] = item("SFAR", text(a), url, year, themes, pdf)
    return list(seen.values())


def sfmu(html: str, base: str) -> list[dict]:
    """<li class="consensus-liste-item"><a>title</a><br/>[08 septembre 2026] <span class="label-...">"""
    soup = BeautifulSoup(html, "lxml")
    out = []
    for li in soup.select("li.consensus-liste-item"):
        a = li.find("a", href=True)
        if not a:
            continue
        date = None
        m = re.search(r"\[(\d{1,2}) ([^\]\s]+) (\d{4})\]", fold(text(li)))
        if m and m.group(2) in _MONTHS:
            date = f"{m.group(3)}-{_MONTHS[m.group(2)]:02d}-{int(m.group(1)):02d}"
        labels = [text(s) for s in li.select("span[class^=label-]") if "nouveau" not in s["class"][0]]
        out.append(item("SFMU", text(a), urljoin(base, a["href"]), date or year_of(text(a)), [l.upper() for l in labels], []))
    return out


def attachments(client: httpx.Client, items: list[dict], pattern: str, scope: str | None = None) -> None:
    """Each item's own PDFs, read on its page: SFC keeps them under /wp-content/uploads/, SFMU under
    /upload/consensus/ ("Télécharger le fichier joint" in the page body). A page that fails keeps no PDF."""
    for it in items:
        time.sleep(PAUSE_S)
        try:
            soup = BeautifulSoup(client.get(it["page_url"]).raise_for_status().text, "lxml")
        except Exception:
            continue
        root = soup.select_one(scope) if scope else soup
        links = []
        for a in (root or soup).find_all("a", href=True):
            url = urljoin(it["page_url"], a["href"])
            if re.search(pattern, url, re.I) and url not in [l["url"] for l in links]:
                links.append({"title": text(a) or it["title"], "url": url})
        it["pdfs"] = [{**l, "supporting": supporting_reason(l["title"], l["url"])} for l in links]


def sfc(client: httpx.Client, first: str) -> list[dict]:
    """WordPress category archive, paginated /page/N/. Mostly editorials on ESC guidelines. Its
    REST API answers 401 to the public, so we do not use it."""
    out, seen, url = [], set(), first
    for _ in range(30):
        soup = BeautifulSoup(client.get(url).raise_for_status().text, "lxml")
        for art in soup.select("article.type-publication"):
            a = art.select_one("h2.fusion-post-title a[href]")
            if not a or a["href"] in seen:
                continue
            seen.add(a["href"])
            title = text(a)
            classes = art.get("class", [])
            themes = [c.removeprefix("thematiques-").replace("-", " ").capitalize() for c in classes if c.startswith("thematiques-")]
            updated = art.select_one(".updated")
            kind = EDITORIAL if re.match(r"(scientific )?editor?ial", fold(title)) else GUIDELINE
            out.append(item("SFC", title, a["href"], (text(updated)[:10] if updated else None) or year_of(title), themes, [], kind))
        nxt = soup.select_one("a.pagination-next[href]")
        if not nxt:
            break
        url = urljoin(url, nxt["href"])
        time.sleep(PAUSE_S)
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    out = p.parse_args().out

    items, sources = [], []
    with polite.client(headers={"User-Agent": USER_AGENT}, timeout=60, follow_redirects=True) as client:
        for key, soc in SOCIETIES.items():
            try:
                if key == "SFC":
                    got, seen = [], set()
                    for index in [soc["index"], *soc.get("more", [])]:
                        got += [i for i in sfc(client, index) if i["page_url"] not in seen and not seen.add(i["page_url"])]
                    attachments(client, got, r"/wp-content/uploads/.+\.pdf(\?|$)")
                else:
                    html = client.get(soc["index"]).raise_for_status().text
                    got = {"SPILF": spilf, "SFAR": sfar, "SFMU": sfmu}[key](html, soc["index"])
                    if key == "SFMU":
                        attachments(client, got, r"/upload/consensus/.+\.pdf(\?|$)", scope=".bloc-content")
                error = None
            except Exception as exc:
                got, error = [], f"{type(exc).__name__}: {exc}"
            items += got
            sources.append({"key": key, **soc, "count": len(got), "error": error, "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
            time.sleep(PAUSE_S)

    items.sort(key=lambda i: i["published"] or "", reverse=True)
    out.mkdir(parents=True, exist_ok=True)
    (out / "societies.json").write_text(json.dumps({"sources": sources, "items": items}, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({s["key"]: s["error"] or s["count"] for s in sources}, ensure_ascii=False))


if __name__ == "__main__":
    main()
