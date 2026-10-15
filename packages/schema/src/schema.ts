import { z } from "zod";

/**
 * The fiche, stored in the numbered schema only (decision D1). v4 is display only (display.ts).
 * Base: the agreed fiche-protocole format and PROTOCOL SCHEMA v1. Objects are strict, so a document
 * of another shape (v4, Guideline v2) is refused instead of silently trimmed.
 *
 * `// CONFIRM Qn` marks a reading of an open question, kept as written until it is answered.
 */

export const SectionState = z.enum(["filled", "non_traité", "sans_objet"]);
export const Template = z.enum(["urgence", "pathologie"]);
export const Risk = z.enum(["high", "medium", "low"]);
export const Origin = z.enum(["explicit", "local_adaptation"]);
export const ElementType = z.enum(["action", "conditional", "info", "row"]);
export const Delai = z.enum(["immédiat", "<1h", "<24h"]);
export const Phase = z.enum(["avant_transfert", "pendant_transfert"]);

/** Page = printed page number of the document, not the PDF index. */
export const SourceRef = z.strictObject({
  source_id: z.string().min(1),
  page: z.number().int().min(1),
  page_end: z.number().int().min(1).optional(),
  quote: z.string().min(1), // verbatim
}).meta({ id: "SourceRef" });

/** A review of one risk-high line or dose (rule 7). */
export const Checked = z.strictObject({ by: z.string().min(1), at: z.string().min(1) }).meta({ id: "Checked" });

/** IDs only; labels are resolved at render. */
export const RefId = z.string().min(1); // CONFIRM Q11: allowed targets

export const Element = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1), // French
  type: ElementType,
  condition: z.string().nullable(), // required when type = conditional
  order: z.number().int().nullable(),
  timing: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  cells: z.record(z.string(), z.string()).optional(), // type = row
  /** Required when origin = explicit. A local adaptation may have none, then `reviewer` is required (Q21). */
  source: SourceRef.nullable(),
  translated: z.boolean(),
  grade: z.string().nullable(), // as written in the source
  risk: Risk,
  origin: Origin,
  reviewer: z.string().nullable().optional(), // local_adaptation: who wrote it
  conflict_group: z.string().nullable(), // lines that disagree: "Sources divergentes"
  /** Lines of one infusion switch under a dose card ("Seringue électrique" / "Sans …"); `condition` is the label (Q22). */
  variant_group: z.string().nullable().default(null),
  missing: z.array(z.string()),
  checked: Checked.optional(),
  refs: z.array(RefId).default([]),
  /** Posologie ids: overdose, antidote and dose-detail lines shown under their drug(s) (Q23). */
  attached_to: z.array(z.string().min(1)).default([]),
  delai: Delai.nullable().default(null), // the delay badge
  phase: Phase.nullable().optional(), // 9_orientation only
}).meta({ id: "Element" });

export const Block = z.strictObject({ state: SectionState, elements: z.array(Element) }).meta({ id: "Block" });

/** Every field is source text, never computed. */
export const Titration = z.strictObject({
  start: z.string().nullable(),
  step: z.string().nullable(),
  interval: z.string().nullable(),
  max: z.string().nullable(),
}).meta({ id: "Titration" });

export const AlgerieStatut = z.enum(["Enregistré", "Non renouvelé", "Retiré", "Aucune présentation enregistrée"]); // CONFIRM Q15
export const Brand = z.strictObject({ brand: z.string(), form: z.string(), dosage: z.string(), hospital: z.boolean() }).meta({ id: "Brand" });

export const Posologie = z.strictObject({
  id: z.string().min(1), // target of attached_to and refs
  drug_dci: z.string().min(1),
  dose: z.string(), // empty only when the source gives none: then "dose" is in `missing`
  dose_max: z.string().nullable(),
  route: z.string(),
  administration: z.string().nullable(),
  frequency_or_duration: z.string(),
  condition: z.string().nullable(),
  risk: Risk, // always "high" (rule 7)
  source: SourceRef,
  translated: z.boolean(),
  missing: z.array(z.string()), // dose fields the source does not give: never invented
  titration: Titration.nullable().default(null),
  /** Computed by the brand matcher from the national nomenclature, never typed by hand. */
  algerie: z.strictObject({ brands: z.array(Brand), statut: AlgerieStatut.nullable() }),
  note: z.string().nullable(), // source inconsistencies, flagged not fixed
  checked: Checked.optional(), // rule 7 review record (Q24)
}).meta({ id: "Posologie" });

