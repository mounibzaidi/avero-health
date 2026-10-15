# Scraper

Downloads the PDFs a HAS guideline page publishes, with provenance. Runs in its own venv so
Crawl4AI / Playwright stay out of the API's dependencies; the API starts it from the dashboard's
**Collecte** page (`backend/app/routers/scrape.py`).

## Rules every collector follows (`polite.py`)

Every request of every collector goes through `polite.py`; none opens its own HTTP client.

- At most one request per second per host, slower when robots.txt gives a Crawl-delay.
- No login-protected page: a login address is never requested, a redirect to one is not followed,
  a 401/403 answer stops there. No collector sends credentials.
- robots.txt is **not** applied: `OBEY_ROBOTS = False` in `polite.py` (the project owner's decision,
  2026-10-02), so a page is fetched even when the site's robots.txt closes it to crawlers. Set it to
  `True` to obey robots.txt again, for the group that names our crawler (`MedGuidesBot`) first,
  else `*`; the hosts of `DOCUMENTED_APIS` (NCBI E-utilities, data.gouv.fr) then stay exempt.

## Add one PDF by its link

On a topic page of the dashboard, "Ajouter par URL" takes the direct link of a PDF (a HAS or WHO
file, or anything the collectors do not reach): `web_scraper.py <URL> --single` downloads that one
file into `downloads/web/…`, writes its manifest record (address, date, size, sha256) and adds it to
the topic. A link already in the manifest is not fetched again.

## Ranking

Every result, from the catalogues (`topics.py`) and from the all-sources search (`search_sources.py`),
gets one score with its reasons (`doc_kinds.py`, `rank` and `POINTS`): the topic named in the title
(a neighbouring topic of `topics.yaml` `neighbors` loses points), the kind of document (guideline,
short guideline, consensus, position paper, review), interventional or surgical documents, age over
8 years, French before English, downloadable before link only. News, courses, commentaries, COVID-era,
temporary and superseded documents are hidden. The dashboard shows the first five per list, "Voir tout"
for the rest, and the reasons when the score is hovered.

## Setup (once)

```bash
cd scraper
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m playwright install chromium
sudo .venv/bin/python -m playwright install-deps chromium   # system libs (libnspr4, libnss3...) on WSL/Ubuntu
.venv/bin/crawl4ai-doctor                                     # should end without a launch error
```

## Catalogue: which protocols can be downloaded

```bash
.venv/bin/python has_catalogue.py     # -> downloads/catalogue.json
```

Built from HAS's own open data on data.gouv.fr ("Métadonnées des publications de la HAS",
Licence Ouverte 2.0), not by crawling: the site's search (`/jcms/fc_2875171/`) is disallowed in
robots.txt and behind a bot challenge. Keeps recommandations de bonne pratique, guides maladie
chronique / PNDS and recommandations vaccinales, each with its page URL and PDF URLs. The export is
refreshed irregularly by HAS (check `source.file_updated`), so the newest publications may be missing.

