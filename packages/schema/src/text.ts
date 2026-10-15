/** Text helpers, ported from the old backend (scripts/dz_brands.py `fold`, factory/verify.py `normalise`). */

const stripMarks = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "");

/** Uppercase, trimmed, no accents, single spaces. */
export const fold = (s: string) => stripMarks(s.toUpperCase()).replace(/’/g, "'").split(/\s+/).filter(Boolean).join(" ");

/** Lowercase letters and digits only: two lines are "the same" when this matches. */
export const normalise = (s: string) =>
  stripMarks(s.replace(/<\/?[a-zA-Z][^<>]*>/g, " ").toLowerCase())
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/[\W_]+/g, "");

/** Rule 2: an examination's name. Whole words, on folded text. */
export const EXAM =
  /\b(ECG|ELECTROCARDIOGRAMME|TROPONINE\w*|BIOLOGIE|BIOLOGIQUES?|NFS|HEMOGRAMME|IONOGRAMME|CREATININ\w*|CRP|D-?DIMERES|GLYCEMIE|GAZ DU SANG|LACTATES?|BNP|NT-?PROBNP|RADIOGRAPHIE|SCANNER|TDM|IRM|ECHOGRAPHIE|ECHOCARDIOGRAPHIE|ANGIOSCANNER|CORONAROGRAPHIE)\b/;

/** Rule 3: a line that forbids. On folded text. */
export const DO_NOT = /^\W*(NE PAS|NE JAMAIS|NE PLUS|EVITER|PROSCRIRE|S'ABSTENIR)\b/;
