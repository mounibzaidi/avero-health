import { z } from "zod";

/**
 * Protocol Schema v1.1 (docs/protocol_schema_v1.1.md), the only fiche format. Field names and allowed values are the
 * doc's. Objects are strict: a document of another shape is refused, not trimmed.
 *
 * Drafts may have gaps (empty text, null dose, empty quote): this is the shape only. Completeness is the publication
 * gate's job (gate.ts), and the editor shows every gap as "[à compléter]".
 */

export const SCHEMA_VERSION = "1.1.0";

export const Template = z.enum(["urgence", "pathologie"]);
export const Status = z.enum(["draft", "published"]);
export const Timing = z.enum(["immediate", "same_day", "prompt", "routine"]);
export const Strength = z.enum(["forte", "modérée", "faible", "à_éviter"]);
export const Origin = z.enum(["source", "adaptation_locale"]);
export const Phase = z.enum(["initiation", "entretien", "prolongee", "unique"]);
export const DoseBasis = z.enum(["fixe", "par_kg"]);
export const Prescriber = z.enum(["officine", "hopital"]);
export const AvailabilityStatus = z.enum(["enregistre", "non_renouvele", "retire", "aucune_presentation"]);
export const NodeType = z.enum(["decision", "action", "end"]);
export const Urgency = z.enum(["urgent", "same_week", "next_appointment"]);

const Id = z.string().min(1);

/** page = printed page number; the PDF page is page + the source's page_offset. */
export const Evidence = z.strictObject({
  source_id: z.string(),
  page: z.number().int().min(1).nullable(),
  quote: z.string(), // original wording, verbatim
}).meta({ id: "Evidence" });

export const Item = z.strictObject({
  id: Id,
  text: z.string(),
  condition: z.string().nullable(),
  timing: Timing.nullable(),
  strength: Strength.nullable(),
  origin: Origin,
  basis: z.string().nullable(), // required when origin = adaptation_locale
  evidence: z.array(Evidence),
  refs: z.array(Id), // IDs of scores or other fiches, labels resolved at display
}).meta({ id: "Item" });

/** Medication fields the sources may not give; listed in `missing`, shown as "[à compléter]", never invented. */
export const MedicationField = z.enum([
  "phase", "dose", "dose_unit", "dose_basis", "route", "frequency", "duration", "max_dose", "adjustments", "contraindications", "strength",
]);

export const LocalAvailability = z.strictObject({
  country: z.string(),
  status: AvailabilityStatus.nullable(), // from the nomenclature, never typed
  brands: z.array(z.string()), // from the nomenclature only
}).meta({ id: "LocalAvailability" });

export const Medication = z.strictObject({
  id: Id,
  inn: z.string(),
  phase: Phase.nullable(),
  dose: z.number().positive().nullable(),
  dose_unit: z.string().nullable(),
  dose_basis: DoseBasis.nullable(),
  route: z.string().nullable(),
  frequency: z.string().nullable(),
  duration: z.string().nullable(),
  max_dose: z.string().nullable(),
  condition: z.string().nullable(),
  adjustments: z.array(z.string()),
  contraindications: z.array(z.string()),
  alternative_group: z.string().nullable(), // same value = interchangeable, shown as "ou"
  prescriber: Prescriber.nullable(), // from the nomenclature (OFF / HOP), never typed
  local_availability: LocalAvailability,
  strength: Strength.nullable(),
  evidence: z.array(Evidence),
  missing: z.array(MedicationField),
}).meta({ id: "Medication" });

export const Branch = z.strictObject({
  id: Id,
  label: z.string(),
  next_node_id: z.string().nullable(),
}).meta({ id: "Branch" });

export const PathwayNode = z.strictObject({
  id: Id,
  type: NodeType,
  question: z.string().nullable(),
  branches: z.array(Branch),
  items: z.array(Item),
}).meta({ id: "PathwayNode" });

export const Pathway = z.strictObject({
  start_node_id: z.string().nullable(),
  nodes: z.array(PathwayNode),
}).meta({ id: "Pathway" });

export const Referral = z.strictObject({
  id: Id,
  criteria: z.string(),
  urgency: Urgency.nullable(),
  destination: z.string().nullable(),
  strength: Strength.nullable(),
  evidence: z.array(Evidence),
}).meta({ id: "Referral" });

export const FollowUp = z.strictObject({
  id: Id,
  when: z.string(),
  what: z.string(),
  evidence: z.array(Evidence),
}).meta({ id: "FollowUp" });

/** page_offset = PDF page minus printed page (printed 1678 + offset -1625 = PDF page 53). */
export const Source = z.strictObject({
  id: Id,
  title: z.string(),
  organisation: z.string(),
  citation: z.string(),
  url: z.string().nullable(),
  publication_date: z.string().nullable(),
  page_offset: z.number().int(),
  accessed_at: z.string().nullable(),
}).meta({ id: "Source" });

export const ChangeLogEntry = z.strictObject({
  date: z.string(),
  by: z.string(),
  summary: z.string(),
}).meta({ id: "ChangeLogEntry" });

