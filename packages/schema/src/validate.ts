import { Protocol } from "./schema.ts";

/**
 * One problem the validator found. item_id = the id of the line (item, medication, node, referral, follow-up,
 * source) it is on, or null for the fiche as a whole. The two levels are kept apart: "structure" issues come from the
 * shape alone (validateStructure), every other rule is the publication gate's (gate.ts).
 */
export type Rule =
  | "structure"
  | "required"
  | "ids"
  | "evidence"
  | "basis"
  | "quote"
  | "numbers"
  | "pathway"
  | "refs"
  | "missing"
  | "availability"
  | "approval";

export type Issue = { item_id: string | null; rule: Rule; message: string };

/** The id of the closest object with an `id` along a path of the input. */
function itemIdAt(input: unknown, path: PropertyKey[]): string | null {
  let node: unknown = input;
  let found: string | null = null;
  for (const key of path) {
    if (node && typeof node === "object" && typeof (node as { id?: unknown }).id === "string") found = (node as { id: string }).id;
    node = node && typeof node === "object" ? (node as Record<PropertyKey, unknown>)[key] : undefined;
  }
  if (node && typeof node === "object" && typeof (node as { id?: unknown }).id === "string") found = (node as { id: string }).id;
  return found;
}

/** Level 1: is this a Protocol v1.1 at all (shape, field names, allowed values). */
export function validateStructure(input: unknown): { protocol: Protocol | null; issues: Issue[] } {
  const r = Protocol.safeParse(input);
  if (r.success) return { protocol: r.data, issues: [] };
  const issues = r.error.issues.map((i) => ({
    item_id: itemIdAt(input, i.path),
    rule: "structure" as const,
    message: `${i.path.join(".") || "(root)"} : ${i.message}`,
  }));
  return { protocol: null, issues };
}
