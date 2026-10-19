# Avero API (services/api)

FastAPI service for the dashboard. It acts as the signed-in staff member (their Supabase session and the
publishable key), so the database's own rules apply; it needs no secret key.

Today: Collecte (`/crawl/*`): topic search across `shared/sources.yaml`, collecting a page or a PDF, uploads,
links to stored PDFs. Every PDF is kept in the Storage bucket `sources` under its topic, with its provenance
record (`<topic>/<file>.pdf.json`). `POST /checks/quotes`: each evidence quote on its page of the source PDF (`app/quotecheck.py`, needs `pdftotext`: `sudo apt install poppler-utils`).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000      # or, from the repo root: npm run api
```

Settings come from the repo-root `.env.local` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`). The crawler runs in its
own venv (`services/crawler`, see its README).
