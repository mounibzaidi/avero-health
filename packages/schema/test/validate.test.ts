import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BLOCKS, DISPLAY_MAP, entriesFor } from "../src/display.ts";
import { LOCATIONS } from "../src/paths.ts";
import { Fiche, type Element, type Posologie } from "../src/schema.ts";
import { validateFiche, type ValidateContext } from "../src/validate.ts";

// Fake text only (hard rule 1): no clinical content in tests.
const SRC = "source-test.pdf";
const CHECK = { by: "Relecteur de test", at: "2026-01-01" };
let n = 0;

const el = (over: Partial<Element> = {}): Element => ({
  id: `t-${++n}`,
  text: `Ligne de test ${n}`,
  type: "info",
  condition: null,
  order: null,
  source: { source_id: SRC, page: 1, quote: "Citation de test p.1" },
  translated: false,
  grade: null,
  risk: "medium",
  origin: "explicit",
  conflict_group: null,
  variant_group: null,
  missing: [],
  refs: [],
  attached_to: [],
  delai: null,
  ...over,
});

const pos = (over: Partial<Posologie> = {}): Posologie => ({
  id: `p-${++n}`,
  drug_dci: "MOLECULE TEST",
  dose: "dose de test",
  dose_max: null,
  route: "voie de test",
  administration: null,
  frequency_or_duration: "rythme de test",
  condition: null,
  risk: "high",
  source: { source_id: SRC, page: 1, quote: "Citation de test p.1" },
  translated: false,
  missing: [],
  titration: null,
  algerie: { brands: [], statut: null },
  note: null,
  checked: CHECK,
  ...over,
});

const empty = () => ({ state: "non_traité" as const, elements: [] as Element[] });
const filled = (...elements: Element[]) => ({ state: "filled" as const, elements });

type Over = { [K in keyof Fiche["sections"]]?: Partial<Fiche["sections"][K]> };

function fiche(sections: Over = {}, meta: Partial<Fiche["meta"]> = {}): Fiche {
  const f: Fiche = {
    kind: "fiche",
    meta: {
      title: "Fiche de test",
      topic_id: "topic-test",
      template: "urgence",
      audience: ["MG"],
      version: "0.1",
      status: "draft",
      reviewer: null,
      reviewed_at: null,
      siblings: [],
      sources: [{ source_id: SRC, type: "full_guideline", title: "Document de test", citation: "Auteur de test", licence: "test" }],
      excluded_by_audience: [],
      motifs: [],
      synonymes: [],
      specialite: "Spécialité de test",
      ...meta,
    },
    sections: {
      "1_essentiel": empty(),
      "2_presentation": { state: "non_traité", signes_typiques: [], formes_trompeuses: [], examen_clinique: [], criteres_diagnostiques: [], diagnostics_differentiels: [] },
      "3_champ": empty(),
      "4_gravite": { state: "non_traité", decision_initiale: empty(), signes_de_gravite: [], gestes_immediats: empty() },
      "5_conduite": { state: "non_traité", nodes: [] },
      "6_examens": empty(),
      "7_traitement": { state: "non_traité", elements: [], contre_indications: empty(), posologies: [] },
      "8_ne_pas_faire": empty(),
      "9_orientation": empty(),
      "10_surveillance": empty(),
      "11_suivi": { state: "non_traité", elements: [], conseils_patient: [] },
      "12_ordonnance": { state: "sans_objet", elements: [] },
      "13_definitions": empty(),
    },
  };
  for (const [k, v] of Object.entries(sections)) Object.assign((f.sections as Record<string, object>)[k], v);
  return f;
}

const rules = (f: unknown, ctx?: ValidateContext) => validateFiche(f, ctx).failures.map((x) => x.rule);
const warns = (f: unknown, ctx?: ValidateContext) => validateFiche(f, ctx).warnings.map((x) => x.rule);

