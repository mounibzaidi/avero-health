/** Validates every fiche in content/fiches with validateFiche and writes content/fiches/validation-report.txt. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

import { validateFiche, type Finding, type ResolvedRef } from "../src/validate.ts";

const DIR = new URL("../../../../content/fiches/", import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith(".json")).sort();
const fiches = files.map((f) => ({ file: f, data: JSON.parse(readFileSync(new URL(f, DIR), "utf8")) }));

// Refs resolve against the imported fiches only: no score, fiche technique or other fiche exists yet.
const known = new Map<string, ResolvedRef>(fiches.map(({ data }) => [data.meta?.topic_id, data.meta?.status === "published" ? "published" : "unpublished"]));
const resolve = (id: string) => known.get(id);

const line = (f: Finding) => `   ${f.rule.padEnd(16)} ${(f.path ?? "").padEnd(36)} ${(f.element ?? "").padEnd(14)} ${f.message}`;
const out = ["VALIDATION REPORT (packages/schema validateFiche)", ""];
let blocked = 0;
for (const { file, data } of fiches) {
  const v = validateFiche(data, { resolve });
  if (v.failures.length) blocked++;
  const byRule = (xs: Finding[]) => {
    const n = new Map<string, number>();
    for (const x of xs) n.set(x.rule, (n.get(x.rule) ?? 0) + 1);
    return [...n].map(([r, k]) => `${r} ×${k}`).join(", ");
  };
  out.push(`== ${file}: ${v.failures.length} failure(s) [${byRule(v.failures)}], ${v.warnings.length} warning(s) [${byRule(v.warnings)}]`);
  if (v.failures.length) out.push("   FAILURES (publish blocked)", ...v.failures.map(line));
  if (v.warnings.length) out.push("   WARNINGS", ...v.warnings.map(line));
  out.push("");
}
out.push(`${fiches.length} fiche(s), ${blocked} blocked from publishing.`);
writeFileSync(new URL("validation-report.txt", DIR), out.join("\n") + "\n");
console.log(out.join("\n"));