export const Review = z.strictObject({
  reviewer: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  clinical_approval: z.boolean(),
  unresolved_issues: z.array(z.string()), // conflicting sources, never silently merged
  change_log: z.array(ChangeLogEntry),
}).meta({ id: "Review" });

export const Meta = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string(),
  template: Template,
  audience: z.array(z.string()),
  country: z.string(),
  language: z.string(),
  motifs: z.array(z.string()),
  specialite: z.string(),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  status: Status,
  last_reviewed_at: z.string().nullable(),
  next_review_at: z.string().nullable(),
}).meta({ id: "Meta" });

export const Scope = z.strictObject({
  population: z.string().nullable(),
  exclusions: z.array(z.string()),
}).meta({ id: "Scope" });

export const Protocol = z.strictObject({
  schema_version: z.literal(SCHEMA_VERSION),
  meta: Meta,
  scope: Scope,
  red_box: z.strictObject({ signs: z.array(Item), actions: z.array(Item) }),
  assess: z.strictObject({ ask: z.array(Item), examine: z.array(Item), tests: z.array(Item), pathway: Pathway }),
  treat: z.strictObject({ medications: z.array(Medication), actions: z.array(Item), do_not: z.array(Item) }),
  advise: z.array(Item),
  refer_follow: z.strictObject({ refer: z.array(Referral), follow_up: z.array(FollowUp) }),
  sources: z.array(Source),
  review: Review,
}).meta({ id: "Protocol" });

export type Template = z.infer<typeof Template>;
export type Status = z.infer<typeof Status>;
export type Timing = z.infer<typeof Timing>;
export type Strength = z.infer<typeof Strength>;
export type Origin = z.infer<typeof Origin>;
export type Phase = z.infer<typeof Phase>;
export type DoseBasis = z.infer<typeof DoseBasis>;
export type Prescriber = z.infer<typeof Prescriber>;
export type AvailabilityStatus = z.infer<typeof AvailabilityStatus>;
export type NodeType = z.infer<typeof NodeType>;
export type Urgency = z.infer<typeof Urgency>;
export type Evidence = z.infer<typeof Evidence>;
export type Item = z.infer<typeof Item>;
export type MedicationField = z.infer<typeof MedicationField>;
export type LocalAvailability = z.infer<typeof LocalAvailability>;
export type Medication = z.infer<typeof Medication>;
export type Branch = z.infer<typeof Branch>;
export type PathwayNode = z.infer<typeof PathwayNode>;
export type Pathway = z.infer<typeof Pathway>;
export type Referral = z.infer<typeof Referral>;
export type FollowUp = z.infer<typeof FollowUp>;
export type Source = z.infer<typeof Source>;
export type ChangeLogEntry = z.infer<typeof ChangeLogEntry>;
export type Review = z.infer<typeof Review>;
export type Meta = z.infer<typeof Meta>;
export type Scope = z.infer<typeof Scope>;
export type Protocol = z.infer<typeof Protocol>;

/** Item lists of the fiche, in screen order, with their French label. Pathway node items are listed by `walk`. */
export const ITEM_LISTS = [
  { key: "red_box.signs", label: "Signes d'alerte", get: (p: Protocol) => p.red_box.signs },
  { key: "red_box.actions", label: "En attendant", get: (p: Protocol) => p.red_box.actions },
  { key: "assess.ask", label: "Demander", get: (p: Protocol) => p.assess.ask },
  { key: "assess.examine", label: "Examiner", get: (p: Protocol) => p.assess.examine },
  { key: "assess.tests", label: "Examens", get: (p: Protocol) => p.assess.tests },
  { key: "treat.actions", label: "Autres mesures", get: (p: Protocol) => p.treat.actions },
  { key: "treat.do_not", label: "À ne pas faire", get: (p: Protocol) => p.treat.do_not },
  { key: "advise", label: "Conseiller", get: (p: Protocol) => p.advise },
] as const;

/** Every item of the fiche, pathway node items included. */
export function allItems(p: Protocol): Item[] {
  return [...ITEM_LISTS.flatMap((l) => l.get(p)), ...p.assess.pathway.nodes.flatMap((n) => n.items)];
}

/** Every line that carries evidence: items, medications, referrals, follow-ups. */
export function evidenceLines(p: Protocol): { id: string; evidence: Evidence[] }[] {
  return [...allItems(p), ...p.treat.medications, ...p.refer_follow.refer, ...p.refer_follow.follow_up];
}

/** An empty fiche of v1.1, as the editor starts it. */
export function emptyProtocol(id: string, title: string, template: Template): Protocol {
  return {
    schema_version: SCHEMA_VERSION,
    meta: {
      id, title, template, audience: [], country: "DZ", language: "fr", motifs: [], specialite: "",
      version: "1.0.0", status: "draft", last_reviewed_at: null, next_review_at: null,
    },
    scope: { population: null, exclusions: [] },
    red_box: { signs: [], actions: [] },
    assess: { ask: [], examine: [], tests: [], pathway: { start_node_id: null, nodes: [] } },
    treat: { medications: [], actions: [], do_not: [] },
    advise: [],
    refer_follow: { refer: [], follow_up: [] },
    sources: [],
    review: { reviewer: null, reviewed_at: null, clinical_approval: false, unresolved_issues: [], change_log: [] },
  };
}