describe("validateFiche", () => {
  it("passes a minimal well-formed fiche", () => {
    expect(validateFiche(fiche())).toEqual({ failures: [], warnings: [] });
    expect(rules(fiche({ "9_orientation": filled(el()) }))).toEqual([]);
  });

  it("refuses a v4 document and unknown fields (D1)", () => {
    expect(rules({ couverture: {}, sections: { reconnaitre: {} } })).toEqual(["format"]);
    const f = fiche() as unknown as { sections: Record<string, Record<string, unknown>> };
    f.sections["1_essentiel"].cas_particuliers = [];
    expect(rules(f)).toContain("format");
  });

  it("rule 1: no quote, no line; a local adaptation is signed by its reviewer instead (Q21)", () => {
    expect(rules(fiche({ "9_orientation": filled(el({ source: null })) }))).toEqual(["1"]);
    const local = el({ source: null, origin: "local_adaptation" });
    expect(rules(fiche({ "9_orientation": filled(local) }))).toEqual(["1"]);
    expect(rules(fiche({ "9_orientation": filled({ ...local, reviewer: "Relecteur de test" }) }))).toEqual([]);
    const other = el({ source: { source_id: "autre.pdf", page: 1, quote: "Citation de test p.1" } });
    expect(rules(fiche({ "9_orientation": filled(other) }))).toEqual(["1"]);
  });

  it("section 12 holds sourced lines only", () => {
    const local = el({ source: null, origin: "local_adaptation", reviewer: "Relecteur de test" });
    expect(rules(fiche({ "12_ordonnance": filled(local) }))).toEqual(["12"]);
  });

  it("rule 2: exam terms never in 2_presentation, warned outside 6", () => {
    const exam = el({ text: "Ligne de test ECG" });
    expect(rules(fiche({ "2_presentation": { state: "filled", signes_typiques: [exam] } }))).toEqual(["2"]);
    expect(warns(fiche({ "9_orientation": filled(el({ text: "Ligne de test ECG" })) }))).toEqual(["2"]);
    expect(warns(fiche({ "6_examens": filled(el({ text: "Ligne de test ECG" })) }))).toEqual([]);
  });

  it("rule 3: a do-not line belongs to 8 only", () => {
    expect(rules(fiche({ "9_orientation": filled(el({ text: "Ne pas faire le test B" })) }))).toEqual(["3"]);
    const ok = el({ text: "Ne pas faire le test B", risk: "high", checked: CHECK });
    expect(rules(fiche({ "8_ne_pas_faire": filled(ok) }))).toEqual([]);
  });

  it("rule 4: one id once, one text in one section", () => {
    const a = el();
    expect(rules(fiche({ "9_orientation": filled(a, { ...a, text: "Ligne de test différente" }) }))).toEqual(["4"]);
    const long = "Ligne de test identique dans deux sections";
    expect(rules(fiche({ "9_orientation": filled(el({ text: long })), "10_surveillance": filled(el({ text: long })) }))).toEqual(["4"]);
  });

  it("rule 5: filled has lines, non_traité and sans_objet have none, per sub-block too", () => {
    expect(rules(fiche({ "9_orientation": { state: "filled", elements: [] } }))).toEqual(["5"]);
    expect(rules(fiche({ "9_orientation": { state: "sans_objet", elements: [el()] } }))).toEqual(["5"]);
    const gestes = { state: "non_traité" as const, elements: [el({ risk: "high", checked: CHECK })] };
    expect(rules(fiche({ "4_gravite": { state: "filled", gestes_immediats: gestes } }))).toEqual(["5"]);
  });

  it("1_essentiel holds 3 lines at most", () => {
    expect(rules(fiche({ "1_essentiel": filled(el(), el(), el()) }))).toEqual([]);
    expect(rules(fiche({ "1_essentiel": filled(el(), el(), el(), el()) }))).toEqual(["essentiel"]);
  });

  it("a conditional line needs its condition", () => {
    expect(rules(fiche({ "9_orientation": filled(el({ type: "conditional" })) }))).toEqual(["element"]);
    expect(rules(fiche({ "9_orientation": filled(el({ type: "conditional", condition: "Si test A" })) }))).toEqual([]);
  });

  it("rule 7: doses, contraindications and do-not lines are high risk and checked one by one (Q24)", () => {
    const tr = (p: Posologie) => ({ state: "filled" as const, posologies: [p] });
    expect(rules(fiche({ "7_traitement": tr(pos()) }))).toEqual([]);
    expect(rules(fiche({ "7_traitement": tr(pos({ checked: undefined })) }))).toEqual(["7"]);
    expect(rules(fiche({ "7_traitement": tr(pos({ risk: "medium" })) }))).toEqual(["7"]);
    expect(warns(fiche({ "7_traitement": tr(pos({ missing: ["dose_max"] })) }))).toEqual(["dose"]);
    expect(rules(fiche({ "8_ne_pas_faire": filled(el({ risk: "medium" })) }))).toEqual(["7"]);
    expect(rules(fiche({ "9_orientation": filled(el({ risk: "high" })) }))).toEqual(["7"]);
  });

  it("rule 8: published needs reviewer and date", () => {
    expect(rules(fiche({}, { status: "published" }))).toEqual(["8"]);
    expect(rules(fiche({}, { status: "published", reviewer: "Relecteur de test", reviewed_at: "2026-01-01" }))).toEqual([]);
  });

  it("refs and siblings must exist and be published (D6)", () => {
    const resolve = (id: string) => ({ "fiche-test-publiee": "published", "fiche-test-brouillon": "unpublished" }) as const as Record<string, "published" | "unpublished">;
    const ctx = { resolve: (id: string) => resolve(id)[id] };
    // the stroke case: a sibling that does not exist blocks publishing
    expect(rules(fiche({}, { siblings: ["avc-thrombolyse"] }), ctx)).toEqual(["refs"]);
    expect(rules(fiche({ "7_traitement": { state: "filled", elements: [el({ refs: ["avc-thrombolyse"] })] } }), ctx)).toEqual(["refs"]);
    expect(rules(fiche({}, { siblings: ["fiche-test-brouillon"] }), ctx)).toEqual(["refs"]);
    expect(rules(fiche({}, { siblings: ["fiche-test-publiee"] }), ctx)).toEqual([]);
  });

  it("decision_initiale: always on urgence, never on pathologie (D3)", () => {
    const f = fiche();
    delete f.sections["4_gravite"].decision_initiale;
    expect(rules(f)).toEqual(["decision_initiale"]);
    expect(rules(fiche({}, { template: "pathologie" }))).toEqual(["decision_initiale"]);
    expect(rules({ ...f, meta: { ...f.meta, template: "pathologie" } })).toEqual([]);
  });

  it("attached_to points to posologies of the fiche; phase only in 9", () => {
    const p = pos();
    const tr = (e: Element) => ({ state: "filled" as const, elements: [e], posologies: [p] });
    expect(rules(fiche({ "7_traitement": tr(el({ attached_to: [p.id] })) }))).toEqual([]);
    expect(rules(fiche({ "7_traitement": tr(el({ attached_to: ["p-absente"] })) }))).toEqual(["attached_to"]);
    expect(rules(fiche({ "9_orientation": filled(el({ phase: "avant_transfert" })) }))).toEqual([]);
    expect(rules(fiche({ "10_surveillance": filled(el({ phase: "avant_transfert" })) }))).toEqual(["phase"]);
  });

  it("variant_group lines hang off the same posologie (Q22)", () => {
    const a = pos();
    const b = pos();
    const v = (to: string[]) => el({ type: "conditional", condition: "Variante de test", variant_group: "g1", attached_to: to });
    const tr = (...e: Element[]) => ({ state: "filled" as const, elements: e, posologies: [a, b] });
    expect(rules(fiche({ "7_traitement": tr(v([a.id]), v([a.id])) }))).toEqual([]);
    expect(rules(fiche({ "7_traitement": tr(v([a.id]), v([b.id])) }))).toEqual(["variant_group"]);
    expect(rules(fiche({ "7_traitement": tr(v([a.id]), v([])) }))).toEqual(["variant_group"]);
  });

  it("warns above 40 visible lines on urgence, not for collapsed sections", () => {
    const many = (k: number) => Array.from({ length: k }, () => el());
    expect(warns(fiche({ "9_orientation": filled(...many(40)) }))).toEqual([]);
    expect(warns(fiche({ "9_orientation": filled(...many(41)) }))).toEqual(["lisibilite"]);
    expect(warns(fiche({ "10_surveillance": filled(...many(41)) }))).toEqual([]);
  });

  it("warns on a brand name typed in a line and on a stale source", () => {
    const ctx = { brandNames: ["MARQUETEST"] };
    expect(warns(fiche({ "9_orientation": filled(el({ text: "Ligne de test Marquetest" })) }), ctx)).toEqual(["6"]);
    const today = new Date("2026-06-01");
    expect(warns(fiche(), { today, sourceYear: () => 2020 })).toEqual(["source"]);
    expect(warns(fiche(), { today, sourceYear: () => 2022 })).toEqual([]);
  });
});

