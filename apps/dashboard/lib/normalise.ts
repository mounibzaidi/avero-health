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
 * Where the quote sits in the text items (pdf.js text layer): for each item it touches, the character range
 * [start, end) of the item's own string, so only the quote is marked, not the whole run around it. Matching runs over
 * the items' concatenated normalised text, one character at a time to keep each one's place. {} if not on this page.
 */
export function quoteRanges(items: string[], quote: string): Record<number, [number, number]> {
  const needle = normaliseChars(quote);
  if (!needle) return {};
  let hay = "";
  const owner: [number, number, number][] = []; // owner[i] = [item, start, end] of the original character behind hay[i]
  items.forEach((str, idx) => {
    for (let k = 0; k < str.length; ) {
      const ch = String.fromCodePoint(str.codePointAt(k)!);
      const n = normaliseChars(ch);
      hay += n;
      for (let j = 0; j < n.length; j++) owner.push([idx, k, k + ch.length]);
      k += ch.length;
    }
  });
  const at = hay.indexOf(needle);
  if (at < 0) return {};
  const out: Record<number, [number, number]> = {};
  for (let i = at; i < at + needle.length; i++) {
    const [idx, s, e] = owner[i];
    out[idx] = out[idx] ? [Math.min(out[idx][0], s), Math.max(out[idx][1], e)] : [s, e];
  }
  return out;
}
