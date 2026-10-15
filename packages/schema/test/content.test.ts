import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { validateFiche } from "../src/validate.ts";

// The imported fiches (tools/import/import_content.py → content/fiches). No clinical text is written here.
const load = (name: string) => JSON.parse(readFileSync(new URL(`../../../content/fiches/${name}.json`, import.meta.url), "utf8"));

describe("imported content", () => {
  it("stroke reports the missing avc-thrombolyse ref and nothing else blocks it (D6)", () => {
    const stroke = load("stroke");
    const v = validateFiche(stroke, { resolve: () => undefined });
    expect(v.failures.map((f) => [f.rule, f.path, f.element, f.message])).toEqual([
      ["refs", "7_traitement.elements", "avc-028", "Référence introuvable : avc-thrombolyse"],
      ["refs", "meta.siblings", null, "Référence introuvable : avc-thrombolyse"],
    ]);
  });

  it("stroke and ACS have the expected shape", () => {
    for (const name of ["stroke", "acs"]) expect(validateFiche(load(name)).failures.filter((f) => f.rule === "format")).toEqual([]);
  });
});
