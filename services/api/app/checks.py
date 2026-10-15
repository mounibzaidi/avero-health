"""Server-side checks of a fiche: its Algerian brands (the national nomenclature, strict match: register.py) and its
quotes (each on its cited page of the source PDF, every number of the line in its quote: verify.py). Ported, never
rewritten: the rules are the old backend's. Admin only."""

import io
import time

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from pypdf import PdfReader

from . import register, verify
from . import supabase as sb
from .dci import dci_key
from .settings import setting

router = APIRouter(prefix="/checks", tags=["checks"])

# ─── The register: the nomenclature table (public read), by base DCI ───────────────────────────

_REGISTER: dict = {"at": 0.0, "data": {}}
REGISTER_TTL_S = 24 * 3600


def nomenclature() -> dict[str, list[dict]]:
    """{base DCI: [{brand, form, dosage, pack, hospital, status, dci}]} from Supabase's nomenclature table, cached a day.
    hospital = not sold in officine (hospital use only), as the old register's P2 column."""
    if time.time() - _REGISTER["at"] < REGISTER_TTL_S and _REGISTER["data"]:
        return _REGISTER["data"]
    base, key = setting("SUPABASE_URL").rstrip("/"), setting("SUPABASE_ANON_KEY")
    rows, start = [], 0
    while True:
        r = httpx.get(f"{base}/rest/v1/nomenclature", params={"select": "dci_brut,nom_marque,forme,dosage,conditionnement,statut,officine"},
                      headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": f"{start}-{start + 999}"}, timeout=60)
        r.raise_for_status()
        page = r.json()
        rows += page
        if len(page) < 1000:
            break
        start += 1000
    data: dict[str, list[dict]] = {}
    for x in rows:
        data.setdefault(dci_key(x["dci_brut"]), []).append({
            "brand": x["nom_marque"], "form": x.get("forme") or "", "dosage": x.get("dosage") or "", "pack": x.get("conditionnement") or "",
            "hospital": not x.get("officine"), "status": x["statut"], "dci": x["dci_brut"]})
    _REGISTER.update(at=time.time(), data=data)
    return data


def algerie(posologie: dict, topic_id: str | None) -> dict:
    """The dose's brands and its register status, as the fiche stores them (computed, never typed)."""
    reg = nomenclature()
    found = register.match(reg, {"drug": posologie.get("drug_dci") or "", "route": posologie.get("route")}, topic_id) if posologie.get("drug_dci") else None
    if found is None:
        gone = register.withdrawn(reg, posologie.get("drug_dci") or "")
        statut = ("Non renouvelé" if any(e["status"] == "non_renouvele" for e in gone) else "Retiré") if gone else "Aucune présentation enregistrée"
        return {"brands": [], "statut": statut}
    brands = [{"brand": b["brand"], "form": b["form"], "dosage": b["dosage"], "hospital": b["hospital"]} for b in found["brands"] if b["status"] == "ok"]
    return {"brands": brands, "statut": "Enregistré" if brands else "Aucune présentation enregistrée"}


class FicheIn(BaseModel):
    fiche: dict
    topic_id: str | None = None


@router.post("/brands")
def brands(body: FicheIn, caller: sb.Caller = Depends(sb.require_admin)):
    """The fiche with each posologie's `algerie` recomputed from the nomenclature."""
    fiche = body.fiche
    for p in fiche["sections"]["7_traitement"]["posologies"]:
        p["algerie"] = algerie(p, body.topic_id or fiche["meta"].get("topic_id"))
    return fiche


# ─── Quotes: on their page of the source PDF ───────────────────────────────────────────────────

_TEXT: dict[str, dict[int, str]] = {}  # stored PDF path -> its pages' text (a stored file never changes: its name holds its hash)


def pages(caller: sb.Caller, path: str) -> dict[int, str] | None:
    """PDF index (1-based) -> text, for a PDF of the sources bucket."""
    if path not in _TEXT:
        body = sb.download(caller, path)
        if body is None:
            return None
        reader = PdfReader(io.BytesIO(body))
        _TEXT[path] = {i + 1: (p.extract_text() or "") for i, p in enumerate(reader.pages)}
    return _TEXT[path]


def _lines(fiche: dict):
    """(id, kind, text said, source ref) for every sourced line and dose of the fiche."""
    S = fiche["sections"]

    def els(x):
        if isinstance(x, list):
            return x
        if isinstance(x, dict):
            return x.get("elements", [])
        return []

    for key, sec in S.items():
        if key == "5_conduite":
            for n in sec.get("nodes", []):
                for e in n.get("branches", []):
                    yield e
            continue
        for sub, val in sec.items():
            if sub in ("state", "posologies", "nodes"):
                continue
            for e in els(val):
                yield e


def _said(e: dict) -> str:
    return " ".join(str(v) for v in (e.get("text"), e.get("condition"), e.get("timing"), e.get("reason")) if v)


def _dose_said(p: dict) -> str:
    return " ".join(str(v) for v in (p.get("dose"), p.get("dose_max"), p.get("route"), p.get("administration"), p.get("frequency_or_duration"), p.get("condition")) if v)


@router.post("/quotes")
def quotes(body: FicheIn, caller: sb.Caller = Depends(sb.require_admin)):
    """Each sourced line: is its quote on its cited page of the source PDF, and is every number it states in the quote."""
    fiche = body.fiche
    sources = {s["source_id"]: s for s in fiche["meta"]["sources"]}
    items = [(e["id"], _said(e), e["source"]) for e in _lines(fiche) if e.get("source")]
    items += [(p["id"], _dose_said(p), p["source"]) for p in fiche["sections"]["7_traitement"]["posologies"] if p.get("source")]
    results, by_source = [], {}
    for item_id, said, ref in items:
        src = sources.get(ref["source_id"])
        path = (src or {}).get("pdf_path")
        if not path:
            results.append({"id": item_id, "ok": False, "quote": "pas_de_pdf", "message": "PDF de la source absent : citation invérifiable"})
            continue
        if path not in by_source:
            by_source[path] = pages(caller, path)
        text = by_source[path]
        if text is None:
            results.append({"id": item_id, "ok": False, "quote": "pas_de_pdf", "message": f"PDF introuvable dans le stockage : {path}"})
            continue
        offset = (src or {}).get("page_offset") or 0  # printed page minus PDF index
        index = ref["page"] - offset
        if index not in text:
            results.append({"id": item_id, "ok": False, "quote": "hors_document", "message": f"Page {ref['page']} hors du document ({len(text)} pages)"})
            continue
        v = verify.verify_line(said, index, ref["quote"], text)
        d = v.detail
        msg = []
        if d["quote"] == "autre_page":
            msg.append("Citation trouvée page " + ", ".join(str(p + offset) for p in d["found_on_pages"]) + f", pas page {ref['page']}")
        elif d["quote"] == "absente":
            msg.append(f"Citation absente de la page {ref['page']} (ressemblance {int(d.get('similarity', 0) * 100)} %)")
        elif d["quote"] == "trop_courte":
            msg.append("Citation trop courte pour être vérifiée")
        if d.get("numbers_missing"):
            msg.append("Nombre absent de la citation : " + ", ".join(d["numbers_missing"]))
        if d.get("units_mismatch"):
            msg.append("Unité différente de la citation : " + ", ".join(d["units_mismatch"]))
        results.append({"id": item_id, "ok": v.ok, "quote": d["quote"], "pdf_page": index, "message": " ; ".join(msg) or None})
    return {"checked": len(results), "ok": sum(r["ok"] for r in results), "results": results}
