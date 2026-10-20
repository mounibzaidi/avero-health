"use client";

import type { Issue, Rule } from "@avero/schema";

const RULE_LABEL: Record<Rule, string> = {
  structure: "Format", required: "Field to fill", ids: "Ids", evidence: "Evidence", basis: "Local adaptation", quote: "Quotes",
  numbers: "Numbers", pathway: "Decision tree", refs: "References", missing: "Missing fields", availability: "Availability", approval: "Clinical approval",
};

/** Scroll the fiche to a line (null: the fiche as a whole, its Validation section). */
export const goTo = (id: string | null) => {
  const el = id ? document.getElementById(`line-${id}`) : document.getElementById("section-review");
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
};

/**
 * Issues of both validator levels, grouped by rule; a click goes to the line. With `onFix` (admins), a gate problem
 * can be marked as fixed and the mark undone, and with `onFixAll` all of them at once; a format problem cannot (the
 * app could not read the fiche).
 */
export function Issues({ structure, gate, fixed = [], onFix, onFixAll }: {
  structure: Issue[]; gate: Issue[]; fixed?: Issue[]; onFix?: (i: Issue, on: boolean) => void; onFixAll?: () => void;
}) {
  const all = [...structure, ...gate];
  const groups = new Map<Rule, Issue[]>();
  for (const i of all) groups.set(i.rule, [...(groups.get(i.rule) ?? []), i]);
  const row = (i: Issue, k: number, done: boolean) => (
    <li key={k} className="flex items-start gap-1">
      <button type="button" className="min-w-0 flex-1 rounded px-1.5 py-1 text-left text-sm hover:bg-panel" onClick={() => goTo(i.item_id)}>
        <span className="me-1.5 font-mono text-xs text-muted">{i.item_id ?? "fiche"}</span>
        <span className={done ? "text-soft line-through" : "text-flag"}>{i.message}</span>
      </button>
      {onFix && i.rule !== "structure" && (
        <button type="button" className="shrink-0 rounded px-1.5 py-1 text-xs font-medium text-accentink hover:bg-panel" onClick={() => onFix(i, !done)}>
          {done ? "Undo" : "Mark as fixed"}
        </button>
      )}
    </li>
  );
  return (
    <div className="flex flex-col gap-3">
      {!all.length && <p className="rounded-lg bg-tint px-3 py-2 text-sm font-medium text-accentink">No problems: the fiche can be published.</p>}
      {structure.length > 0 && <p className="text-xs font-medium text-flag">Invalid format: fix it first (publishing depends on it).</p>}
      {onFixAll && gate.length > 1 && (
        <button type="button" className="self-end rounded px-1.5 py-1 text-xs font-medium text-accentink hover:bg-panel" onClick={onFixAll}>Mark all as fixed ({gate.length})</button>
      )}
      {[...groups].map(([rule, list]) => (
        <div key={rule}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-soft">{RULE_LABEL[rule]} ({list.length})</h4>
          <ul className="flex flex-col gap-0.5">{list.map((i, k) => row(i, k, false))}</ul>
        </div>
      ))}
      {fixed.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-soft">Marked as fixed ({fixed.length}), noted in the change log on publishing</h4>
          <ul className="flex flex-col gap-0.5">{fixed.map((i, k) => row(i, k, true))}</ul>
        </div>
      )}
    </div>
  );
}
