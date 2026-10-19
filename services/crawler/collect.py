"""Collect one guideline page's PDFs: picks the collector for the URL's site.

    python collect.py <URL> [--job ID] [--out DIR] [--all]

www.has-sante.fr -> has_scraper.py (Crawl4AI renders the page; without Crawl4AI, as on Vercel, web_scraper.py);
pmc.ncbi.nlm.nih.gov -> pmc.py (PMC Article Datasets on S3); any other site (learned societies,
ministries, agencies) -> web_scraper.py (the page's PDF links).
Same arguments, same JSON-line events, same manifest.
"""

import importlib.util
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
HAS_BROWSER = importlib.util.find_spec("crawl4ai") is not None
COLLECTORS = {"www.has-sante.fr": ["has_scraper.py" if HAS_BROWSER else "web_scraper.py"], "pmc.ncbi.nlm.nih.gov": ["pmc.py", "collect"]}

if __name__ == "__main__":
    url = next((a for a in sys.argv[1:] if a.startswith("http")), "")
    if urlparse(url).scheme not in ("http", "https"):
        print('{"type": "error", "message": "URL http(s) attendue"}', flush=True)
        sys.exit(2)
    # A direct link to a PDF is one file to download, whatever the site: the generic collector does that.
    is_pdf = urlparse(url).path.lower().endswith(".pdf")
    target = ["web_scraper.py"] if is_pdf else COLLECTORS.get(urlparse(url).hostname or "", ["web_scraper.py"])
    os.execv(sys.executable, [sys.executable, str(HERE / target[0]), *target[1:], *sys.argv[1:]])
