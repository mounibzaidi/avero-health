import type { Pathway } from "./schema.ts";

/** A problem of the decision pathway, tied to the node (and branch) it is on. */
export type PathwayProblem = {
  node_id: string | null;
  branch_id: string | null;
  kind: "no_start" | "bad_start" | "dead_end" | "unreachable" | "end_with_branches";
  message: string;
};

/**
 * Every branch must lead to a node or an end; every node must be reachable from the start.
 * A dead end: a branch without a target, a branch to a node that does not exist, or a non-end node without branches.
 */
export function pathwayProblems(pathway: Pathway): PathwayProblem[] {
  const { nodes, start_node_id } = pathway;
  if (!nodes.length) return [];
  const out: PathwayProblem[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  if (!start_node_id) out.push({ node_id: null, branch_id: null, kind: "no_start", message: "No start node chosen" });
  else if (!byId.has(start_node_id)) out.push({ node_id: null, branch_id: null, kind: "bad_start", message: `Start node "${start_node_id}" does not exist` });

  for (const n of nodes) {
    if (n.type === "end") {
      if (n.branches.length) out.push({ node_id: n.id, branch_id: null, kind: "end_with_branches", message: `End node "${n.id}" has branches` });
      continue;
    }
    if (!n.branches.length) out.push({ node_id: n.id, branch_id: null, kind: "dead_end", message: `Dead end: node "${n.id}" has no branch and is not an end` });
    for (const b of n.branches) {
      if (!b.next_node_id) out.push({ node_id: n.id, branch_id: b.id, kind: "dead_end", message: `Dead end: branch "${b.label || b.id}" of node "${n.id}" leads nowhere` });
      else if (!byId.has(b.next_node_id)) out.push({ node_id: n.id, branch_id: b.id, kind: "dead_end", message: `Dead end: branch "${b.label || b.id}" of node "${n.id}" leads to "${b.next_node_id}", which does not exist` });
    }
  }

  const reached = new Set<string>();
  const queue = start_node_id && byId.has(start_node_id) ? [start_node_id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (reached.has(id)) continue;
    reached.add(id);
    for (const b of byId.get(id)!.branches) if (b.next_node_id && byId.has(b.next_node_id)) queue.push(b.next_node_id);
  }
  if (start_node_id && byId.has(start_node_id)) {
    for (const n of nodes) {
      if (!reached.has(n.id)) out.push({ node_id: n.id, branch_id: null, kind: "unreachable", message: `Node "${n.id}" is not reached by any path from the start` });
    }
  }
  return out;
}
