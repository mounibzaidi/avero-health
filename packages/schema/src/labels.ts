import type { AvailabilityStatus, DoseBasis, Medication, MedicationField, NodeType, Origin, Phase, Prescriber, Strength, Template, Timing, Urgency } from "./schema.ts";

/** French display labels of the schema's values, shared by the app and the dashboard. No em dashes in UI copy. */

export const TO_COMPLETE = "[à compléter]";

export const URGENCY_LABEL: Record<Urgency, string> = {
  urgent: "en urgence",
  same_week: "dans la semaine",
  next_appointment: "au prochain rendez-vous",
};

export const TIMING_LABEL: Record<Timing, string> = {
  immediate: "immédiat",
  same_day: "le jour même",
  prompt: "rapidement",
  routine: "en routine",
};

export const STRENGTH_LABEL: Record<Strength, string> = {
  forte: "forte",
  modérée: "modérée",
  faible: "faible",
  à_éviter: "à éviter",
};

export const ORIGIN_LABEL: Record<Origin, string> = { source: "source", adaptation_locale: "adaptation locale" };

export const PHASE_LABEL: Record<Phase, string> = { initiation: "initiation", entretien: "entretien", prolongee: "prolongée", unique: "dose unique" };

export const DOSE_BASIS_LABEL: Record<DoseBasis, string> = { fixe: "dose fixe", par_kg: "par kg" };

export const PRESCRIBER_LABEL: Record<Prescriber, string> = { officine: "Officine", hopital: "Hôpital" };

export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  enregistre: "enregistré",
  non_renouvele: "non renouvelé",
  retire: "retiré",
  aucune_presentation: "aucune présentation en Algérie",
};

export const NODE_TYPE_LABEL: Record<NodeType, string> = { decision: "décision", action: "action", end: "fin" };

export const TEMPLATE_LABEL: Record<Template, string> = { urgence: "urgence", pathologie: "pathologie" };

/** Screen sections, in the doc's order, with their French title. */
export const SECTION_TITLE = {
  red_box: "Signes d'alerte",
  assess: "Évaluer",
  treat: "Traiter",
  advise: "Conseiller",
  refer_follow: "Orienter et suivre",
  sources: "Sources",
  review: "Relecture",
} as const;

/** "10 mg orale, 2 fois par jour, 7 jours", with "[à compléter]" for a field the sources do not give. */
export function doseLine(m: Medication): string {
  const v = (f: MedicationField, x: string | number | null) => (m.missing.includes(f) || x === null || x === "" ? TO_COMPLETE : String(x));
  const dose = `${v("dose", m.dose)} ${v("dose_unit", m.dose_unit)}${m.dose_basis === "par_kg" ? "/kg" : ""}`;
  return [`${dose} ${v("route", m.route)}`, v("frequency", m.frequency), m.duration || m.missing.includes("duration") ? v("duration", m.duration) : null]
    .filter(Boolean).join(", ");
}