export const Sections = z.strictObject({
  "1_essentiel": Block, // max 3 elements
  "2_presentation": z.strictObject({
    state: SectionState,
    signes_typiques: z.array(Element),
    formes_trompeuses: z.array(Element),
    examen_clinique: z.array(Element),
    criteres_diagnostiques: z.array(Element).default([]),
    diagnostics_differentiels: z.array(Element).default([]), // "Penser aussi à"
  }),
  "3_champ": Block,
  "4_gravite": z.strictObject({
    state: SectionState,
    decision_initiale: Block.optional(), // urgence only (D3). CONFIRM Q9 (element kind, max lines)
    signes_de_gravite: z.array(Element),
    gestes_immediats: Block,
  }),
  "5_conduite": z.strictObject({
    state: SectionState,
    nodes: z.array(z.strictObject({ node: z.string().min(1), branches: z.array(Element) })),
  }),
  "6_examens": Block,
  "7_traitement": z.strictObject({
    state: SectionState,
    elements: z.array(Element),
    contre_indications: Block,
    posologies: z.array(Posologie),
  }),
  "8_ne_pas_faire": Block,
  "9_orientation": Block,
  "10_surveillance": Block,
  /** conseils_patient: "À dire au patient"; "Revenir immédiatement si" lines are conseils with a condition (Q25). */
  "11_suivi": z.strictObject({ state: SectionState, elements: z.array(Element), conseils_patient: z.array(Element).default([]) }),
  "12_ordonnance": Block, // both templates (D3); hidden when sans_objet
  "13_definitions": Block,
});

export const SourceMeta = z.strictObject({
  source_id: z.string().min(1),
  type: z.enum(["full_guideline", "synthesis", "update_only", "product_info"]),
  title: z.string().min(1),
  citation: z.string().min(1), // who actually wrote it
  licence: z.string(),
  language: z.string().optional(),
  page_offset: z.number().int().optional(), // printed page minus PDF index
  pdf_path: z.string().nullable().optional(),
  url: z.string().nullable().optional(), // "Source originale" (Q26)
  /** The guideline version this fiche was built from: when the registry marks it replaced, the fiche is flagged. */
  year: z.number().int().optional(),
  doi: z.string().nullable().optional(), // DOI, or the URL when the guideline has none
}).meta({ id: "SourceMeta" });

export const Meta = z.strictObject({
  title: z.string().min(1),
  topic_id: z.string().min(1),
  template: Template,
  audience: z.array(z.enum(["MG", "urgences"])).min(1), // CONFIRM Q15 (list vs string)
  version: z.string(), // CONFIRM Q15
  status: z.enum(["draft", "review", "published"]),
  reviewer: z.string().nullable(),
  reviewed_at: z.string().nullable(),
  siblings: z.array(z.string()),
  sources: z.array(SourceMeta).min(1),
  excluded_by_audience: z.array(z.string()),
  quote_check: z.string().optional(), // "x/y", computed
  motifs: z.array(z.string()).default([]), // reasons for consultation (search, home)
  synonymes: z.array(z.string()).default([]), // other names, for search (Q26)
  specialite: z.string().min(1), // drives the library grouping
});

export const Fiche = z.strictObject({ kind: z.literal("fiche"), meta: Meta, sections: Sections });

/** Same sourcing rules (every content line is an Element). CONFIRM Q10 for their body fields. */
export const Score = z.strictObject({
  kind: z.literal("score"),
  id: z.string().regex(/^S-\d{3,}$/),
  meta: Meta.omit({ template: true }),
  elements: z.array(Element),
});
export const FicheTechnique = z.strictObject({
  kind: z.literal("fiche_technique"),
  id: z.string().regex(/^F-\d{3,}$/),
  meta: Meta.omit({ template: true }),
  elements: z.array(Element),
});

export type SectionState = z.infer<typeof SectionState>;
export type Template = z.infer<typeof Template>;
export type SourceRef = z.infer<typeof SourceRef>;
export type Element = z.infer<typeof Element>;
export type Block = z.infer<typeof Block>;
export type Posologie = z.infer<typeof Posologie>;
export type Sections = z.infer<typeof Sections>;
export type SourceMeta = z.infer<typeof SourceMeta>;
export type Meta = z.infer<typeof Meta>;
export type Fiche = z.infer<typeof Fiche>;
export type Score = z.infer<typeof Score>;
export type FicheTechnique = z.infer<typeof FicheTechnique>;
