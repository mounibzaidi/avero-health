// Which of a fiche's sources a PDF is, from what its first pages say: the source whose title, citation and body name
// are found there. No guess from the order the files were added.

type SourceLike = { id: string; title: string; citation: string; organisation: string };

const STOP = new Set([
  "les", "des", "une", "pour", "par", "dans", "sur", "aux", "avec", "and", "the", "for", "with", "from", "that",
  "chez", "son", "ses", "est", "qui", "que", "pas", "plus", "ministere", "sante", "guide", "guidelines", "society",
]);

/** Words of a text, lower case and without accents, three letters or more (numbers of two digits or more). */
export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").split(/[^\p{L}\p{N}]+/u)) {
    if ((/^\d+$/.test(w) ? w.length >= 2 : w.length >= 3) && !STOP.has(w)) out.add(w);
  }
  return out;
}

/** How much of a source's description is in the PDF's text, 0 to 1. */
export function score(source: SourceLike, pdfWords: Set<string>): number {
  const want = words(`${source.title} ${source.citation} ${source.organisation}`);
  if (!want.size) return 0;
  let hit = 0;
  for (const w of want) if (pdfWords.has(w)) hit++;
  return hit / want.size;
}

/** Below this a PDF is said to be none of the sources; from SURE it is taken as matched. */
const MIN = 0.4;
const SURE = 0.6;

/**
 * Each PDF (by key, its text) to the source it is, one PDF per source, best matches first. `sure` when most of the
 * source's description is found; a PDF matching no source well enough is left out.
 */
export function matchSources(texts: Record<string, string>, sources: SourceLike[]): Record<string, { source: string; sure: boolean }> {
  const pairs: { key: string; source: string; s: number }[] = [];
  for (const [key, text] of Object.entries(texts)) {
    const w = words(text);
    for (const src of sources) pairs.push({ key, source: src.id, s: score(src, w) });
  }
  pairs.sort((a, b) => b.s - a.s);
  const out: Record<string, { source: string; sure: boolean }> = {};
  const taken = new Set<string>();
  for (const p of pairs) {
    if (p.s < MIN || p.key in out || taken.has(p.source)) continue;
    out[p.key] = { source: p.source, sure: p.s >= SURE };
    taken.add(p.source);
  }
  return out;
}

/** The text of a PDF's first pages (and its title in the file's metadata), read in the browser. */
export async function pdfText(src: File | string, pages = 3): Promise<string> {
  const { pdfjs } = await import("react-pdf");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const data = typeof src === "string" ? { url: src } : { data: new Uint8Array(await src.arrayBuffer()) };
  const doc = await pdfjs.getDocument(data).promise;
  const meta = await doc.getMetadata().catch(() => null);
  const parts = [String((meta?.info as { Title?: string } | undefined)?.Title ?? "")];
  for (let i = 1; i <= Math.min(pages, doc.numPages); i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    parts.push(content.items.map((x) => ("str" in x ? x.str : "")).join(" "));
  }
  void doc.cleanup();
  return parts.join(" ");
}
