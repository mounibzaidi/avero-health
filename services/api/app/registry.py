"""The topic registry: the issuing bodies a person follows for each topic (never inferred), their current guideline,
and the check for newer versions. A newer version is an alert: a person replaces or ignores it, nothing is replaced
automatically. Admin only; every write is made as the caller (database rules apply)."""

import json
import subprocess
from datetime import datetime, timezone

import yaml
from fastapi import APIRouter, Depends, HTTPException

from . import supabase as sb
from .settings import CRAWLER, SHARED

router = APIRouter(prefix="/registry", tags=["registry"])
PYTHON = CRAWLER / ".venv" / "bin" / "python"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@router.get("/bodies")
def bodies(caller: sb.Caller = Depends(sb.require_admin)):
    doc = yaml.safe_load((SHARED / "guideline_bodies.yaml").read_text(encoding="utf-8"))
    return [{"id": b["id"], "name": b["name"], "region": b.get("region")} for b in doc["bodies"]]


def _run(script: str, args: list[str], stdin: str | None = None, timeout: int = 600) -> object:
    if not PYTHON.exists():
        raise HTTPException(status_code=503, detail="Crawler non installé (services/crawler/.venv)")
    done = subprocess.run([str(PYTHON), str(CRAWLER / script), *args], input=stdin, capture_output=True, text=True, timeout=timeout, cwd=CRAWLER)
    if done.returncode != 0:
        raise HTTPException(status_code=502, detail=f"Vérification impossible : {(done.stderr or done.stdout).strip().splitlines()[-1:]}")
    return json.loads(done.stdout)


@router.post("/check")
def check(caller: sb.Caller = Depends(sb.require_admin)):
    """Check every followed body for a newer guideline; write alerts for the new ones."""
    rows = sb.rest(caller, "GET", "topic_sources", {"select": "id,topic_id,body_id,current_year,current_ref,current_title"}) or []
    results = _run("registry_check.py", [], json.dumps(rows)) if rows else []
    alerts, errors = 0, []
    for res in results:
        patch = {"checked_at": _now()}
        if res.get("error"):
            errors.append(f"{res['id'][:8]} : {res['error']}")
        elif res.get("found") and res.get("newer"):
            f = res["found"]
            created = sb.rest(caller, "POST", "guideline_alerts", {"on_conflict": "topic_source_id,ref"},
                              {"topic_source_id": res["id"], "title": f["title"], "year": f["year"], "ref": f["ref"]}, prefer="resolution=ignore-duplicates,return=representation")
            alerts += len(created or [])
            patch["status"] = "à vérifier"
        sb.rest(caller, "PATCH", "topic_sources", {"id": f"eq.{res['id']}"}, patch)
    sb.rest(caller, "POST", "registry_checks", None, {"ran_by": caller.uid, "checked": len(rows), "alerts": alerts, "errors": "\n".join(errors) or None})
    return {"checked": len(rows), "alerts": alerts, "errors": errors}


def _alert(caller: sb.Caller, alert_id: str) -> dict:
    found = sb.rest(caller, "GET", "guideline_alerts", {"id": f"eq.{alert_id}", "select": "*,topic_sources(*)"}) or []
    if not found:
        raise HTTPException(status_code=404, detail="Alerte introuvable")
    return found[0]


@router.post("/alerts/{alert_id}/replace")
def replace(alert_id: str, caller: sb.Caller = Depends(sb.require_admin)):
    """The person confirms the newer version: the old one goes to the history as replaced, the new one is current."""
    a = _alert(caller, alert_id)
    ts = a["topic_sources"]
    if ts.get("current_ref") or ts.get("current_title"):
        sb.rest(caller, "POST", "guidelines_replaced", None, {
            "topic_source_id": ts["id"], "title": ts.get("current_title"), "year": ts.get("current_year"), "ref": ts.get("current_ref"),
            "replaced_by_title": a["title"], "replaced_by_year": a.get("year"), "replaced_by_ref": a["ref"], "replaced_by_user": caller.uid})
    sb.rest(caller, "PATCH", "topic_sources", {"id": f"eq.{ts['id']}"},
            {"current_title": a["title"], "current_year": a.get("year"), "current_ref": a["ref"], "status": "actuelle", "checked_at": _now()})
    sb.rest(caller, "PATCH", "guideline_alerts", {"id": f"eq.{alert_id}"}, {"state": "remplacée", "decided_by": caller.uid, "decided_at": _now()})
    return {"ok": True}


@router.post("/alerts/{alert_id}/ignore")
def ignore(alert_id: str, caller: sb.Caller = Depends(sb.require_admin)):
    a = _alert(caller, alert_id)
    sb.rest(caller, "PATCH", "guideline_alerts", {"id": f"eq.{alert_id}"}, {"state": "ignorée", "decided_by": caller.uid, "decided_at": _now()})
    pending = sb.rest(caller, "GET", "guideline_alerts", {"topic_source_id": f"eq.{a['topic_source_id']}", "state": "eq.nouvelle", "select": "id"}) or []
    if not pending:
        sb.rest(caller, "PATCH", "topic_sources", {"id": f"eq.{a['topic_source_id']}"}, {"status": "actuelle"})
    return {"ok": True}


@router.get("/propose")
def propose(topic: str, body: str, caller: sb.Caller = Depends(sb.require_admin)):
    """The body's guidelines on the topic, newest first, to pick the current one from (the person chooses)."""
    result = _run("literature.py", ["--topic", topic], timeout=240)
    return [v for fam in result["families"] if fam["body"] == body for v in fam["versions"] if v["kind"] != "article"]
