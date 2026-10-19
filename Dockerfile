# The Avero API (services/api) with the guideline crawler it runs (services/crawler), for a container host
# (Render, Railway, Fly). pdftotext for the quote check, Chromium for the crawler. Settings come from the host's
# environment variables (names in .env.example); no .env.local is copied in.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY services/api/requirements.txt services/api/requirements.txt
RUN pip install -r services/api/requirements.txt
COPY services/crawler/requirements.txt services/crawler/requirements.txt
RUN python -m venv services/crawler/.venv \
 && services/crawler/.venv/bin/pip install -r services/crawler/requirements.txt \
 && services/crawler/.venv/bin/python -m playwright install --with-deps chromium

COPY shared shared
COPY services/crawler services/crawler
COPY services/api services/api

WORKDIR /app/services/api
EXPOSE 8000
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
