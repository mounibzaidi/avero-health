import { DISPLAY, DISPLAY_MAP } from "./display.ts";
import { elements, LOCATIONS, SECTION_KEYS, type ElementPath, type SectionKey } from "./paths.ts";
import { Fiche, type Element } from "./schema.ts";
import { DO_NOT, EXAM, fold, normalise } from "./text.ts";

/**
 * validateFiche(f, ctx) → { failures, warnings }. Any failure blocks publishing.
 * Ported from protocol_v1.validate (rules 1 to 8) plus the new-repo rules (refs, decision_initiale,
 * attached_to, phase, variant_group). The quote-on-page and numbers-in-quote checks need the PDF:
 * they run server side (services/api).
 */

export type Finding = { rule: string; path: string | null; element: string | null; message: string };
export type Validation = { failures: Finding[]; warnings: Finding[] };

export type ResolvedRef = "published" | "unpublished";
export type ValidateContext = {
  /** Status of another publishable object (fiche, score, fiche technique) by id; undefined = missing. */
  resolve?: (id: string) => ResolvedRef | undefined;
  /** Brand names of the national nomenclature that are not a DCI (rule 6 warning). Folded, upper case. */
  brandNames?: string[];
  /** Publication year of a source, when known (staleness warning). */
  sourceYear?: (sourceId: string) => number | undefined;
  today?: Date;
};

const ESSENTIEL_MAX = 3;
const STALE_YEARS = 5;
const HIGH_PATHS: ElementPath[] = ["7_traitement.contre_indications", "8_ne_pas_faire"];

const said = (e: Element) => [e.text, e.condition, e.timing, e.reason].filter(Boolean).join(" ");

