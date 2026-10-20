import type { Evidence, Item, Medication, Protocol, Referral, FollowUp, Source, Strength } from "./schema.ts";
import { emptyProtocol } from "./schema.ts";

/**
 * The older "fiche-protocole" format (meta.topic_id, numbered sections 1_essentiel ... 13_definitions) converted to a
 * v1.1 draft. Every line keeps its text, condition and verbatim quote with its page; nothing is invented: a dose that
 * does not read as one number goes to `missing`, brands (which must come from the nomenclature) go to the review's
 * open points. The result is a draft for the editor: the publication gate shows what is left to complete.
 */

type Legacy = { meta?: Record<string, unknown>; sections?: Record<string, unknown> };
type Element = {
  id?: string; text?: string; condition?: string | null; grade?: string | null; origin?: string; reviewer?: string; missing?: unknown[];
  source?: { source_id?: string; page?: number | null; quote?: string } | null;
};

/** Is this the older fiche-protocole format? */
export function isLegacy(raw: unknown): raw is Legacy {
  const r = raw as Legacy;
  return !!r && typeof r === "object" && !!r.sections && typeof r.sections === "object" && !("schema_version" in r)
    && Object.keys(r.sections).some((k) => /^\d+_/.test(k));
}

const slug = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fiche";
const arr = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : {});

function strength(grade: string | null | undefined): Strength | null {
  // ESC classes (I, IIa, IIb, III) and ACC/AHA classes of recommendation ("COR 1 / LOE B-R", "COR 3: Harm")
  const cor = (grade ?? "").match(/\bCOR\s*(1|2a|2b|3)\b/i);
  if (cor) return ({ "1": "forte", "2a": "modérée", "2b": "faible", "3": "à_éviter" } as const)[cor[1].toLowerCase() as "1" | "2a" | "2b" | "3"];
  const g = (grade ?? "").trim();
  if (/^III\b/.test(g)) return "à_éviter";
  if (/^IIb\b/i.test(g)) return "faible";
  if (/^IIa\b/i.test(g)) return "modérée";
  if (/^I\b/.test(g)) return "forte";
  return null;
}