describe("display map (FORMAT_MAPPING §2)", () => {
  it("places every element path, plus posologies", () => {
    const placed = new Set(DISPLAY_MAP.map((d) => d.path));
    for (const l of LOCATIONS) expect(placed.has(l.path)).toBe(true);
    expect(placed.has("7_traitement.posologies")).toBe(true);
  });

  it("keeps the block order and decision initiale for urgence only", () => {
    const order = DISPLAY_MAP.map((d) => BLOCKS.indexOf(d.block));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(entriesFor("pathologie").some((d) => d.block === "decision")).toBe(false);
    expect(entriesFor("urgence")[0].block).toBe("decision");
  });
});

describe("JSON Schema export", () => {
  it("exports the fiche with named definitions", () => {
    const s = z.toJSONSchema(Fiche, { io: "input" }) as { $defs: Record<string, unknown> };
    expect(Object.keys(s.$defs).sort()).toEqual(["Block", "Brand", "Checked", "Element", "Posologie", "SourceMeta", "SourceRef", "Titration"]);
  });

  it("fiche.schema.json is up to date (npm run json-schema)", () => {
    const committed = JSON.parse(readFileSync(new URL("../fiche.schema.json", import.meta.url), "utf8"));
    expect(committed).toEqual(z.toJSONSchema(Fiche, { io: "input" }));
  });
});