export function validateFiche(input: unknown, ctx: ValidateContext = {}): Validation {
  const failures: Finding[] = [];
  const warnings: Finding[] = [];
  const fail = (rule: string, message: string, path: string | null = null, element: string | null = null) =>
    failures.push({ rule, path, element, message });
  const warn = (rule: string, message: string, path: string | null = null, element: string | null = null) =>
    warnings.push({ rule, path, element, message });

  // No v4 or other shape is accepted anywhere (D1).
  const raw = input as { couverture?: unknown; sections?: Record<string, unknown> } | null;
  if (raw && typeof raw === "object" && (raw.couverture !== undefined || (raw.sections && "reconnaitre" in raw.sections))) {
    fail("format", "Format v4 refusé : les fiches sont stockées dans le schéma numéroté");
    return { failures, warnings };
  }
  const parsed = Fiche.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) fail("format", issue.message, issue.path.join(".") || null);
    return { failures, warnings };
  }
  const f = parsed.data;
  const { meta, sections: S } = f;

  // Rule 8
  if (meta.status === "published" && !(meta.reviewer?.trim() && meta.reviewed_at)) fail("8", "Publié sans relecteur ni date");

  // decision_initiale: urgence only, and always there on urgence (D3)
  const decision = S["4_gravite"].decision_initiale;
  if (meta.template === "pathologie" && decision) fail("decision_initiale", "Décision initiale : fiches urgence uniquement", "4_gravite.decision_initiale");
  if (meta.template === "urgence" && !decision) fail("decision_initiale", "Décision initiale absente (fiche urgence)", "4_gravite.decision_initiale");

  // Rule 5: states, per section and per sub-block with its own state
  const count = (key: SectionKey) =>
    LOCATIONS.filter((l) => l.section === key).reduce((n, l) => n + l.get(S).length, 0) + (key === "7_traitement" ? S["7_traitement"].posologies.length : 0);
  const stateRule = (state: string, n: number, path: string) => {
    if (state === "filled" && n === 0) fail("5", "Section vide : indiquer « non traité » ou « sans objet »", path);
    if (state !== "filled" && n > 0) fail("5", `Section marquée « ${state} » mais elle a des lignes`, path);
  };
  for (const key of SECTION_KEYS) stateRule(S[key].state, count(key), key);
  for (const loc of LOCATIONS) {
    const b = loc.block?.(S);
    if (b) stateRule(b.state, b.elements.length, loc.path);
  }
  if (S["1_essentiel"].elements.length > ESSENTIEL_MAX)
    fail("essentiel", `L'essentiel : ${ESSENTIEL_MAX} lignes au maximum (${S["1_essentiel"].elements.length})`, "1_essentiel");

  const sourceIds = new Set(meta.sources.map((s) => s.source_id));
  const posologieIds = new Set(S["7_traitement"].posologies.map((p) => p.id));
  const ids = new Set<string>();
  const texts = new Map<string, SectionKey>();
  const variants = new Map<string, string[]>();
  const brands = ctx.brandNames?.length
    ? new RegExp(`(?<![A-Z0-9])(${[...ctx.brandNames].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Z0-9])`)
    : null;

  const checkId = (id: string, path: string) => {
    if (ids.has(id)) fail("4", "Identifiant en double", path, id);
    ids.add(id);
  };
  const checkRef = (id: string, path: string, element: string | null) => {
    const r = ctx.resolve?.(id);
    if (r === undefined) fail("refs", `Référence introuvable : ${id}`, path, element);
    else if (r === "unpublished") fail("refs", `Référence non publiée : ${id}`, path, element);
  };

  for (const { el: e, path, section } of elements(f)) {
    checkId(e.id, path);
    const key = normalise(e.text);
    if (key.length >= 20 && texts.has(key) && texts.get(key) !== section) fail("4", `Même ligne que dans la section ${texts.get(key)}`, path, e.id);
    if (!texts.has(key)) texts.set(key, section);
    if (e.type === "conditional" && !e.condition?.trim()) fail("element", "Ligne conditionnelle sans condition (« Si … »)", path, e.id);

    // Rule 1: no quote, no line. A local adaptation is signed by its reviewer instead (Q21).
    if (e.origin === "local_adaptation") {
      if (!e.reviewer?.trim()) fail("1", "Adaptation locale sans nom du relecteur", path, e.id);
      if (section === "12_ordonnance") fail("12", "Ordonnance type : lignes sourcées uniquement", path, e.id);
    } else if (!e.source) fail("1", "Sans source : document, page et citation obligatoires", path, e.id);
    if (e.source && !sourceIds.has(e.source.source_id)) fail("1", "La source citée n'est pas une source de la fiche", path, e.id);

    // Rules 2 and 3: what goes where
    const folded = fold(said(e));
    if (EXAM.test(folded) && section === "2_presentation") fail("2", "ECG, biologie et imagerie : section 6 uniquement", path, e.id);
    else if (EXAM.test(folded) && section !== "6_examens" && e.type !== "action") warn("2", "Résultat d'examen hors de la section 6 ?", path, e.id);
    if (DO_NOT.test(fold(e.text)) && section !== "8_ne_pas_faire") fail("3", "Ligne « ne pas faire » : section 8 uniquement", path, e.id);

    // Rule 6 and missing fields
    const brand = brands?.exec(folded);
    if (brand) warn("6", `Nom de marque dans le texte : ${brand[1]}`, path, e.id);
    if (e.missing.length) warn("dose", "Champs absents de la source : " + e.missing.join(", "), path, e.id);

    // Rule 7
    if (HIGH_PATHS.includes(path) && e.risk !== "high") fail("7", "Contre-indication ou « ne pas faire » : risque élevé obligatoire", path, e.id);
    if (e.risk === "high" && !e.checked) fail("7", "Risque élevé : à relire individuellement", path, e.id);

    // New fields
    for (const p of e.attached_to) if (!posologieIds.has(p)) fail("attached_to", `Rattaché à une posologie inconnue : ${p}`, path, e.id);
    if (e.phase != null && section !== "9_orientation") fail("phase", "Phase de transfert : section 9 uniquement", path, e.id);
    if (e.variant_group) variants.set(e.variant_group, [...(variants.get(e.variant_group) ?? []), [...e.attached_to].sort().join(",")]);
    for (const r of e.refs) checkRef(r, path, e.id);
  }

  for (const [group, attached] of variants)
    if (attached.some((a) => !a || a !== attached[0])) fail("variant_group", `Variante « ${group} » : toutes les lignes doivent être rattachées à la même posologie`, "7_traitement");

  for (const p of S["7_traitement"].posologies) {
    const path = "7_traitement.posologies";
    checkId(p.id, path);
    if (!sourceIds.has(p.source.source_id)) fail("1", "La source citée n'est pas une source de la fiche", path, p.id);
    if (!p.dose.trim() && !p.missing.includes("dose")) fail("dose", "Dose vide : l'indiquer dans « missing » si la source ne la donne pas", path, p.id);
    if (p.risk !== "high") fail("7", "Dose : risque élevé obligatoire", path, p.id);
    if (!p.checked) fail("7", "Risque élevé : à relire individuellement", path, p.id);
    if (p.missing.length) warn("dose", "Champs de dose absents de la source : " + p.missing.join(", "), path, p.id);
    const brand = brands?.exec(fold([p.dose, p.administration, p.note].filter(Boolean).join(" ")));
    if (brand) warn("6", `Nom de marque dans le texte : ${brand[1]}`, path, p.id);
  }

  for (const s of meta.siblings) checkRef(s, "meta.siblings", null);

  // Warnings: visible element count, stale sources
  const max = DISPLAY[meta.template].maxVisibleElements;
  if (max !== null) {
    const visible = DISPLAY_MAP.filter((d) => d[meta.template] === "visible");
    const counted = new Set<string>();
    let n = 0;
    for (const d of visible) {
      if (counted.has(d.path)) continue;
      counted.add(d.path);
      n += d.path === "7_traitement.posologies" ? S["7_traitement"].posologies.length : (LOCATIONS.find((l) => l.path === d.path)?.get(S).length ?? 0);
    }
    if (n > max) warn("lisibilite", `${n} lignes visibles d'emblée (maximum conseillé : ${max})`);
  }
  const year = (ctx.today ?? new Date()).getFullYear();
  for (const s of meta.sources) {
    const y = s.year ?? ctx.sourceYear?.(s.source_id);
    if (y !== undefined && year - y > STALE_YEARS) warn("source", `Source de plus de ${STALE_YEARS} ans (${y}) : ${s.title}`, "meta.sources", s.source_id);
  }

  return { failures, warnings };
}
