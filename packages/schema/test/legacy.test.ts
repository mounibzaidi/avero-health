// Made-up text only: the older fiche-protocole format converted to a v1.1 draft.
import { describe, expect, it } from "vitest";

import { forStorage, fromLegacy, isLegacy, validateStructure } from "../src/index.ts";

const legacy = {
  meta: { title: "Fiche de test", topic_id: "fiche-test", template: "urgence", audience: ["MG"], sources: [{ source_id: "src", title: "Source", citation: "ORG, 2026" }] },
  sections: {
    "1_essentiel": { state: "filled", elements: [{ id: "t-1", text: "Ligne essentielle.", source: { source_id: "src", page: 3, quote: "Ligne de test 12." } }] },
    "2_presentation": { state: "filled", signes_typiques: [{ id: "t-2", text: "Signe.", source: { source_id: "src", page: 4, quote: "Signe de test." } }] },
    "5_conduite": { state: "filled", nodes: [{ node: "Situation A", branches: [{ id: "t-3", text: "Faire A.", source: { source_id: "src", page: 5, quote: "A." } }] }] },
    "7_traitement": { state: "filled", elements: [], posologies: [{ drug_dci: "moleculetest", dose: "150-300 mg", route: "orale", frequency_or_duration: "1 fois", source: { source_id: "src", page: 6, quote: "150-300 mg" }, algerie: { brands: ["MARQUE"] } }] },
  },
};

describe("fromLegacy", () => {
  it("recognises the older format and not a v1.1 fiche", () => {
    expect(isLegacy(legacy)).toBe(true);
    expect(isLegacy({ schema_version: "1.1.0", sections: {} })).toBe(false);
  });

  it("gives a valid v1.1 draft keeping each quote and page", () => {
    const p = fromLegacy(legacy, "2026-10-17");
    expect(validateStructure(p).issues).toEqual([]);
    expect(p.meta.id).toBe("fiche-test");
    expect(p.red_box.actions[0].evidence[0]).toEqual({ source_id: "src", page: 3, quote: "Ligne de test 12." });
    expect(p.red_box.signs.map((i) => i.id)).toEqual(["t-2"]);
    expect(p.assess.pathway.nodes.map((n) => n.id)).toEqual(["n0", "n1"]);
  });

  it("keeps a pathologie fiche's typical signs and essentials out of the SAMU box", () => {
    const p = fromLegacy({ ...legacy, meta: { ...legacy.meta, template: "pathologie" } });
    expect(p.red_box).toEqual({ signs: [], actions: [] });
    expect(p.assess.symptoms.map((i) => i.id)).toEqual(["t-2"]);
    expect(p.treat.actions.map((i) => i.id)).toEqual(["t-1"]);
  });

  it("reads a dose range as dose + maximum, and sends brands to the open points", () => {
    const m = fromLegacy(legacy).treat.medications[0];
    expect([m.dose, m.dose_unit, m.max_dose]).toEqual([150, "mg", "300 mg"]);
    expect(m.local_availability.brands).toEqual([]);
    expect(fromLegacy(legacy).review.unresolved_issues.join(" ")).toContain("MARQUE");
  });

  it("reads ACC/AHA classes, splits quotes cut with [...], keeps element notes", () => {
    const fiche = structuredClone(legacy) as typeof legacy & { sections: Record<string, unknown> };
    fiche.sections["8_ne_pas_faire"] = { state: "filled", elements: [{
      id: "t-9", text: "Ne pas faire X.", grade: "COR 3: Harm / LOE B-R", missing: ["unité à vérifier"],
      source: { source_id: "src", page: 7, quote: "First part of the sentence [...] second part of it" },
    }] };
    const p = fromLegacy(fiche);
    const line = p.treat.do_not[0];
    expect(line.strength).toBe("à_éviter");
    expect(line.evidence.map((e) => e.quote)).toEqual(["First part of the sentence", "second part of it"]);
    expect(p.review.unresolved_issues.join(" ")).toContain("unité à vérifier");
  });
});

describe("assess.symptoms", () => {
  it("reads a fiche stored before the field, and is left out of storage when empty", () => {
    const p = fromLegacy({ ...legacy, meta: { ...legacy.meta, template: "pathologie" } });
    const stored = forStorage({ ...p, assess: { ...p.assess, symptoms: [] } });
    expect("symptoms" in stored.assess).toBe(false);
    expect(validateStructure(stored).protocol?.assess.symptoms).toEqual([]);
    expect(forStorage(p).assess.symptoms).toHaveLength(1);
  });
});
