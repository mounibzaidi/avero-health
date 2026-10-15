import { describe, expect, it } from "vitest";

import { pathwayProblems, type Pathway, type PathwayNode } from "../src/index.ts";

const node = (id: string, type: PathwayNode["type"], next: (string | null)[] = []): PathwayNode => ({
  id, type, question: type === "decision" ? "Question de test ?" : null,
  branches: next.map((n, i) => ({ id: `b${i + 1}`, label: `Branche ${i + 1}`, next_node_id: n })), items: [],
});

const kinds = (p: Pathway) => pathwayProblems(p).map((x) => [x.kind, x.node_id, x.branch_id]);

describe("pathway checks", () => {
  it("accepts an empty pathway and a complete one", () => {
    expect(kinds({ start_node_id: null, nodes: [] })).toEqual([]);
    expect(kinds({ start_node_id: "n1", nodes: [node("n1", "decision", ["n2", "n3"]), node("n2", "action", ["n3"]), node("n3", "end")] })).toEqual([]);
  });

  it("finds a branch that leads nowhere and one to a node that does not exist", () => {
    expect(kinds({ start_node_id: "n1", nodes: [node("n1", "decision", [null, "n9", "n2"]), node("n2", "end")] })).toEqual([
      ["dead_end", "n1", "b1"],
      ["dead_end", "n1", "b2"],
    ]);
  });

  it("finds a non-end node without branches", () => {
    expect(kinds({ start_node_id: "n1", nodes: [node("n1", "decision", ["n2"]), node("n2", "action")] })).toEqual([["dead_end", "n2", null]]);
  });

  it("finds unreachable nodes, including a cycle cut off from the start", () => {
    const p = { start_node_id: "n1", nodes: [node("n1", "decision", ["n2"]), node("n2", "end"), node("n3", "action", ["n4"]), node("n4", "action", ["n3"])] };
    expect(kinds(p)).toEqual([["unreachable", "n3", null], ["unreachable", "n4", null]]);
  });

  it("needs a start that exists", () => {
    expect(kinds({ start_node_id: null, nodes: [node("n1", "end")] })).toEqual([["no_start", null, null]]);
    expect(kinds({ start_node_id: "x", nodes: [node("n1", "end")] })).toEqual([["bad_start", null, null]]);
  });
});
