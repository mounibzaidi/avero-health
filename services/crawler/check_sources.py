"""Check every source of shared/sources.yaml before crawling it: does the domain answer, where does
it redirect, and does its robots.txt let our crawler in (and does it block AI crawlers by name).

    .venv/bin/python check_sources.py            # -> downloads/sources_check.json, and a table

Two requests per source (robots.txt, home page), DELAY_S apart, with the collectors' user agent.
Nothing is downloaded beyond those two responses.
"""

import json
import sys
import time
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import httpx

import polite
import yaml

from web_scraper import USER_AGENT

HERE = Path(__file__).resolve().parent
SOURCES = HERE.parents[1] / "shared" / "sources.yaml"
OUT = HERE / "downloads" / "sources_check.json"
DELAY_S = 2.0
AI_BOTS = ("GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Google-Extended")


def sources() -> list[dict]:
    """Every source of the file, flattened, with the section it is in."""
    out = []

    def walk(node, path):
        if isinstance(node, list):
            out.extend({**s, "section": "/".join(path)} for s in node)
        elif isinstance(node, dict):
            for k, v in node.items():
                walk(v, [*path, k])

    walk(yaml.safe_load(SOURCES.read_text()), [])
    return out


def check(client: httpx.Client, s: dict) -> dict:
    res = {"id": s["id"], "url": s["url"], "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    host = urlparse(s["url"]).hostname
    try:
        home = client.get(s["url"])
        res.update(status=home.status_code, final_url=str(home.url))
    except httpx.HTTPError as exc:
        res.update(status=None, error=f"{type(exc).__name__}: {exc}"[:200])
        return res
    time.sleep(DELAY_S)
    base = f"{urlparse(str(home.url)).scheme}://{urlparse(str(home.url)).hostname}"
    try:
        r = client.get(f"{base}/robots.txt")
        rp = urllib.robotparser.RobotFileParser()
        rp.parse(r.text.splitlines() if r.status_code == 200 else [])
        res.update(
            robots=r.status_code,
            allowed=rp.can_fetch(polite.ROBOT_NAME, f"{base}/"),
            ai_blocked=[b for b in AI_BOTS if not rp.can_fetch(b, f"{base}/")],
            crawl_delay=rp.crawl_delay(polite.ROBOT_NAME),
        )
    except httpx.HTTPError as exc:
        res.update(robots=None, robots_error=type(exc).__name__)
    res["moved"] = urlparse(str(home.url)).hostname not in (host, f"www.{host}", host.removeprefix("www."))
    return res


def main() -> None:
    items = sources()
    results = []
    with polite.client(headers={"User-Agent": USER_AGENT}, timeout=20, follow_redirects=True) as client:
        for n, s in enumerate(items, 1):
            r = check(client, s)
            results.append(r)
            flag = "DOWN" if not r.get("status") or r["status"] >= 400 else "moved" if r.get("moved") else "ok"
            robots = "" if r.get("allowed", True) else "robots: disallowed"
            ai = f"AI bots blocked: {len(r['ai_blocked'])}" if r.get("ai_blocked") else ""
            print(f"{n:>2}/{len(items)} {s['id']:<14} {flag:<5} {r.get('status')} {r.get('final_url', r.get('error', ''))[:60]:<60} {robots} {ai}", flush=True)
            time.sleep(DELAY_S)
    OUT.write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(f"-> {OUT.relative_to(HERE)}", file=sys.stderr)


if __name__ == "__main__":
    main()
