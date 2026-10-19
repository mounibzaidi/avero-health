"""Supabase from the server, acting as the signed-in staff member: their session token and the project's
publishable key, so the database's own rules apply (staff read, admins write). No secret key needed."""

from dataclasses import dataclass

import httpx
from fastapi import Header, HTTPException

from .settings import setting

BUCKET = "sources"


@dataclass(frozen=True)
class Caller:
    uid: str
    token: str


def _base() -> str:
    return setting("SUPABASE_URL").rstrip("/")


def _as(caller: Caller) -> dict[str, str]:
    return {"apikey": setting("SUPABASE_ANON_KEY"), "Authorization": f"Bearer {caller.token}"}


def _send(method: str, url: str, retry: bool = True, **kw) -> httpx.Response:
    """One HTTP call to Supabase; a timeout or dropped connection is tried once more when the call can be repeated
    safely (reads, updates, deletes; not inserts)."""
    try:
        return httpx.request(method, url, **kw)
    except httpx.TransportError:
        if not retry:
            raise
        return httpx.request(method, url, **kw)


def require_admin(authorization: str = Header(default="")) -> Caller:
    """The caller, when their Supabase session belongs to an admin in staff."""
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sign-in required")
    r = _send("GET", f"{_base()}/auth/v1/user", headers={"apikey": setting("SUPABASE_ANON_KEY"), "Authorization": f"Bearer {token}"}, timeout=15)
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Session expired: sign in again")
    caller = Caller(uid=r.json()["id"], token=token)
    staff = _send("GET", f"{_base()}/rest/v1/staff", params={"user_id": f"eq.{caller.uid}", "select": "role"}, headers=_as(caller), timeout=15).json()
    if not isinstance(staff, list) or not staff or staff[0]["role"] != "admin":
        raise HTTPException(status_code=403, detail="Administrators only")
    return caller


def require_viewer(authorization: str = Header(default="")) -> Caller:
    """For reads, open to everyone: the signed-in caller, or a visitor acting as anon (reading is open in the database)."""
    if authorization.removeprefix("Bearer").strip():
        return require_admin(authorization)
    return Caller(uid="", token=setting("SUPABASE_ANON_KEY"))


def upload(caller: Caller, path: str, body: bytes, content_type: str, replace: bool = False) -> None:
    """replace: overwrite a file already there (a topic's last search), instead of keeping the first one."""
    headers = {**_as(caller), "Content-Type": content_type, **({"x-upsert": "true"} if replace else {})}
    r = httpx.post(f"{_base()}/storage/v1/object/{BUCKET}/{path}", content=body, headers=headers, timeout=120)
    # 409: the same file (same hash in its name) is already kept for this topic.
    if r.status_code not in (200, 201, 409) and "Duplicate" not in r.text:
        raise HTTPException(status_code=502, detail=f"Storage: {r.text[:200]}")


def remove(caller: Caller, paths: list[str]) -> None:
    r = _send("DELETE", f"{_base()}/storage/v1/object/{BUCKET}", json={"prefixes": paths}, headers=_as(caller), timeout=30)
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Storage: {r.text[:200]}")


def download(caller: Caller, path: str) -> bytes | None:
    r = _send("GET", f"{_base()}/storage/v1/object/authenticated/{BUCKET}/{path}", headers=_as(caller), timeout=120)
    return r.content if r.status_code == 200 else None


def listing(caller: Caller, prefix: str) -> list[dict]:
    r = httpx.post(f"{_base()}/storage/v1/object/list/{BUCKET}", json={"prefix": prefix, "limit": 1000, "sortBy": {"column": "name", "order": "asc"}},
                   headers=_as(caller), timeout=30)
    return r.json() if r.status_code == 200 else []


def signed_url(caller: Caller, path: str, seconds: int = 3600) -> str:
    r = httpx.post(f"{_base()}/storage/v1/object/sign/{BUCKET}/{path}", json={"expiresIn": seconds}, headers=_as(caller), timeout=30)
    if r.status_code != 200:
        raise HTTPException(status_code=404, detail="File not found")
    return f"{_base()}/storage/v1{r.json()['signedURL']}"


def rest(caller: Caller, method: str, table: str, params: dict | None = None, body: dict | list | None = None, prefer: str | None = None) -> list | dict | None:
    """PostgREST as the caller: their row-level rules apply."""
    headers = {**_as(caller), "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    r = _send(method, f"{_base()}/rest/v1/{table}", retry=method != "POST", params=params, json=body, headers=headers, timeout=30)
    if r.status_code >= 400:
        raise HTTPException(status_code=502 if r.status_code >= 500 else r.status_code, detail=f"Database: {r.text[:200]}")
    return r.json() if r.content else None
