import type { ElementPath } from "./paths.ts";
import type { Template } from "./schema.ts";

/**
 * How a stored (numbered) fiche is shown with the v4 screen blocks. Data, not screen code:
 * FORMAT_MAPPING.md §2 (final mapping, 2026-10-14).
 */

/** Screen blocks, in screen order. "decision" is urgence only. */
export const BLOCKS = [
  "decision",
  "essentiel",
  "reconnaitre",
  "etapes",
  "conduite",
  "bilans",
  "traitement",
  "a_eviter",
  "orienter",
  "suivi",
  "champ",
  "definitions",
] as const;
export type BlockId = (typeof BLOCKS)[number];

export type Visibility = "visible" | "collapsed" | null; // null: not on this template
export type DisplayPath = ElementPath | "7_traitement.posologies";

export type Component =
  | "DecisionCard" // Card; conditional elements as v2 Branches, others as Rows
  | "EssentielCard" // v2 "Priorité / L'essentiel" card, max 3 rows
  | "Recognize" // v4 Recognize sub-block
  | "Checklist" // v4 Checklist (tick on tap, long press = source)
  | "StepCards" // v2 step card per node, body = Branches / Rows
  | "Exams" // v4 Exams (clinical rows, tests, Demande de bilan)
  | "Rows" // Card + Rows
  | "Dose" // v4 dose card per posologie
  | "Openers" // amber "Si contre-indication"
  | "Prescription" // ActionButton + Prescription / Paper
  | "RedBox"
  | "Referrals"
  | "TransferCard"
  | "Definitions";

export type DisplayEntry = {
  path: DisplayPath;
  block: BlockId;
  /** Sub-block id inside the block (its label lives in the app strings). */
  sub: string;
  component: Component;
  /** "red" / "caution" sub-block tone. */
  tone?: "red" | "caution";
  urgence: Visibility;
  pathologie: Visibility;
  /** Lines of this path are only those matching (9_orientation is split by phase). */
  only?: "phase_null" | "phase_set";
};

export const DISPLAY_MAP: DisplayEntry[] = [
  { path: "4_gravite.decision_initiale", block: "decision", sub: "decision", component: "DecisionCard", urgence: "visible", pathologie: null },
  { path: "1_essentiel", block: "essentiel", sub: "essentiel", component: "EssentielCard", urgence: "visible", pathologie: "collapsed" },
  { path: "2_presentation.signes_typiques", block: "reconnaitre", sub: "symptomes", component: "Recognize", urgence: "collapsed", pathologie: "visible" },
  { path: "2_presentation.formes_trompeuses", block: "reconnaitre", sub: "formes_trompeuses", component: "Recognize", tone: "caution", urgence: "collapsed", pathologie: "visible" },
  { path: "2_presentation.criteres_diagnostiques", block: "reconnaitre", sub: "criteres", component: "Recognize", urgence: "collapsed", pathologie: "visible" },
  { path: "2_presentation.diagnostics_differentiels", block: "reconnaitre", sub: "differentiel", component: "Recognize", urgence: "collapsed", pathologie: "visible" },
  { path: "4_gravite.signes_de_gravite", block: "reconnaitre", sub: "gravite", component: "Recognize", tone: "red", urgence: "visible", pathologie: "collapsed" },
  { path: "4_gravite.gestes_immediats", block: "etapes", sub: "etapes", component: "Checklist", urgence: "visible", pathologie: "collapsed" },
  { path: "5_conduite.nodes", block: "conduite", sub: "conduite", component: "StepCards", urgence: "collapsed", pathologie: "visible" },
  { path: "2_presentation.examen_clinique", block: "bilans", sub: "examen_clinique", component: "Exams", urgence: "collapsed", pathologie: "visible" },
  { path: "6_examens", block: "bilans", sub: "examens", component: "Exams", urgence: "visible", pathologie: "collapsed" },
  { path: "7_traitement.elements", block: "traitement", sub: "indications", component: "Rows", urgence: "visible", pathologie: "visible" },
  { path: "7_traitement.posologies", block: "traitement", sub: "doses", component: "Dose", urgence: "visible", pathologie: "visible" },
  { path: "7_traitement.contre_indications", block: "traitement", sub: "contre_indications", component: "Openers", tone: "caution", urgence: "visible", pathologie: "visible" },
  { path: "12_ordonnance", block: "traitement", sub: "ordonnance", component: "Prescription", urgence: "visible", pathologie: "visible" },
  { path: "8_ne_pas_faire", block: "a_eviter", sub: "a_eviter", component: "RedBox", urgence: "visible", pathologie: "collapsed" },
  { path: "9_orientation", block: "orienter", sub: "referrals", component: "Referrals", only: "phase_null", urgence: "visible", pathologie: "collapsed" },
  { path: "9_orientation", block: "orienter", sub: "transfert", component: "TransferCard", only: "phase_set", urgence: "visible", pathologie: "collapsed" },
  { path: "10_surveillance", block: "suivi", sub: "surveillance", component: "Rows", urgence: "collapsed", pathologie: "collapsed" },
  { path: "11_suivi.elements", block: "suivi", sub: "suivi", component: "Rows", urgence: "collapsed", pathologie: "collapsed" },
  { path: "11_suivi.conseils_patient", block: "suivi", sub: "conseils_patient", component: "Rows", urgence: "collapsed", pathologie: "collapsed" },
  { path: "3_champ", block: "champ", sub: "champ", component: "Rows", urgence: "collapsed", pathologie: "collapsed" },
  { path: "13_definitions", block: "definitions", sub: "definitions", component: "Definitions", urgence: "collapsed", pathologie: "collapsed" },
];

export const DISPLAY = {
  urgence: { maxVisibleElements: 40 as number | null },
  pathologie: { maxVisibleElements: null as number | null }, // CONFIRM Q13
  /** Lists show this many items, then "Voir plus (N)". A display rule, never a data limit. Transfer criteria are always all shown. */
  listCap: 4,
  /** sans_objet: hidden, no jump chip. non_traité: amber card "Non traité par la source". */
  state: { sans_objet: "hidden", non_traité: "not_covered" },
} as const;

export const entriesFor = (template: Template) => DISPLAY_MAP.filter((e) => e[template] !== null);
