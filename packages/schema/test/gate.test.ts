import { describe, expect, it } from "vitest";

import { numbers, publicationGate, quoteKey, type Issue, type Protocol } from "../src/index.ts";
import { ev, item, passingContext, passingProtocol } from "./fixtures.ts";

const rules = (issues: Issue[]) => [...new Set(issues.map((i) => i.rule))].sort();

/** Gate a fiche changed by `change`, the quote context taken before the change unless `ctxAfter`. */
function gate(change: (p: Protocol) => void, opts: { published?: string[]; ctxAfter?: boolean } = {}) {
  const p = passingProtocol();
  let ctx = passingContext(p, opts.published);
  change(p);
  if (opts.ctxAfter) ctx = passingContext(p, opts.published);
  return publicationGate(p, ctx);
}

describe("publication gate", () => {
  it("passes a complete, sourced, approved fiche", () => {
    expect(gate(() => {})).toEqual([]);
  });

  it("fails an item without evidence that is not a local adaptation", () => {
    const issues = gate((p) => (p.red_box.signs[0].evidence = []));
    expect(issues).toContainEqual(expect.objectContaining({ item_id: "t-1", rule: "evidence" }));
  });

  it("fails a local adaptation without basis", () => {
    const issues = gate((p) => (p.assess.ask[0].basis = " "));
    expect(issues).toEqual([expect.objectContaining({ item_id: "t-2", rule: "basis" })]);
  });

  it("fails evidence on a source the fiche does not list, or without page or quote", () => {
    const issues = gate((p) => (p.red_box.signs[0].evidence = [{ source_id: "autre", page: null, quote: "" }]), { ctxAfter: true });
    expect(issues.filter((i) => i.item_id === "t-1").map((i) => i.message)).toEqual([
      expect.stringContaining("is not in the fiche's sources"),
      expect.stringContaining("page missing"),
      expect.stringContaining("quote missing"),
      expect.stringContaining("Number not in the quotes: 12"),
    ]);
  });

  it("fails a quote not found on its page, and one not checked yet", () => {
    const p = passingProtocol();
    const ctx = passingContext(p);
    const quotes = { ...ctx.quotes, [quoteKey("t-1", 0)]: { found: false, message: "absente" } };
    delete (quotes as Record<string, unknown>)[quoteKey("m-1", 0)];
    const issues = publicationGate(p, { ...ctx, quotes });
    expect(issues).toEqual([
      expect.objectContaining({ item_id: "t-1", rule: "quote", message: expect.stringContaining("not found") }),
      expect.objectContaining({ item_id: "m-1", rule: "quote", message: expect.stringContaining("not checked") }),
    ]);
  });

  it("fails a number of the text that no quote states", () => {
    const issues = gate((p) => (p.red_box.signs[0].text = "Ligne de test : 13 unités."));
    expect(issues).toEqual([{ item_id: "t-1", rule: "numbers", message: "Number not in the quotes: 13" }]);
  });

  it("fails a medication dose, frequency or duration that its quote does not state", () => {
    expect(gate((p) => (p.treat.medications[0].dose = 15))).toEqual([expect.objectContaining({ item_id: "m-1", rule: "numbers", message: expect.stringContaining("15") })]);
    expect(gate((p) => (p.treat.medications[0].duration = "8 jours"))).toEqual([expect.objectContaining({ item_id: "m-1", rule: "numbers" })]);
  });

  it("publishes a medication whose optional fields the sources do not give", () => {
    expect(gate((p) => (p.treat.medications[0].missing = ["duration", "max_dose", "contraindications"]))).toEqual([]);
  });

  it("fails a medication with missing fields, and one with an empty prescribing field not listed as missing", () => {
    const missing = gate((p) => (p.treat.medications[0].missing = ["route"]));
    expect(missing).toEqual([expect.objectContaining({ item_id: "m-1", rule: "missing", message: "Missing fields: route" })]);
    const empty = gate((p) => (p.treat.medications[0].route = null));
    expect(empty).toEqual([expect.objectContaining({ item_id: "m-1", rule: "required", message: "route missing" })]);
  });

  it("publishes a medication with no brand picked (the app lists the nomenclature), not one picked without prescriber", () => {
    expect(gate((p) => (p.treat.medications[0].local_availability = { country: "DZ", status: null, brands: [] }))).toEqual([]);
    expect(rules(gate((p) => (p.treat.medications[0].prescriber = null)))).toEqual(["availability"]);
    expect(gate((p) => {
      const m = p.treat.medications[0];
      m.local_availability = { country: "DZ", status: "aucune_presentation", brands: [] };
      m.prescriber = null;
    })).toEqual([]);
  });

  it("fails refs to unknown or unpublished IDs, passes published ones", () => {
    expect(gate((p) => (p.red_box.signs[0].refs = ["S-test"]))).toEqual([expect.objectContaining({ item_id: "t-1", rule: "refs" })]);
    expect(gate((p) => (p.red_box.signs[0].refs = ["S-test"]), { published: ["S-test"] })).toEqual([]);
  });

  it("fails without clinical approval by a named doctor", () => {
    expect(gate((p) => (p.review.clinical_approval = false))).toEqual([expect.objectContaining({ item_id: null, rule: "approval" })]);
    expect(rules(gate((p) => (p.review.reviewer = null)))).toEqual(["approval"]);
  });

  it("fails a pathway dead end", () => {
    const issues = gate((p) => (p.assess.pathway.nodes[0].branches[1].next_node_id = null));
    expect(issues).toEqual([expect.objectContaining({ item_id: "n1", rule: "pathway", message: expect.stringContaining("Dead end") })]);
  });

  it("fails duplicate IDs", () => {
    const issues = gate((p) => p.advise.push(item("t-1")), { ctxAfter: true });
    expect(rules(issues)).toEqual(["ids"]);
  });
});

describe("numbers", () => {
  it("reads values, French thousands and spelled-out numbers", () => {
    expect(numbers("1,50 mg, 07 h, 1 000 UI")).toEqual(new Set(["1.5", "7", "1000"]));
    expect(numbers("twice daily for seven days")).toEqual(new Set(["2", "7"]));
    expect(numbers("deux fois, le troisième jour")).toEqual(new Set(["2", "3"]));
    expect(numbers("one dose, un comprimé")).toEqual(new Set());
  });

  it("checks a quote in another language through number words", () => {
    const issues = gate((p) => (p.red_box.signs[0] = item("t-1", { text: "Test 2 fois par jour", evidence: [ev("test twice daily")] })), { ctxAfter: true });
    expect(issues).toEqual([]);
  });
});
