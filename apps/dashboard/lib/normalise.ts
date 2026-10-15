// Same normalisation as services/api/app/verify.py, so the quote the backend verified is the text
// highlighted in the PDF: case, accents, punctuation and whitespace are ignored.

export function normaliseChars(text: string): string {
  return text
    .replace(/<\/?[a-zA-Z][^<>]*>/g, " ")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Indices of the text items (pdf.js text layer) that contain the quote, or [] if it is not on
 * this page. Matching runs over the items' concatenated normalised text.
 */
export function itemsCoveringQuote(items: string[], quote: string): number[] {
  const needle = normaliseChars(quote);
  if (!needle) return [];
  let hay = "";
  const owner: number[] = []; // owner[i] = item index of hay[i]
  items.forEach((str, idx) => {
    const n = normaliseChars(str);
    hay += n;
    for (let k = 0; k < n.length; k++) owner.push(idx);
  });
  const at = hay.indexOf(needle);
  if (at < 0) return [];
  const out = new Set<number>();
  for (let i = at; i < at + needle.length; i++) out.add(owner[i]);
  return [...out];
}
