"""List the HAS protocols that can be downloaded, from HAS's own open data.

    python has_catalogue.py [--out DIR]

The site's search (/jcms/fc_2875171/) is disallowed in robots.txt and sits behind a bot challenge,
so we do not crawl it. HAS publishes the same inventory as the data.gouv.fr dataset "Métadonnées
des publications de la HAS" (Licence Ouverte 2.0): every publication with its page URL and its
documents, already resolved to file URLs. This script takes the latest export, keeps the clinical
guidance types, and writes <out>/catalogue.json with where and when the list came from.
"""

import argparse
import io
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import httpx

import polite

from doc_kinds import supporting_reason

USER_AGENT = "MedGuidesBot/0.1 (+guideline provenance)"
DATASET = "https://www.data.gouv.fr/api/1/datasets/metadonnees-des-publications-de-la-has-1/"
DEFAULT_OUT = Path(__file__).resolve().parent / "downloads"

# Publication class -> label shown in the dashboard. The other classes (drug and device opinions,
# technology assessments, studies, methodology) are not care protocols.
KINDS = {
    "RecommandationsProfessionnelles": "Recommandation de bonne pratique",
    "GuideMedecinALD": "Guide maladie chronique / PNDS",
    "RecommandationVaccinale": "Recommandation vaccinale",
}
# Navigation tags, not themes; internal ids (c_2051452, fc_2875984) are unlabelled sections.
_NOT_THEMES = {"Toutes nos publications", "Publications", "Recommandations de bonne pratique"}
# HAS keeps withdrawn guidance online, flagged only in its title.
_RETIRED = re.compile(r"\b(abrog|retir|archiv)", re.I)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    p.add_argument("--out", type=Path, default=DEFAULT_OUT)
    out = p.parse_args().out

    with polite.client(headers={"User-Agent": USER_AGENT}, timeout=120, follow_redirects=True) as client:
        meta = client.get(DATASET).raise_for_status().json()
        res = next(r for r in meta["resources"] if r["format"] == "zip" and "seul fichier" in r["title"].lower())
        z = zipfile.ZipFile(io.BytesIO(client.get(res["url"]).raise_for_status().content))
    pubs = json.loads(z.read("json/AllPublications.json").decode("utf-8-sig"))

    items = []
    for x in pubs:
        if x["class"] not in KINDS:
            continue
        docs = [
            {"title": d["title"], "url": d["resolvedUrl"], "supporting": supporting_reason(d["title"], d["resolvedUrl"])}
            for d in x.get("documentLinkSet") or []
            if (d.get("resolvedUrl") or "").lower().endswith(".pdf")
        ]
        items.append({
            "id": x["id"],
            "title": x["title"].strip(),
            "kind": KINDS[x["class"]],
            "page_url": x["pageURL"],
            "published": (x.get("publicationDate") or "")[:10] or None,
            "themes": [t for t in x.get("categoriesThematiques") or [] if t not in _NOT_THEMES and not re.fullmatch(r"f?c_\d+|p_\d+", t)],
            "retired": bool(_RETIRED.search(x["title"])),
            # Only supporting PDFs (in practice: a note de cadrage alone) = HAS has not published it yet.
            "in_progress": bool(docs) and all(d["supporting"] for d in docs),
            "pdfs": docs,
        })
    items.sort(key=lambda i: i["published"] or "", reverse=True)

    out.mkdir(parents=True, exist_ok=True)
    catalogue = {
        "source": {
            "dataset": meta["title"],
            "dataset_page": meta["page"],
            "file_url": res["url"],
            "file_updated": res["last_modified"],
            "licence": meta.get("license"),
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        },
        "items": items,
    }
    (out / "catalogue.json").write_text(json.dumps(catalogue, ensure_ascii=False), encoding="utf-8")
    counts = {k: sum(i["kind"] == k for i in items) for k in KINDS.values()}
    print(json.dumps({"total": len(items), "with_pdf": sum(bool(i["pdfs"]) for i in items), "retired": sum(i["retired"] for i in items), "in_progress": sum(i["in_progress"] for i in items), **counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
