"""The rules every collector's request goes through. No collector opens its own HTTP client.

1. robots.txt, when OBEY_ROBOTS is on (it is off: the project owner's decision, see below). It is then
   obeyed for our crawler's name first (a "User-agent: AveroHealthBot" group, else
   "*"), on every host a request or a redirect reaches. An unreadable robots.txt (5xx, network error)
   or one that answers 401/403 means "no"; a missing one (404) means "yes", as the standard says.
   The hosts of DOCUMENTED_APIS are the exception: their robots.txt is not applied (rules 2 and 3 are).
2. At most one request per second per host, or slower when robots.txt gives a Crawl-delay.
3. No login-protected page: an address that is a login page is never requested, a redirect to one is
   not followed, and a 401/403 answer stops there. No collector sends credentials.

    with polite.client(headers={"User-Agent": USER_AGENT}) as client: client.get(url)
    async with polite.async_client(...) as client: await client.get(url)
    polite.gate(url, USER_AGENT)   # before a page is rendered in the headless browser

A refused request raises Blocked (an httpx.HTTPError: the collectors report it like any failed
request). The headless browser's own sub-requests (scripts, images of the one page it renders) are
not paced; the page itself is.
"""

import asyncio
import re
import threading
import time
import urllib.robotparser
from urllib.parse import urlsplit

import httpx

ROBOT_NAME = "AveroHealthBot"  # the product token robots.txt groups are matched against
# Off (decided by the project owner, 2026-10-02): the collectors fetch a page even when the site's
# robots.txt closes it to crawlers. Rules 2 and 3 still apply. True brings rule 1 back.
OBEY_ROBOTS = False
MIN_DELAY_S = 1.0
# Hosts whose robots.txt is not applied (decided by the project owner, 2026-10-02): documented public
# APIs and open-data stores whose robots.txt closes them to crawlers, which our collectors read as
# their documentation describes. Pacing and the no-login rule still apply to them.
DOCUMENTED_APIS: tuple[str, ...] = (
    "eutils.ncbi.nlm.nih.gov",  # NCBI E-utilities: pmc.py
    "www.data.gouv.fr",         # data.gouv.fr dataset API and its file redirects: has_catalogue.py
    "static.data.gouv.fr",      # data.gouv.fr file store: has_catalogue.py
)
_LOGIN = re.compile(r"/(login|log-in|signin|sign-in|connexion|se-connecter|identification|authentification|auth|sso|wp-login\.php|mon-compte|espace-(membre|adherent)s?)(/|\?|\.|$)", re.I)


class Blocked(httpx.HTTPError):
    """A request the rules do not allow."""


class _Host:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.robots: urllib.robotparser.RobotFileParser | None = None
        self.closed: str | None = None  # why nothing may be fetched, when robots.txt could not be read
        self.loaded = False
        self.delay = MIN_DELAY_S
        self.last = 0.0


_hosts: dict[str, _Host] = {}
_hosts_lock = threading.Lock()


def _host(origin: str) -> _Host:
    with _hosts_lock:
        return _hosts.setdefault(origin, _Host())


def _pace(host: _Host) -> None:
    wait = host.last + host.delay - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    host.last = time.monotonic()


def _load_robots(host: _Host, origin: str, user_agent: str) -> None:
    host.loaded = True
    try:
        with httpx.Client(headers={"User-Agent": user_agent}, timeout=30, follow_redirects=True) as plain:
            r = plain.get(f"{origin}/robots.txt")
    except httpx.HTTPError as exc:
        host.closed = f"robots.txt illisible ({type(exc).__name__})"
        return
    finally:
        host.last = time.monotonic()
    if r.status_code in (401, 403) or r.status_code >= 500:
        host.closed = f"robots.txt répond {r.status_code}"
        return
    host.robots = urllib.robotparser.RobotFileParser()
    is_text = r.status_code == 200 and "html" not in r.headers.get("content-type", "")
    host.robots.parse(r.text.splitlines() if is_text else [])
    host.delay = max(MIN_DELAY_S, float(host.robots.crawl_delay(ROBOT_NAME) or 0))


def gate(url: str, user_agent: str) -> None:
    """Wait for this host's turn, or raise Blocked when the rules refuse the address."""
    parts = urlsplit(url)
    origin = f"{parts.scheme}://{parts.netloc}"
    host = _host(origin)
    with host.lock:
        if parts.path != "/robots.txt":
            if _LOGIN.search(parts.path):
                raise Blocked(f"page de connexion, non demandée : {url}")
            if OBEY_ROBOTS and parts.hostname not in DOCUMENTED_APIS:
                if not host.loaded:
                    _load_robots(host, origin, user_agent)
                if host.closed:
                    raise Blocked(f"{host.closed} : {origin}")
                if not host.robots.can_fetch(ROBOT_NAME, url):
                    raise Blocked(f"interdit par robots.txt : {url}")
        _pace(host)


def _refused(response: httpx.Response) -> str | None:
    """Why an answer means "protected", if it does."""
    if response.status_code in (401, 403):
        return f"page protégée ou refusée (HTTP {response.status_code})"
    location = response.headers.get("location", "")
    if 300 <= response.status_code < 400 and _LOGIN.search(urlsplit(location).path):
        return "redirection vers une page de connexion"
    return None


class PoliteTransport(httpx.BaseTransport):
    def __init__(self, **kw) -> None:
        self.inner = httpx.HTTPTransport(**kw)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        gate(str(request.url), request.headers.get("user-agent", ROBOT_NAME))
        response = self.inner.handle_request(request)
        why = _refused(response)
        if why:
            response.close()
            raise Blocked(f"{why} : {request.url}")
        return response

    def close(self) -> None:
        self.inner.close()


class AsyncPoliteTransport(httpx.AsyncBaseTransport):
    def __init__(self, **kw) -> None:
        self.inner = httpx.AsyncHTTPTransport(**kw)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        await asyncio.to_thread(gate, str(request.url), request.headers.get("user-agent", ROBOT_NAME))
        response = await self.inner.handle_async_request(request)
        why = _refused(response)
        if why:
            await response.aclose()
            raise Blocked(f"{why} : {request.url}")
        return response

    async def aclose(self) -> None:
        await self.inner.aclose()


def client(local_address: str | None = None, **kw) -> httpx.Client:
    """An httpx.Client whose every request, redirects included, goes through the rules."""
    return httpx.Client(transport=PoliteTransport(local_address=local_address), **kw)


def async_client(**kw) -> httpx.AsyncClient:
    kw.pop("limits", None)  # one request at a time per host: a connection pool has nothing to add
    return httpx.AsyncClient(transport=AsyncPoliteTransport(), **kw)
