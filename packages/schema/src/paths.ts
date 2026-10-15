import type { Block, Element, Fiche, Sections, SectionState } from "./schema.ts";

export type SectionKey = keyof Sections;

/** Every list of elements in a fiche, by its path ("4_gravite.decision_initiale", "5_conduite.nodes"). */
export type ElementPath =
  | "1_essentiel"
  | "2_presentation.signes_typiques"
  | "2_presentation.formes_trompeuses"
  | "2_presentation.examen_clinique"
  | "2_presentation.criteres_diagnostiques"
  | "2_presentation.diagnostics_differentiels"
  | "3_champ"
  | "4_gravite.decision_initiale"
  | "4_gravite.signes_de_gravite"
  | "4_gravite.gestes_immediats"
  | "5_conduite.nodes"
  | "6_examens"
  | "7_traitement.elements"
  | "7_traitement.contre_indications"
  | "8_ne_pas_faire"
  | "9_orientation"
  | "10_surveillance"
  | "11_suivi.elements"
  | "11_suivi.conseils_patient"
  | "12_ordonnance"
  | "13_definitions";

type Loc = {
  path: ElementPath;
  section: SectionKey;
  /** The elements at this path. */
  get: (s: Sections) => Element[];
  /** A sub-block with its own state (gestes immédiats, contre-indications, décision initiale). */
  block?: (s: Sections) => Block | undefined;
};

const own = (block: (s: Sections) => Block | undefined) => ({ block, get: (s: Sections) => block(s)?.elements ?? [] });

export const LOCATIONS: Loc[] = [
  { path: "1_essentiel", section: "1_essentiel", get: (s) => s["1_essentiel"].elements },
  { path: "2_presentation.signes_typiques", section: "2_presentation", get: (s) => s["2_presentation"].signes_typiques },
  { path: "2_presentation.formes_trompeuses", section: "2_presentation", get: (s) => s["2_presentation"].formes_trompeuses },
  { path: "2_presentation.examen_clinique", section: "2_presentation", get: (s) => s["2_presentation"].examen_clinique },
  { path: "2_presentation.criteres_diagnostiques", section: "2_presentation", get: (s) => s["2_presentation"].criteres_diagnostiques },
  { path: "2_presentation.diagnostics_differentiels", section: "2_presentation", get: (s) => s["2_presentation"].diagnostics_differentiels },
  { path: "3_champ", section: "3_champ", get: (s) => s["3_champ"].elements },
  { path: "4_gravite.decision_initiale", section: "4_gravite", ...own((s) => s["4_gravite"].decision_initiale) },
  { path: "4_gravite.signes_de_gravite", section: "4_gravite", get: (s) => s["4_gravite"].signes_de_gravite },
  { path: "4_gravite.gestes_immediats", section: "4_gravite", ...own((s) => s["4_gravite"].gestes_immediats) },
  { path: "5_conduite.nodes", section: "5_conduite", get: (s) => s["5_conduite"].nodes.flatMap((n) => n.branches) },
  { path: "6_examens", section: "6_examens", get: (s) => s["6_examens"].elements },
  { path: "7_traitement.elements", section: "7_traitement", get: (s) => s["7_traitement"].elements },
  { path: "7_traitement.contre_indications", section: "7_traitement", ...own((s) => s["7_traitement"].contre_indications) },
  { path: "8_ne_pas_faire", section: "8_ne_pas_faire", get: (s) => s["8_ne_pas_faire"].elements },
  { path: "9_orientation", section: "9_orientation", get: (s) => s["9_orientation"].elements },
  { path: "10_surveillance", section: "10_surveillance", get: (s) => s["10_surveillance"].elements },
  { path: "11_suivi.elements", section: "11_suivi", get: (s) => s["11_suivi"].elements },
  { path: "11_suivi.conseils_patient", section: "11_suivi", get: (s) => s["11_suivi"].conseils_patient },
  { path: "12_ordonnance", section: "12_ordonnance", get: (s) => s["12_ordonnance"].elements },
  { path: "13_definitions", section: "13_definitions", get: (s) => s["13_definitions"].elements },
];

export const SECTION_KEYS = Object.keys({
  "1_essentiel": 0, "2_presentation": 0, "3_champ": 0, "4_gravite": 0, "5_conduite": 0, "6_examens": 0, "7_traitement": 0,
  "8_ne_pas_faire": 0, "9_orientation": 0, "10_surveillance": 0, "11_suivi": 0, "12_ordonnance": 0, "13_definitions": 0,
} satisfies Record<SectionKey, 0>) as SectionKey[];

export const sectionState = (s: Sections, key: SectionKey): SectionState => s[key].state;

/** Every element of the fiche with where it is. */
export function* elements(f: Fiche): Generator<{ el: Element; path: ElementPath; section: SectionKey }> {
  for (const loc of LOCATIONS) for (const el of loc.get(f.sections)) yield { el, path: loc.path, section: loc.section };
}
