import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { emptyProtocol, protocolJsonSchema, publicationGate, validateStructure } from "../src/index.ts";
import { passingProtocol } from "./fixtures.ts";

describe("structural validation", () => {
  it("accepts an empty fiche and a complete one", () => {
    expect(validateStructure(emptyProtocol("a-b", "Titre", "pathologie")).issues).toEqual([]);
    expect(validateStructure(passingProtocol()).issues).toEqual([]);
  });

  it("refuses a value outside the doc's enums, and names the line", () => {
    const p = passingProtocol() as unknown as { red_box: { signs: { timing: string }[] } };
    p.red_box.signs[0].timing = "asap";
    const { protocol, issues } = validateStructure(p);
    expect(protocol).toBeNull();
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ item_id: "t-1", rule: "structure" });
    expect(issues[0].message).toContain("red_box.signs.0.timing");
  });

  it("refuses unknown fields and another schema version (strict, no silent trim)", () => {
    const extra = { ...passingProtocol(), sections: {} };
    expect(validateStructure(extra).issues[0].message).toMatch(/sections/);
    expect(validateStructure({ ...passingProtocol(), schema_version: "1.0.0" }).issues).toHaveLength(1);
  });

  it("refuses a medication with a missing field name that is not a medication field", () => {
    const p = passingProtocol() as unknown as { treat: { medications: { missing: string[] }[] } };
    p.treat.medications[0].missing = ["couleur"];
    expect(validateStructure(p).issues[0]).toMatchObject({ item_id: "m-1", rule: "structure" });
  });

});

describe("seed fiche content/fiches/embolie-pulmonaire.json", () => {
  const seed = JSON.parse(readFileSync(new URL("../../../content/fiches/embolie-pulmonaire.json", import.meta.url), "utf8"));

  it("is a structurally valid draft", () => {
    expect(validateStructure(seed).issues).toEqual([]);
    expect(seed.meta.status).toBe("draft");
  });

  it("is not publishable: no quote, missing fields, no approval", () => {
    const rules = new Set(publicationGate(validateStructure(seed).protocol!, { published: new Set(), quotes: {} }).map((i) => i.rule));
    expect([...rules].sort()).toEqual(["approval", "evidence", "missing", "numbers"]);
  });
});

describe("JSON Schema", () => {
  it("is generated from Zod and protocol.schema.json is up to date", () => {
    const file = JSON.parse(readFileSync(new URL("../protocol.schema.json", import.meta.url), "utf8"));
    expect(file).toEqual(JSON.parse(JSON.stringify(protocolJsonSchema())));
    expect(file.$ref).toBe("#/$defs/Protocol");
    expect(Object.keys(file.$defs)).toEqual(expect.arrayContaining(["Item", "Medication", "PathwayNode", "Referral", "FollowUp", "Source", "Review"]));
  });
});
