"""Run one SQL file on the Avero Health Supabase database, in a single transaction (all or nothing).

    npm run db:sql -- <file.sql> [extra query ...]     (services/api/.venv has psycopg2)

Reads SUPABASE_DB_URL from the repo-root .env.local and never prints it. The direct database host is IPv6 only,
so this connects through Supabase's IPv4 session pooler (eu-west-1) with the same password. Prints the rows of
the file's last query, then the result of each extra query.
"""

import sys
from pathlib import Path
from urllib.parse import urlsplit

import psycopg2

ROOT = Path(__file__).resolve().parents[2]
REF = "kjfvojxcrucrtasixfkk"
POOLER = "aws-0-eu-west-1.pooler.supabase.com"


def main() -> None:
    url = next(l.split("=", 1)[1].strip().strip('"') for l in (ROOT / ".env.local").read_text(encoding="utf-8").splitlines() if l.startswith("SUPABASE_DB_URL="))
    assert REF in url, "SUPABASE_DB_URL is not the Avero Health project"
    con = psycopg2.connect(host=POOLER, port=5432, dbname="postgres", user=f"postgres.{REF}", password=urlsplit(url).password, connect_timeout=20)
    sql = Path(sys.argv[1]).read_text(encoding="utf-8")
    with con, con.cursor() as cur:
        cur.execute(sql)
        print("last query:", cur.fetchall() if cur.description else f"{cur.rowcount} row(s)")
    with con.cursor() as cur:
        for q in sys.argv[2:]:
            cur.execute(q)
            print(f"{q} ->", cur.fetchall())


if __name__ == "__main__":
    main()
