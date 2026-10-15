// Made-up text only (no clinical content): fixtures for the schema and gate tests.
import { emptyProtocol, quoteKey, type Evidence, type GateContext, type Item, type Medication, type Protocol } from "../src/index.ts";

export const ev = (quote = "La ligne de test vaut 12 unités de test.", page = 3): Evidence => ({ source_id: "src-test", page, quote });

export const item = (id: string, over: Partial<Item> = {}): Item => ({
  id, text: "Ligne de test : 12 unités.", condition: null, timing: null, strength: "forte", origin: "source", basis: null,
  evidence: [ev()], refs: [], ...over,
});

export const med = (id: string, over: Partial<Medication> = {}): Medication => ({
  id, inn: "moleculetest", phase: "initiation", dose: 12, dose_unit: "mg", dose_basis: "fixe", route: "orale",
  frequency: "2 fois par jour", duration: "7 jours", max_dose: null, condition: null, adjustments: [], contraindications: [],
  alternative_group: null, prescriber: "officine", local_availability: { country: "DZ", status: "enregistre", brands: ["MARQUE TEST"] },
  strength: "forte", evidence: [ev("Test dose 12 unités twice daily for seven days.")], missing: [], ...over,
});

/** A fiche that passes the gate (with `passingContext`). */
export function passingProtocol(): Protocol {
  const p = emptyProtocol("fiche-test", "Fiche de test", "urgence");
  p.meta.status = "published";
  p.sources = [{ id: "src-test", title: "Source de test", organisation: "ORG", citation: "Test 2026", url: null, publication_date: null, page_offset: 0, accessed_at: null }];
  p.red_box.signs = [item("t-1")];
  p.assess.ask = [item("t-2", { origin: "adaptation_locale", basis: "Pratique locale de test", evidence: [] })];
  p.assess.pathway = {
    start_node_id: "n1",
    nodes: [
      { id: "n1", type: "decision", question: "Question de test ?", branches: [{ id: "b1", label: "Oui", next_node_id: "n2" }, { id: "b2", label: "Non", next_node_id: "n3" }], items: [] },
      { id: "n2", type: "action", question: null, branches: [{ id: "b1", label: "Ensuite", next_node_id: "n3" }], items: [item("t-3")] },
      { id: "n3", type: "end", question: null, branches: [], items: [] },
    ],
  };
  p.treat.medications = [med("m-1")];
  p.refer_follow.refer = [{ id: "r-1", criteria: "Critère de test", urgency: "urgent", destination: "service de test", strength: null, evidence: [ev()] }];
  p.refer_follow.follow_up = [{ id: "f-1", when: "J12", what: "Contrôle de test", evidence: [ev()] }];
  p.review = { reviewer: "Dr Test", reviewed_at: "2026-10-01", clinical_approval: true, unresolved_issues: [], change_log: [] };
  return p;
}

/** Every evidence of the fiche marked as found by the quote check. */
export function passingContext(p: Protocol, published: string[] = []): GateContext {
  const quotes: GateContext["quotes"] = {};
  const lines = [
    ...p.red_box.signs, ...p.red_box.actions, ...p.assess.ask, ...p.assess.examine, ...p.assess.tests, ...p.treat.actions,
    ...p.treat.do_not, ...p.advise, ...p.assess.pathway.nodes.flatMap((n) => n.items), ...p.treat.medications,
    ...p.refer_follow.refer, ...p.refer_follow.follow_up,
  ];
  for (const l of lines) l.evidence.forEach((_, i) => ((quotes as Record<string, { found: boolean }>)[quoteKey(l.id, i)] = { found: true }));
  return { published: new Set(published), quotes };
}
