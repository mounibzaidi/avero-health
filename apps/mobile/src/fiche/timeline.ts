import type { Branch, Pathway, PathwayNode } from "@avero/schema";

/**
 * A profile tab's tree as one timeline, open from the start: its steps in order, numbered, each with what its other
 * answers lead to. Only a question (a decision) hides something: the sub-path of the answers not chosen.
 *
 * - The way on (the answer that leads to another step of the same tab) is the line itself, its label a caption on the
 *   line. Of several, the one that leads to the others comes first; the others point to their step ("→ étape 3").
 * - An answer that leads to an end with nothing in it (the shared "PA contrôlée") is a success chip on its step.
 * - An end with lines is a step of its own, the last of its line.
 * - A node of another tab is a link to that tab; each node belongs to the first tab that reaches it.
 */

/** What an answer of a step leads to, when it does not continue the line below it. */
export type Note =
  | { kind: "success"; branch: Branch }
  | { kind: "jump"; branch: Branch; step: number }
  | { kind: "link"; branch: Branch; tab: Branch; node: PathwayNode }
  | { kind: "none"; branch: Branch };

export type Step = {
  node: PathwayNode;
  n: number;
  /** the answer that led here, shown on the line above; `from`: its step, when that is not the step just above */
  caption: { label: string; from: number | null } | null;
  /** a question: its answers, the one chosen (its sub-path follows) */
  decision: { choices: Branch[]; chosen: string } | null;
  notes: Note[];
};

/** An end with nothing in it: the success every line can end on. */
export const isSuccess = (n: PathwayNode) => n.type === "end" && !n.items.length;

/** The tabs (the start question's answers that lead somewhere) and the tab each node belongs to. */
export function tabsOf(p: Pathway, start: PathwayNode) {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const tabs = start.branches.filter((b) => b.next_node_id && byId.has(b.next_node_id));
  const roots = new Set(tabs.map((b) => b.next_node_id!));
  const owner = new Map<string, Branch>();
  for (const tab of tabs) {
    const queue = [tab.next_node_id!];
    while (queue.length) {
      const id = queue.shift()!;
      if (owner.has(id)) continue;
      owner.set(id, tab);
      for (const b of byId.get(id)!.branches) {
        const t = b.next_node_id ? byId.get(b.next_node_id) : undefined;
        if (t && !roots.has(t.id) && !isSuccess(t)) queue.push(t.id);
      }
    }
  }
  return { byId, tabs, owner };
}

/** The timeline of `tab`; `chosen`: node id → the answer chosen at that question (the first when none is). */
export function timeline(p: Pathway, start: PathwayNode, tab: Branch, chosen: Record<string, string>): Step[] {
  const { byId, owner } = tabsOf(p, start);
  const mine = (id: string) => owner.get(id) === tab;
  const target = (b: Branch) => (b.next_node_id ? byId.get(b.next_node_id) : undefined);

  /** Can `to` be reached from `from` inside this tab? */
  const reaches = (from: string, to: string) => {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length) {
      const id = queue.shift()!;
      if (id === to && id !== from) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const b of byId.get(id)!.branches) if (b.next_node_id && mine(b.next_node_id)) queue.push(b.next_node_id);
    }
    return false;
  };

  const steps: Step[] = [];
  const placed = new Map<string, number>();

  /** An answer that is not walked here: what its step says about it. */
  const note = (b: Branch): Note | null => {
    const t = target(b);
    if (!t) return { kind: "none", branch: b };
    if (isSuccess(t)) return { kind: "success", branch: b };
    if (!mine(t.id)) return { kind: "link", branch: b, tab: owner.get(t.id) ?? tab, node: t };
    const at = placed.get(t.id);
    return at ? { kind: "jump", branch: b, step: at } : null;
  };

  const walk = (node: PathwayNode, caption: Step["caption"]) => {
    const step: Step = { node, n: steps.length + 1, caption, decision: null, notes: [] };
    steps.push(step);
    placed.set(node.id, step.n);
    const notes = new Map<Branch, Note>();

    if (node.type === "decision" && node.branches.length) {
      const pick = node.branches.find((b) => b.id === chosen[node.id]) ?? node.branches[0];
      step.decision = { choices: node.branches, chosen: pick.id };
      const n = note(pick);
      if (n) notes.set(pick, n);
      else walk(target(pick)!, null);
    } else {
      const onward: Branch[] = [];
      for (const b of node.branches) {
        const n = note(b);
        if (n) notes.set(b, n);
        else onward.push(b);
      }
      // the answer that leads to the others first (failure of a monotherapy before failure of a bitherapy)
      onward.sort((a, b) => (reaches(a.next_node_id!, b.next_node_id!) ? -1 : reaches(b.next_node_id!, a.next_node_id!) ? 1 : 0));
      for (const b of onward) {
        // walked by an earlier answer of this step: it points there
        const n = note(b);
        if (n) notes.set(b, n);
        else walk(target(b)!, { label: b.label, from: steps.at(-1) === step ? null : step.n });
      }
    }
    step.notes = node.branches.flatMap((b) => notes.get(b) ?? []);
  };

  const root = target(tab);
  if (root) walk(root, null);
  return steps;
}
