"""Fiche generation from a guideline PDF: upload, offset, generation, review, approval (admin only).

The draft stays in the fiche-protocole format in fiche_drafts; the dashboard converts an approved draft to v1.1 for the
editor and the app. Status changes only through /approve, a human action: "review", or "published" when the licence
allows it and every dose has its Algerian status.
"""

import json
import subprocess
import tempfile

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel

from .. import supabase as sb
from . import llm, pipeline
from .schema import validate
from .store import RestStore

router = APIRouter(prefix="/fichegen", tags=["fichegen"])


def _one(caller, draft_id: str) -> dict:
    rows = sb.rest(caller, "GET", "fiche_drafts", {"id": f"eq.{draft_id}", "select": "*"})
    if not rows:
        raise HTTPException(status_code=404, detail="Brouillon introuvable")
    return rows[0]


@router.post("/drafts", status_code=201)
async def create(background: BackgroundTasks, file: UploadFile = File(...), form: str = Form(...), caller: sb.Caller = Depends(sb.require_admin)):
    """The upload form: the guideline PDF and {title, topic_id, template, audience, siblings, source {source_id, type,
    title, citation}, licence_text, licence_scope: internal | publish}. Ingestion starts at once."""
    try:
        f = json.loads(form)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Formulaire illisible : {exc}") from exc
    for k in ("title", "topic_id", "source", "licence_scope"):
        if not f.get(k):
            raise HTTPException(status_code=422, detail=f"Champ manquant : {k}")
    if f["licence_scope"] not in ("internal", "publish"):
        raise HTTPException(status_code=422, detail="Licence : « internal » ou « publish »")
    body = await file.read()
    if not body.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="Un fichier PDF est attendu")
    sha = pipeline.sha256(body)
    path = f"fiches/{f['topic_id']}/{sha[:12]}-{(file.filename or 'guide.pdf').replace('/', '-')[:100]}"
    sb.upload(caller, path, body, "application/pdf")
    # the PDF's record in the knowledge base (documents): one per PDF, whatever fiche uses it
    doc = RestStore(caller).document(sha, path, f["source"].get("title"), f.get("licence_text"), f["licence_scope"])
    row = sb.rest(caller, "POST", "fiche_drafts", body={"topic_id": f["topic_id"], "form": f, "licence_scope": f["licence_scope"], "document_id": doc,
                                                         "pdf_path": path, "pdf_sha": sha, "created_by": caller.uid}, prefer="return=representation")[0]
    background.add_task(pipeline.ingest_draft, caller, row["id"])
    return row


@router.get("/drafts")
def list_drafts(caller: sb.Caller = Depends(sb.require_admin)):
    return sb.rest(caller, "GET", "fiche_drafts", {"select": "id,topic_id,form,status,stage,stage_detail,error,licence_scope,created_at,updated_at", "order": "created_at.desc"})


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: str, caller: sb.Caller = Depends(sb.require_admin)):
    d = _one(caller, draft_id)
    meta = sb.rest(caller, "GET", "fiche_line_meta", {"draft_id": f"eq.{draft_id}", "select": "*"}) or []
    return {**d, "lines": [m for m in meta if not m["dropped"]], "dropped": [m for m in meta if m["dropped"]],
            "cost": pipeline.summary(caller, draft_id), "models": list(llm.MODELS)}


class OffsetIn(BaseModel):
    offset: int


@router.post("/drafts/{draft_id}/offset")
def set_offset(draft_id: str, body: OffsetIn, caller: sb.Caller = Depends(sb.require_admin)):
    """The printed page offset, typed by the user when it was not detected (printed page = PDF page + offset)."""
    _one(caller, draft_id)
    sb.rest(caller, "PATCH", "fiche_drafts", {"id": f"eq.{draft_id}"}, {"page_offset": body.offset, "stage": "ready", "stage_detail": None})
    return {"ok": True}


class GenerateIn(BaseModel):
    model: str = llm.DEFAULT_MODEL
    batch: bool = False  # Message Batches API: half price, for when nobody waits on the result
    fallback: str | None = None  # model rerunning a section still failing after its corrections; "none" for none