/** Convert; throws when the input is not the older format. */
export function fromLegacy(raw: unknown, today = new Date().toISOString().slice(0, 10)): Protocol {
  if (!isLegacy(raw)) throw new Error("Ce JSON n'est ni une fiche v1.1 ni une fiche de l'ancien format");
  const meta = obj(raw.meta);
  const secs = obj(raw.sections);
  const title = String(meta.title ?? "");
  const template = meta.template === "pathologie" ? "pathologie" : "urgence";
  const p = emptyProtocol(slug(String(meta.topic_id ?? meta.id ?? title)), title, template);
  const ids = new Set<string>();
  const open: string[] = [];
  let n = 0;
  const uid = (id: string | undefined) => {
    let out = (id ?? "").trim() || `l-${++n}`;
    while (ids.has(out)) out = `${out}-${++n}`;
    ids.add(out);
    return out;
  };

  // sources: a page offset of the older pipeline (printed = PDF page + offset) becomes v1.1's (PDF = printed + offset)
  const offsets = new Map<string, number>();
  p.sources = arr<Record<string, unknown>>(meta.sources).map((s): Source => {
    const off = typeof s.page_offset === "number" ? s.page_offset : 0;
    offsets.set(String(s.source_id ?? ""), off);
    const citation = String(s.citation ?? "");
    return {
      id: String(s.source_id ?? ""), title: String(s.title ?? ""), organisation: String(s.organisation ?? citation.split(/[,.;]/)[0] ?? "").trim(),
      citation, url: (s.url as string) ?? null, publication_date: null, page_offset: -off, accessed_at: null,
    };
  });
  // a quote cut with "[...]" is not one string on the page: each piece is checked as its own quote
  const evidence = (e: Element): Evidence[] => {
    const q = e.source?.quote?.trim();
    if (!q || !e.source) return [];
    const page = e.source.page != null ? e.source.page + (offsets.get(e.source.source_id ?? "") ?? 0) : null;
    const pieces = q.split(/\s*\[\s*(?:\.\.\.|…)\s*\]\s*/).map((x) => x.trim()).filter((x) => x.length >= 12);
    return (pieces.length ? pieces : [q]).map((quote) => ({ source_id: e.source!.source_id ?? "", page, quote }));
  };
  // what the older format noted in an element's "missing" (unit doubts, things to check) goes to the open points
  const notes = (e: Element) => {
    for (const m of arr<unknown>(e.missing)) if (typeof m === "string" && m.trim()) open.push(`${e.id ?? e.text?.slice(0, 40)} : ${m.trim()}`);
  };
  const item = (e: Element): Item => {
    notes(e);
    const local = e.origin === "local_adaptation";
    return {
      id: uid(e.id), text: e.text ?? "", condition: e.condition ?? null, timing: null, strength: strength(e.grade),
      origin: local ? "adaptation_locale" : "source", basis: local ? `Adaptation locale de la fiche d'origine${e.reviewer ? `, relue par ${e.reviewer}` : ""}` : null,
      evidence: evidence(e), refs: [],
    };
  };
  const els = (x: unknown): Element[] => (Array.isArray(x) ? (x as Element[]) : arr<Element>(obj(x).elements));
  const items = (...xs: unknown[]) => xs.flatMap((x) => els(x)).filter((e) => (e.text ?? "").trim()).map(item);

  const s2 = obj(secs["2_presentation"]);
  const s4 = obj(secs["4_gravite"]);
  const s7 = obj(secs["7_traitement"]);
  const s11 = obj(secs["11_suivi"]);
  // in an emergency the typical signs are reasons to call the SAMU; in a pathologie fiche only 4_gravite is
  const urgent = template === "urgence";
  p.red_box.actions = items(urgent && secs["1_essentiel"], s4.gestes_immediats);
  p.red_box.signs = items(urgent && s2.signes_typiques, urgent && s2.formes_trompeuses, s4.signes_de_gravite);
  p.assess.symptoms = items(!urgent && s2.signes_typiques, !urgent && s2.formes_trompeuses);
  // the diagnostic criteria, and the tests the older format wrote as "Diagnostic : ...", confirm the diagnosis
  const isDiag = (e: Element) => /^diagnostic\s*:/i.test((e.text ?? "").trim());
  const tests = els(secs["6_examens"]);
  p.assess.diagnosis = items(s2.criteres_diagnostiques, tests.filter(isDiag));
  p.assess.examine = items(s2.examen_clinique, s2.diagnostics_differentiels);
  p.assess.ask = items(s4.decision_initiale);
  p.assess.tests = items(tests.filter((e) => !isDiag(e)));
  p.treat.actions = items(!urgent && secs["1_essentiel"], s7.elements, secs["10_surveillance"]);
  p.treat.do_not = items(secs["8_ne_pas_faire"], s7.contre_indications);
  p.advise = items(s11.conseils_patient);
  const scope = els(secs["3_champ"]).map((e) => e.text).filter(Boolean);
  p.scope = { population: scope.length ? scope.join(" ; ") : null, exclusions: arr<string>(meta.excluded_by_audience) };
  p.meta = { ...p.meta, audience: arr<string>(meta.audience), motifs: arr<string>(meta.motifs), specialite: String(meta.specialite ?? "") };

  // decision nodes: one end node per situation, reached from a single question
  const nodes = arr<{ node?: string; branches?: Element[] }>(obj(secs["5_conduite"]).nodes).filter((x) => arr(x.branches).length);
  if (nodes.length) {
    p.assess.pathway = {
      start_node_id: "n0",
      nodes: [
        { id: "n0", type: "decision", question: "Quelle situation ?", items: [], branches: nodes.map((x, i) => ({ id: `n0-b${i + 1}`, label: x.node ?? `Situation ${i + 1}`, next_node_id: `n${i + 1}` })) },
        ...nodes.map((x, i) => ({ id: `n${i + 1}`, type: "end" as const, question: x.node ?? null, branches: [], items: items(x.branches) })),
      ],
    };
  }

  p.refer_follow.refer = els(secs["9_orientation"]).filter((e) => (e.text ?? "").trim()).map((e): Referral => ({
    id: uid(e.id), criteria: [e.condition, e.text].filter(Boolean).join(" : "), urgency: null, destination: null, strength: strength(e.grade), evidence: evidence(e),
  }));
  p.refer_follow.follow_up = els(s11.elements).filter((e) => (e.text ?? "").trim()).map((e): FollowUp => ({
    id: uid(e.id), when: e.condition ?? "Suivi", what: e.text ?? "", evidence: evidence(e),
  }));

  // doses: one number and its unit when the text says so plainly; anything else is left to complete
  p.treat.medications = arr<Record<string, unknown>>(s7.posologies).map((d): Medication => {
    const doseText = String(d.dose ?? "");
    const m = doseText.match(/^\D*?(\d+(?:[.,]\d+)?)\s*(?:[-–à]\s*(\d+(?:[.,]\d+)?))?\s*(mg|g|µg|mcg|UI|U|mL|ml|mmol|mEq)\b/i);
    const dose = m ? Number(m[1].replace(",", ".")) : null;
    const missing = new Set<Medication["missing"][number]>(["phase"]);
    if (dose === null) missing.add("dose").add("dose_unit");
    const perKg = /\/\s*kg/i.test(doseText);
    if (!perKg && dose !== null && !/\bfixe\b/.test(doseText)) missing.add("dose_basis");
    if (!String(d.route ?? "").trim()) missing.add("route");
    if (!String(d.frequency_or_duration ?? "").trim()) missing.add("frequency");
    const algerie = obj(d.algerie);
    const brands = arr<Record<string, unknown> | string>(algerie.brands).map((b) => (typeof b === "string" ? b : String(b.brand ?? ""))).filter(Boolean);
    if (brands.length) open.push(`${d.drug_dci} : marques de la fiche d'origine (${brands.join(", ")}) à choisir dans la nomenclature`);
    // a note kept unless it only says the nomenclature was not checked (the editor's brand picker does that)
    const note = String(d.note ?? "").replace(/\s*Nomenclature algérienne non consultée[^.]*\.?/gi, "").trim();
    if (note) open.push(`${d.drug_dci} : ${note}`);
    for (const m of arr<unknown>(d.missing)) if (typeof m === "string" && m.trim() && !/^[a-z_]+$/.test(m)) open.push(`${d.drug_dci} : ${m.trim()}`);
    if (doseText && m?.[2] === undefined && dose !== null && doseText.replace(m![0], "").trim()) open.push(`${d.drug_dci} : dose d'origine « ${doseText} » à vérifier`);
    return {
      id: uid(String(d.id ?? `med-${slug(String(d.drug_dci ?? "dci"))}`)), inn: String(d.drug_dci ?? ""), phase: null, dose, dose_unit: m ? m[3] : null,
      dose_basis: perKg ? "par_kg" : null, route: String(d.route ?? "") || null, frequency: String(d.frequency_or_duration ?? "") || null,
      duration: null, max_dose: m?.[2] ? `${m[2]} ${m[3]}` : (d.dose_max as string) ?? null, condition: (d.condition as string) ?? null,
      adjustments: [], contraindications: [], alternative_group: null, prescriber: null,
      local_availability: { country: "DZ", status: null, brands: [] }, strength: null, evidence: evidence(d as Element), missing: [...missing],
    };
  });

  p.review = {
    reviewer: null, reviewed_at: null, clinical_approval: false, unresolved_issues: open,
    change_log: [{ date: today, by: "import", summary: "Converti depuis l'ancien format (fiche-protocole) : à relire, marques à choisir, doses à vérifier." }],
  };
  return p;
}
