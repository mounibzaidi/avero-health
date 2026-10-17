/** Shared types and targets of the manual fiche editor (generation/[id]): a passage of the guideline, where a line
 * goes, and the checked proposal the API returns (services/api/app/fichegen/manual.py). */

/** One passage of the guideline: its printed page, the exact text, the drug of its dose-table row. */
export interface Part { page: number; text: string; drug?: string | null }
/** Where a new line goes: a section's list, a 5_conduite node (index, or a new one with its label), or the doses. */
export interface Target { section: string; place: string; node?: number; node_label?: string }
export interface Proposal {
  line: Record<string, unknown> & { source: { page: number; quote: string } };
  target: Target; quote_status: "pdf" | "parsed" | "failed"; part_status: string[]; grade_source: "page" | "model" | null;
  placement: { section: string; place: string; why: string } | null;
  duplicate: { id: string | null; section: string; text: string } | null;
  problems: string[];
  nomenclature: { dci: string; brands: number; registered: number; statut: string | null } | null;
}

export const SECTION_LABEL: Record<string, string> = {
  "1_essentiel": "Essentiel", "2_presentation": "Présentation", "3_champ": "Champ", "4_gravite": "Gravité", "5_conduite": "Conduite à tenir",
  "6_examens": "Examens", "7_traitement": "Traitement", "8_ne_pas_faire": "Ne pas faire", "9_orientation": "Orientation",
  "10_surveillance": "Surveillance", "11_suivi": "Suivi", "12_ordonnance": "Ordonnance", "13_definitions": "Définitions",
};
export const SUB_LABEL: Record<string, string> = {
  elements: "", signes_typiques: "Signes typiques", formes_trompeuses: "Formes trompeuses", examen_clinique: "Examen clinique",
  signes_de_gravite: "Signes de gravité", gestes_immediats: "Gestes immédiats", contre_indications: "Contre-indications", posologies: "Posologies",
};

/** Number keys: the most-used targets. */
export const KEYS: { key: string; label: string; target: Target }[] = [
  { key: "1", label: "Essentiel", target: { section: "1_essentiel", place: "elements" } },
  { key: "2", label: "Signes", target: { section: "2_presentation", place: "signes_typiques" } },
  { key: "3", label: "Gravité", target: { section: "4_gravite", place: "signes_de_gravite" } },
  { key: "4", label: "Conduite", target: { section: "5_conduite", place: "node" } },
  { key: "5", label: "Examens", target: { section: "6_examens", place: "elements" } },
  { key: "6", label: "Traitement", target: { section: "7_traitement", place: "elements" } },
  { key: "7", label: "Posologie", target: { section: "7_traitement", place: "posologies" } },
  { key: "8", label: "Ne pas faire", target: { section: "8_ne_pas_faire", place: "elements" } },
  { key: "9", label: "Orientation", target: { section: "9_orientation", place: "elements" } },
];

/** Every place a line can go, by section, for the "+ Ajouter" menus. */
export const PLACES: Record<string, string[]> = {
  "1_essentiel": ["elements"], "2_presentation": ["signes_typiques", "formes_trompeuses", "examen_clinique"], "3_champ": ["elements"],
  "4_gravite": ["signes_de_gravite", "gestes_immediats"], "5_conduite": ["node"], "6_examens": ["elements"],
  "7_traitement": ["elements", "posologies", "contre_indications"], "8_ne_pas_faire": ["elements"], "9_orientation": ["elements"],
  "10_surveillance": ["elements"], "11_suivi": ["elements"], "13_definitions": ["elements"],
};

export const tkey = (t: Target) => `${t.section}|${t.place}`;
export const targetLabel = (t: Target) =>
  `${SECTION_LABEL[t.section] ?? t.section}${SUB_LABEL[t.place] ? ` › ${SUB_LABEL[t.place]}` : t.place === "node" && t.node_label ? ` › ${t.node_label}` : ""}`;
