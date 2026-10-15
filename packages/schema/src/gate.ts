import { numbersMissingFromQuotes } from "./numbers.ts";
import { pathwayProblems } from "./pathway.ts";
import { allItems, type Evidence, type Item, type Medication, type MedicationField, type Protocol } from "./schema.ts";
import type { Issue } from "./validate.ts";

/** Result of the quote check (services/api) for one evidence: is the quote on its page of the stored PDF. */
export type QuoteResult = { found: boolean; message?: string | null };

export type GateContext = {
  /** IDs a `refs` entry may point to: published fiches (and, later, published scores). */
  published: ReadonlySet<string>;
  /** Quote check results by quoteKey(line id, evidence index). A missing entry = not checked yet = not passed. */
  quotes: Readonly<Record<string, QuoteResult>>;
};

export const quoteKey = (lineId: string, index: number) => `${lineId}#${index}`;

/** Medication fields a prescription cannot do without; each must be filled or listed in `missing`. */
const PRESCRIBING_FIELDS: MedicationField[] = ["phase", "dose", "dose_unit", "dose_basis", "route", "frequency"];

const blank = (s: string | null | undefined) => !s || !s.trim();

/** The French label of a medication field, for messages and "[à compléter]". */
export const MEDICATION_FIELD_LABELS: Record<MedicationField, string> = {
  phase: "phase", dose: "dose", dose_unit: "unité", dose_basis: "base de dose", route: "voie", frequency: "fréquence",
  duration: "durée", max_dose: "dose maximale", adjustments: "adaptations", contraindications: "contre-indications", strength: "force",
};

/** The text of a line whose numbers must be in its quotes (sourcing rule 2). */
export function statedText(line: Item | Medication | { criteria: string } | { when: string; what: string }): string {
  if ("inn" in line) {
    return [line.dose != null ? String(line.dose) : null, line.frequency, line.duration, line.max_dose, line.condition, ...line.adjustments, ...line.contraindications]
      .filter(Boolean).join(" ; ");
  }
  if ("text" in line) return [line.text, line.condition].filter(Boolean).join(" ; ");
  if ("criteria" in line) return line.criteria;
  return [line.when, line.what].join(" ; ");
}

/**
 * Level 2: the publication gate (docs/protocol_schema_v1.1.md, "Publication gate" and "Sourcing rules").
 * Runs on a structurally valid Protocol; publishing is allowed only when this returns no issue.
 */