By default only the guideline texts are downloaded (recommandations, synthèse, fiche mémo,
algorithme...); argumentaire, note de cadrage, rapport d'élaboration, reading-group results, English
versions and patient leaflets are listed as skipped (rules in `doc_kinds.py`). `--all` (or "Inclure
les annexes" in the dashboard) downloads them too. A publication whose only PDF is a note de cadrage
is marked `in_progress`: HAS has started it but not published it.

## WHO (IRIS): no collector

IRIS has no harvesting endpoint its robots.txt allows (checked 2026-10-02: the REST API, OAI-PMH and
OpenSearch are closed; the sitemaps, item pages and files are open), so there is no WHO collector. A
WHO PDF is added by its link ("Ajouter par URL" on a topic page).

## PubMed Central

```bash
.venv/bin/python pmc.py catalogue                                        # -> downloads/pmc.json (~4 min)
.venv/bin/python pmc.py collect https://pmc.ncbi.nlm.nih.gov/articles/PMC…/  # or: collect.py <URL>
```

NCBI's own programmatic access. Catalogue: E-utilities (`esearch` for the records: publication type
Practice Guideline, PMC Open Access, English/French/Arabic; `esummary` for titles and dates; `esearch`
with PMC's licence filters for each article's licence). Collect: `efetch` returns the article's XML,
where the licence is read again, article by article; the PDF then comes from the PMC Article Datasets
bucket (NCBI's open-data store on S3: `efetch` has no PDF), with its MD5 checked.
Only licences that allow adaptation are collected (CC0, BY, BY-SA, BY-NC, BY-NC-SA); ND and unlicensed
articles are link only. Every E-utilities request names the tool and a contact email: set
`NCBI_EMAIL=…` (and `NCBI_API_KEY=…` if you have one) in the environment or in `backend/.env.local`;
until then requests go without an email. One request per second (NCBI allows three); a server
error is retried twice. NLM terms for redistributors: keep content current or say it may not be,
no NLM endorsement implied.

## Learned societies: listed and downloadable

```bash
.venv/bin/python societies_catalogue.py   # -> downloads/societies.json
```

SPILF, SFAR, SFMU and SFC are indexed from their pages (title, year, the society's page and links).
Their PDFs can be downloaded like any other source (`link_only: False`, the project owner's decision);
their reuse status in `shared/sources.yaml` is `check`: read the society's terms before publishing
anything taken from them. One request per index page (SFC: per archive page), 1.5 s apart. SFC's REST
API is closed to the public (401), so we use its archive pages. SPILF's page also curates other
bodies' documents (HCSP, CNS, ministère): those are tagged "Document d'un autre organisme".

## Topics: what to look for

```bash
.venv/bin/python topics.py match          # -> downloads/topic_matches.json, and a coverage table
.venv/bin/python topics.py show sepsis    # the ranked candidates for one topic
```

The predefined topics live in `shared/topics.yaml`: emergencies first, then usual GP consultations,
each with French and English names, French keywords and acronyms, a priority (1 = demo) and
`local_program` for topics where the Algerian Ministry of Health / INSP should be checked first (not
crawled yet). The matcher reads the four catalogues above, no network: a title matches a topic when
it contains every word of one of its names (accents, case and plurals folded; "X et Y" names match X
or Y alone), keyword phrases and acronyms add weight, `exclude` terms rule an entry out. Candidates
are ranked current before older than 10 years, then strength of match, collectable before link-only,
then the source order in the topics file (WHO, HAS, societies, PMC), then newest. It is a shortlist
for a person: the dashboard's Collecte page shows it under "Par thème" with a Collecter button per
source (`/scrape/topics`, re-ranked by `/scrape/topics/refresh`).

## Run by hand

```bash
.venv/bin/python has_scraper.py https://www.has-sante.fr/jcms/c_2059286/fr/prise-en-charge-de-l-hypertension-arterielle-de-l-adulte
```

Output (gitignored): `downloads/has/<page-id>-<slug>/*.pdf`, and one line per downloaded file in
`downloads/manifest.jsonl`: `source_page_url`, `source_page_title`, `document_url`, `file_url`,
`title`, `fetched_at`, `bytes`, `sha256`, `last_modified` (the server's header), `path`, `scraper`.

## Sources registry: where to crawl

`shared/sources.yaml` lists the guideline publishers to crawl (Maghreb, WHO, French agencies and
societies, francophone and English-language bodies), each with its reuse status (`open`, `check`:
read the terms before storing text, `link_only`), a priority and, where something matters before
crawling, a `note`. Entries marked `added: true` were added to the original list.

```bash
.venv/bin/python check_sources.py   # -> downloads/sources_check.json, and a table
```

Checks each source before crawling: two requests (home page, robots.txt), 2 s apart, with the
collectors' user agent. It reports domains that are down or moved, robots.txt refusals, and sites
that block AI crawlers by name (our crawler is allowed there, but their terms on AI use must be read
before storing any text). Its findings are written into the registry's `note` fields.

## Topic search across all sources

```bash
.venv/bin/python search_sources.py pulmonary-embolism   # -> downloads/search/pulmonary-embolism.json
```

What the dashboard runs when a topic is opened (Collecte > Thèmes, or a topic page). Each source of
`shared/sources.yaml` is indexed from its sitemaps (robots.txt `Sitemap:` lines, else
`/sitemap.xml`) into `downloads/source_index/<id>.json`, refreshed weekly: robots.txt is obeyed only when `OBEY_ROBOTS` is on (it is off, see above), one
request at a time per site 1.5 s apart (or the site's Crawl-delay, up to 5 s), 8 sites in parallel.
The topic is matched on page addresses with the rules of `topics.py`. The first search builds every
index (several minutes); later ones reuse them. Sources with their own catalogue (HAS, PMC, SFMU,
SFAR, SFC, SPILF) are left to it. A site without a sitemap is crawled instead: links
followed from its home page (or the source's `start` URL), the promising ones first (recommandations,
guidelines, publications, PDF…), 3 levels, up to 250 pages, their link text kept as titles; a site
whose HTML is built by JavaScript is read through the headless browser (60 pages). Unreachable sites
and bot walls (Cloudflare 403) are reported, never forced. Matching is on each page's link text and address, on the topic's names and keywords and also its
core term (the name without generic qualifiers: "Méningite bactérienne aiguë" is found as
"méningite"); the topic's excludes still apply. Pages that read as guidance (recommandation,
guideline, prise en charge, protocole…) are listed first; news and articles follow, and a person picks
what to download. The real title of each result is read once from the page and kept in the index.
Failures (unreachable site, no sitemap nor links) are remembered for a day.