@router.post("/drafts/{draft_id}/generate", status_code=202)
def generate(draft_id: str, body: GenerateIn, background: BackgroundTasks, caller: sb.Caller = Depends(sb.require_admin)):
    d = _one(caller, draft_id)
    if d["stage"] not in ("ready", "done", "error") or d["page_offset"] is None:
        raise HTTPException(status_code=409, detail="Le PDF n'est pas prêt (ingestion en cours ou décalage des pages à saisir)")
    if body.model not in llm.MODELS:
        raise HTTPException(status_code=422, detail=f"Modèle : {', '.join(llm.MODELS)}")
    opts = {"model": body.model, "batch": body.batch, **({"fallback": body.fallback} if body.fallback else {})}
    sb.rest(caller, "PATCH", "fiche_drafts", {"id": f"eq.{draft_id}"}, {"options": opts, "stage": "routing"})
    background.add_task(pipeline.generate_draft, caller, draft_id)
    return {"ok": True}


class ContentIn(BaseModel):
    content: dict


@router.put("/drafts/{draft_id}/content")
def save_content(draft_id: str, body: ContentIn, caller: sb.Caller = Depends(sb.require_admin)):
    """The reviewer's edits. The status cannot change here, and the fiche must stay valid."""
    d = _one(caller, draft_id)
    content = body.content
    content.setdefault("meta", {})["status"] = (d["content"] or {}).get("meta", {}).get("status", "draft")
    problems = validate(content)
    if problems:
        raise HTTPException(status_code=422, detail="Fiche non conforme : " + " ; ".join(problems[:5]))
    sb.rest(caller, "PATCH", "fiche_drafts", {"id": f"eq.{draft_id}"}, {"content": content, "updated_at": pipeline._now()})
    return {"ok": True}


class ApproveIn(BaseModel):
    status: str
    reviewer: str


@router.post("/drafts/{draft_id}/approve")
def approve(draft_id: str, body: ApproveIn, caller: sb.Caller = Depends(sb.require_admin)):
    """A human approval: "review", or "published" when the licence allows publication and every dose has its
    Algerian status (validated)."""
    d = _one(caller, draft_id)
    if body.status not in ("review", "published"):
        raise HTTPException(status_code=422, detail="Statut : review ou published")
    if not body.reviewer.strip():
        raise HTTPException(status_code=422, detail="Nom du relecteur requis")
    if body.status == "published" and d["licence_scope"] != "publish":
        raise HTTPException(status_code=409, detail="Licence « usage interne seulement » : publication impossible")
    content = d["content"]
    if not content:
        raise HTTPException(status_code=409, detail="Aucune fiche générée")
    when = pipeline._now()
    content["meta"].update(status=body.status, reviewer=body.reviewer.strip(), reviewed_at=when)
    problems = validate(content)
    if problems:
        raise HTTPException(status_code=422, detail="Fiche non conforme : " + " ; ".join(problems[:5]))
    sb.rest(caller, "PATCH", "fiche_drafts", {"id": f"eq.{draft_id}"},
            {"content": content, "status": body.status, "reviewer": body.reviewer.strip(), "reviewed_at": when, "updated_at": when})
    return {"ok": True, "content": content}


@router.get("/drafts/{draft_id}/page/{printed}")
def page_image(draft_id: str, printed: int, caller: sb.Caller = Depends(sb.require_admin)):
    """The PDF page with this printed number, as a PNG, for the reviewer."""
    d = _one(caller, draft_id)
    if d["page_offset"] is None:
        raise HTTPException(status_code=409, detail="Décalage des pages inconnu")
    pdf_page = printed - d["page_offset"]
    body = sb.download(caller, d["pdf_path"])
    if body is None or pdf_page < 1:
        raise HTTPException(status_code=404, detail="Page introuvable")
    with tempfile.NamedTemporaryFile(suffix=".pdf") as f:
        f.write(body)
        f.flush()
        png = subprocess.run(["pdftoppm", "-f", str(pdf_page), "-l", str(pdf_page), "-png", "-r", "90", "-singlefile", f.name],
                             capture_output=True, timeout=60).stdout
    if not png:
        raise HTTPException(status_code=404, detail="Page introuvable")
    return Response(content=png, media_type="image/png")
