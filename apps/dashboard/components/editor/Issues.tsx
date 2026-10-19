"use client";

import type { Issue, Rule } from "@medguides/schema";

const RULE_LABEL: Record<Rule, string> = {
  structure: "Format", required: "Field to fill", ids: "Ids", evidence: "Evidence", basis: "Local adaptation", quote: "Quotes",
  numbers: "Numbers", pathway: "Decision tree", refs: "References", missing: "Missing fields", availability: "Availability", approval: "Clinical approval",
};

/** Scroll the fiche to a line (null: the fiche as a whole, its Validation section). */
export const goTo = (id: string | null) => {
  const el = id ? document.getElementById(`line-${id}`) : document.getElementById("section-review");
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
};

/** Issues of both validator levels, grouped by rule; a click goes to the line. */
export function Issues({ structure, gate }: { structure: Issue[]; gate: Issue[] }) {
  const all = [...structure, ...gate];
  if (!all.length) return <p className="rounded-lg bg-tint px-3 py-2 text-sm font-medium text-accentink">No problems: the fiche can be published.</p>;
  const groups = new Map<Rule, Issue[]>();
  for (const i of all) groups.set(i.rule, [...(groups.get(i.rule) ?? []), i]);
  return (
    <div className="flex flex-col gap-3">
      {structure.length > 0 && <p className="text-xs font-medium text-flag">Invalid format: fix it first (publishing depends on it).</p>}
      {[...groups].map(([rule, list]) => (
        <div key={rule}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-soft">{RULE_LABEL[rule]} ({list.length})</h4>
          <ul className="flex flex-col gap-0.5">
            {list.map((i, k) => (
              <li key={k}>
                <button type="button" className="w-full rounded px-1.5 py-1 text-left text-sm hover:bg-panel" onClick={() => goTo(i.item_id)}>
                  <span className="me-1.5 font-mono text-xs text-muted">{i.item_id ?? "fiche"}</span>
                  <span className="text-flag">{i.message}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
