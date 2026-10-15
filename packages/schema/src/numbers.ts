/**
 * Numbers as values, for sourcing rule 2 (every number of a line is in its quote). Ported from the API's verify.py:
 * "1,5" == "1.5", "07" == "7", "1 000" == "1000", and spelled-out numbers count ("deux", "twice", "seventh").
 * Not "un/une/one/first/premier/second": they are also articles, pronouns or units, so a stray "1" would pass.
 */

const FR = "deux trois quatre cinq six sept huit neuf dix onze douze".split(" ");
const EN = "two three four five six seven eight nine ten eleven twelve".split(" ");
const EN_ORDINALS = "third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth".split(" ");

const WORDS: Record<string, string> = { once: "1", twice: "2", thrice: "3" };
FR.forEach((w, i) => {
  WORDS[w] = String(i + 2);
  const stem = w.endsWith("e") ? w.slice(0, -1) : w.replace("neuf", "neuv").replace("cinq", "cinqu");
  WORDS[stem + "ieme"] = String(i + 2);
});
EN.forEach((w, i) => (WORDS[w] = String(i + 2)));
EN_ORDINALS.forEach((w, i) => (WORDS[w] = String(i + 3)));

const WORD_RE = new RegExp(`\\b(${Object.keys(WORDS).sort((a, b) => b.length - a.length).join("|")})s?\\b`, "g");
const NUM_RE = /\d+(?:[.,]\d+)?/g;
// A French thousands space ("1 000"), plain, non-breaking, narrow or thin; only before exactly 3 digits.
const THOUSANDS_RE = /(?<=\d)[    ](?=\d{3}(?!\d))/g;

function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** "1,50" -> "1.5", "07" -> "7". */
export function numberValue(n: string): string {
  const [whole, frac = ""] = n.replace(",", ".").split(".");
  const w = whole.replace(/^0+/, "") || "0";
  const f = frac.replace(/0+$/, "");
  return f ? `${w}.${f}` : w;
}

/** The set of number values a text states, digits and words. */
export function numbers(text: string): Set<string> {
  const t = text.replace(/\*\*/g, "").replace(THOUSANDS_RE, "");
  const out = new Set<string>();
  for (const m of t.matchAll(NUM_RE)) out.add(numberValue(m[0]));
  for (const m of fold(t).matchAll(WORD_RE)) out.add(WORDS[m[1]]);
  return out;
}

/** Numbers of `text` that none of the quotes state, sorted. */
export function numbersMissingFromQuotes(text: string, quotes: string[]): string[] {
  const quoted = new Set(quotes.flatMap((q) => [...numbers(q)]));
  return [...numbers(text)].filter((n) => !quoted.has(n)).sort((a, b) => Number(a) - Number(b));
}