export function publicationGate(p: Protocol, ctx: GateContext): Issue[] {
  const issues: Issue[] = [];
  const add = (item_id: string | null, rule: Issue["rule"], message: string) => issues.push({ item_id, rule, message });
  const sourceIds = new Set(p.sources.map((s) => s.id));

  // IDs: unique across the fiche (branches only within their node).
  const seen = new Set<string>();
  const ids = [...allItems(p), ...p.treat.medications, ...p.assess.pathway.nodes, ...p.refer_follow.refer, ...p.refer_follow.follow_up, ...p.sources].map((x) => x.id);
  for (const id of ids) {
    if (seen.has(id)) add(id, "ids", `L'identifiant « ${id} » est utilisé plusieurs fois`);
    seen.add(id);
  }
  for (const n of p.assess.pathway.nodes) {
    const b = n.branches.map((x) => x.id);
    for (const id of new Set(b.filter((x, i) => b.indexOf(x) !== i))) add(n.id, "ids", `La branche « ${id} » apparaît plusieurs fois dans le nœud « ${n.id} »`);
  }

  // Evidence of one line: each entry complete, on a known source, its quote found on its page; every number in a quote.
  const checkEvidence = (id: string, evidence: Evidence[], stated: string) => {
    evidence.forEach((e, i) => {
      const n = i + 1;
      if (blank(e.source_id)) add(id, "evidence", `Preuve ${n} : source à choisir`);
      else if (!sourceIds.has(e.source_id)) add(id, "evidence", `Preuve ${n} : la source « ${e.source_id} » n'est pas dans les sources de la fiche`);
      if (e.page == null) add(id, "evidence", `Preuve ${n} : page à compléter`);
      if (blank(e.quote)) add(id, "evidence", `Preuve ${n} : citation à compléter`);
      else {
        const q = ctx.quotes[quoteKey(id, i)];
        if (!q) add(id, "quote", `Preuve ${n} : citation non vérifiée sur le PDF`);
        else if (!q.found) add(id, "quote", `Preuve ${n} : citation introuvable à la page indiquée${q.message ? ` (${q.message})` : ""}`);
      }
    });
    const missing = numbersMissingFromQuotes(stated, evidence.map((e) => e.quote));
    if (missing.length && evidence.length) add(id, "numbers", `Nombre absent des citations : ${missing.join(", ")}`);
    else if (missing.length) add(id, "numbers", `Nombre sans citation : ${missing.join(", ")}`);
  };

  for (const it of allItems(p)) {
    if (blank(it.text)) add(it.id, "required", "Texte à compléter");
    if (it.origin === "adaptation_locale") {
      if (blank(it.basis)) add(it.id, "basis", "Adaptation locale sans justification (basis)");
    } else if (!it.evidence.length) add(it.id, "evidence", "Aucune preuve : ajoutez une citation ou marquez l'item comme adaptation locale");
    // A local adaptation's numbers come from its basis, not from a quote; any evidence it has is still checked.
    if (it.origin === "source" || it.evidence.length) checkEvidence(it.id, it.evidence, statedText(it));
    for (const ref of it.refs) {
      if (!ctx.published.has(ref)) add(it.id, "refs", `La référence « ${ref} » n'existe pas ou n'est pas publiée`);
    }
  }

  for (const m of p.treat.medications) {
    if (blank(m.inn)) add(m.id, "required", "DCI à compléter");
    if (m.missing.length) add(m.id, "missing", `Champs manquants : ${m.missing.map((f) => MEDICATION_FIELD_LABELS[f]).join(", ")}`);
    for (const f of PRESCRIBING_FIELDS) {
      const v = m[f as keyof Medication];
      if ((v == null || (typeof v === "string" && blank(v))) && !m.missing.includes(f)) add(m.id, "required", `${MEDICATION_FIELD_LABELS[f]} à compléter`);
    }
    if (!m.local_availability.status) add(m.id, "availability", "Disponibilité en Algérie non renseignée : choisissez les marques dans la nomenclature");
    else if (m.local_availability.status !== "aucune_presentation" && !m.prescriber) add(m.id, "availability", "Prescripteur (officine ou hôpital) non renseigné");
    if (!m.evidence.length) add(m.id, "evidence", "Aucune preuve");
    checkEvidence(m.id, m.evidence, statedText(m));
  }

  for (const r of p.refer_follow.refer) {
    if (blank(r.criteria)) add(r.id, "required", "Critères à compléter");
    if (!r.urgency) add(r.id, "required", "Urgence à choisir");
    if (!r.evidence.length) add(r.id, "evidence", "Aucune preuve");
    checkEvidence(r.id, r.evidence, statedText(r));
  }

  for (const f of p.refer_follow.follow_up) {
    if (blank(f.when) || blank(f.what)) add(f.id, "required", "Quand et quoi à compléter");
    if (!f.evidence.length) add(f.id, "evidence", "Aucune preuve");
    checkEvidence(f.id, f.evidence, statedText(f));
  }

  for (const n of p.assess.pathway.nodes) {
    if (n.type === "decision" && blank(n.question)) add(n.id, "required", "Question à compléter");
    for (const b of n.branches) if (blank(b.label)) add(n.id, "required", `Libellé de la branche « ${b.id} » à compléter`);
  }
  for (const pb of pathwayProblems(p.assess.pathway)) add(pb.node_id, "pathway", pb.message);

  for (const s of p.sources) {
    if (blank(s.title) || blank(s.organisation)) add(s.id, "required", "Titre et organisation de la source à compléter");
  }

  if (!p.review.clinical_approval) add(null, "approval", "Validation clinique manquante (review.clinical_approval)");
  else if (blank(p.review.reviewer) || blank(p.review.reviewed_at)) add(null, "approval", "Validation clinique sans médecin nommé ou sans date");

  return issues;
}
