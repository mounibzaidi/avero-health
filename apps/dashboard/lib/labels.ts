import type { AvailabilityStatus, DoseBasis, NodeType, Origin, Phase, Prescriber, Strength, Template, Timing, Urgency } from "@avero/schema";

export const dateFr = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
/** A DOI or doi.org link, as one comparable key ("10.1016/j.jacc.2025.11.005"). */
export const doiKey = (x: string) => x.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim();

// English labels of the schema's values for the dashboard (the app keeps the schema's French ones, @avero/schema
// labels.ts). The fiche's own content stays French.

export const TO_COMPLETE = "[to fill]";
export const URGENCY_LABEL: Record<Urgency, string> = { urgent: "urgent", same_week: "within the week", next_appointment: "at the next appointment" };
export const TIMING_LABEL: Record<Timing, string> = { immediate: "immediate", same_day: "same day", prompt: "promptly", routine: "routine" };
export const STRENGTH_LABEL: Record<Strength, string> = { forte: "strong", modérée: "moderate", faible: "weak", à_éviter: "avoid" };
export const ORIGIN_LABEL: Record<Origin, string> = { source: "source", adaptation_locale: "local adaptation" };
export const PHASE_LABEL: Record<Phase, string> = { initiation: "initiation", entretien: "maintenance", prolongee: "extended", unique: "single dose" };
export const DOSE_BASIS_LABEL: Record<DoseBasis, string> = { fixe: "fixed dose", par_kg: "per kg" };
export const PRESCRIBER_LABEL: Record<Prescriber, string> = { officine: "Pharmacy", hopital: "Hospital" };
export const AVAILABILITY_LABEL: Record<AvailabilityStatus, string> = {
  enregistre: "registered", non_renouvele: "not renewed", retire: "withdrawn", aucune_presentation: "no presentation in Algeria",
};
export const NODE_TYPE_LABEL: Record<NodeType, string> = { decision: "decision", action: "action", end: "end" };
export const TEMPLATE_LABEL: Record<Template, string> = { urgence: "emergency", pathologie: "condition" };
export const SECTION_TITLE = {
  red_box: "Red flags", assess: "Assess", treat: "Treat", advise: "Advise", refer_follow: "Refer and follow up", sources: "Sources", review: "Review",
} as const;
