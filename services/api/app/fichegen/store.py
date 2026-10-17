"""Where fiche generation reads and writes: the tables documents, document_pages (the knowledge base of text layers),
generation_calls. Two ways in, same methods: RestStore as the signed-in admin (the routes and their background jobs,
row-level rules apply) and PgStore with the database URL (scripts such as tests/record_fichegen.py).

The text layers are read from document_pages, never from temporary files: pdftotext for every page at ingestion,
LlamaParse markdown added only for the pages that need it and never fetched twice for the same page.
"""

from datetime import datetime, timezone
from urllib.parse import urlsplit

from .. import supabase as sb
from ..settings import env

PAGE_COLS = ["document_id", "pdf_page", "printed_page", "raw_text", "raw_columns", "parsed_md", "parser", "has_table", "has_figure",
             "skipped", "section_heading", "parsed_at"]


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class RestStore:
    def __init__(self, caller: sb.Caller):
        self.caller = caller

    def document(self, sha: str, path: str, title: str | None, licence_text: str | None, licence_scope: str) -> str:
        rows = sb.rest(self.caller, "GET", "documents", {"sha256": f"eq.{sha}", "select": "id"})
        if rows:
            return rows[0]["id"]
        return sb.rest(self.caller, "POST", "documents", body={"sha256": sha, "pdf_path": path, "title": title, "licence_text": licence_text,
                                                                "licence_scope": licence_scope}, prefer="return=representation")[0]["id"]

    def pages(self, document_id: str) -> list[dict]:
        return sb.rest(self.caller, "GET", "document_pages", {"document_id": f"eq.{document_id}", "select": ",".join(PAGE_COLS), "order": "pdf_page"}) or []

    def save_pages(self, rows: list[dict]) -> None:
        for k in range(0, len(rows), 20):
            sb.rest(self.caller, "POST", "document_pages", body=rows[k:k + 20], prefer="resolution=merge-duplicates")

    def log_call(self, entry: dict) -> None:
        sb.rest(self.caller, "POST", "generation_calls", body=entry)


class PgStore:
    """The database directly (the session pooler, like tools/db/run_sql.py), for scripts without a signed-in user."""

    REF = "kjfvojxcrucrtasixfkk"
    POOLER = "aws-0-eu-west-1.pooler.supabase.com"

    def __init__(self):
        import psycopg2

        url = env()["SUPABASE_DB_URL"]
        self.con = psycopg2.connect(host=self.POOLER, port=5432, dbname="postgres", user=f"postgres.{self.REF}",
                                    password=urlsplit(url).password, connect_timeout=20)
        self.con.autocommit = True

    def _rows(self, sql: str, args: tuple) -> list[dict]:
        with self.con.cursor() as cur:
            cur.execute(sql, args)
            cols = [c.name for c in cur.description] if cur.description else []
            return [dict(zip(cols, r)) for r in cur.fetchall()] if cols else []

    def document(self, sha, path, title, licence_text, licence_scope) -> str:
        got = self._rows("select id from documents where sha256 = %s", (sha,))
        if got:
            return str(got[0]["id"])
        return str(self._rows("insert into documents (sha256, pdf_path, title, licence_text, licence_scope) values (%s,%s,%s,%s,%s) returning id",
                              (sha, path, title, licence_text, licence_scope))[0]["id"])

    def pages(self, document_id: str) -> list[dict]:
        rows = self._rows(f"select {', '.join(PAGE_COLS)} from document_pages where document_id = %s order by pdf_page", (document_id,))
        for r in rows:
            r["document_id"] = str(r["document_id"])
            r["parsed_at"] = r["parsed_at"].isoformat() if r["parsed_at"] else None
        return rows

    def save_pages(self, rows: list[dict]) -> None:
        cols = PAGE_COLS
        sql = (f"insert into document_pages ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))}) "
               f"on conflict (document_id, pdf_page) do update set {', '.join(f'{c} = excluded.{c}' for c in cols[2:])}")
        with self.con.cursor() as cur:
            for r in rows:
                cur.execute(sql, tuple(r.get(c) for c in cols))

    def log_call(self, entry: dict) -> None:
        cols = ["draft_id", "stage", "section", "model", "batch", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "cost_usd"]
        self._rows(f"insert into generation_calls ({', '.join(cols)}) values ({', '.join(['%s'] * len(cols))})", tuple(entry.get(c) for c in cols))

