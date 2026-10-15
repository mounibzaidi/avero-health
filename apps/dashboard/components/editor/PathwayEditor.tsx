"use client";

import { NODE_TYPE_LABEL, pathwayProblems, type Branch, type Pathway, type PathwayNode } from "@medguides/schema";
import { useContext } from "react";

import { inputCls } from "@/components/ui";

import { Label, List, Text } from "./fields";
import { EnvCtx, Items } from "./ItemEditor";

/** The decision pathway as a list of nodes and their branches. Dead ends and unreachable nodes are flagged live. */
export function PathwayEditor({ pathway, onChange }: { pathway: Pathway; onChange: (p: Pathway) => void }) {
  const { newId } = useContext(EnvCtx);
  const problems = pathwayProblems(pathway);
  const ids = pathway.nodes.map((n) => n.id);
  const nodeTitle = (n: PathwayNode) => `${n.id} · ${n.question || NODE_TYPE_LABEL[n.type]}`;
  const setNodes = (nodes: PathwayNode[]) => onChange({ ...pathway, nodes, start_node_id: pathway.start_node_id ?? nodes[0]?.id ?? null });

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <Label>Nœud de départ</Label>
        <select className={`${inputCls} w-80`} value={pathway.start_node_id ?? ""} onChange={(e) => onChange({ ...pathway, start_node_id: e.target.value || null })}>
          <option value="">[à compléter]</option>
          {pathway.nodes.map((n) => <option key={n.id} value={n.id}>{nodeTitle(n)}</option>)}
        </select>
      </label>
      {problems.filter((p) => !p.node_id).map((p, i) => <p key={i} className="text-xs font-medium text-caution">⚠ {p.message}</p>)}
      <List items={pathway.nodes} add="un nœud" onChange={setNodes}
        blank={(): PathwayNode => ({ id: newId("n"), type: "decision", question: "", branches: [], items: [] })}
        render={(n, set) => {
          const own = problems.filter((p) => p.node_id === n.id);
          const setBranch = (i: number, b: Branch) => set({ ...n, branches: n.branches.map((x, k) => (k === i ? b : x)) });
          return (
            <div id={`line-${n.id}`} className="my-1 flex scroll-mt-20 flex-col gap-2 rounded-lg bg-panel/60 p-2">
              <div className="flex flex-wrap items-end gap-2">
                <span className="pb-2 font-mono text-xs text-muted">{n.id}{n.id === pathway.start_node_id ? " · départ" : ""}</span>
                <label className="flex flex-col gap-1">
                  <Label>Type</Label>
                  <select className={inputCls} value={n.type} onChange={(e) => set({ ...n, type: e.target.value as PathwayNode["type"], branches: e.target.value === "end" ? [] : n.branches })}>
                    {Object.entries(NODE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                <Text label={n.type === "decision" ? "Question" : "Titre (facultatif)"} className="min-w-64 flex-1" value={n.question} onChange={(v) => set({ ...n, question: v || null })} />
              </div>
              {own.map((p, i) => <p key={i} className="text-xs font-medium text-caution">⚠ {p.message}</p>)}
              {n.type !== "end" && (
                <div className="flex flex-col gap-1 ps-3">
                  <Label>Branches</Label>
                  {n.branches.map((b, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">{b.id}</span>
                      <input className={`${inputCls} w-56`} placeholder="[à compléter]" value={b.label} onChange={(e) => setBranch(i, { ...b, label: e.target.value })} />
                      <span className="text-sm text-muted">mène à</span>
                      <select className={`${inputCls} w-72 ${!b.next_node_id || !ids.includes(b.next_node_id) ? "border-caution" : ""}`} value={b.next_node_id ?? ""}
                        onChange={(e) => setBranch(i, { ...b, next_node_id: e.target.value || null })}>
                        <option value="">nulle part (impasse)</option>
                        {pathway.nodes.filter((x) => x.id !== n.id).map((x) => <option key={x.id} value={x.id}>{nodeTitle(x)}</option>)}
                        {b.next_node_id && !ids.includes(b.next_node_id) && <option value={b.next_node_id}>{b.next_node_id} (inexistant)</option>}
                      </select>
                      <button type="button" className="text-xs text-muted hover:text-flag" onClick={() => set({ ...n, branches: n.branches.filter((_, k) => k !== i) })}>Supprimer</button>
                    </div>
                  ))}
                  <button type="button" className="self-start rounded px-2 py-1 text-xs font-medium text-accentink hover:bg-tint"
                    onClick={() => set({ ...n, branches: [...n.branches, { id: `b${n.branches.reduce((m, b) => Math.max(m, Number(b.id.replace(/\D/g, "")) || 0), 0) + 1}`, label: "", next_node_id: null }] })}>
                    + une branche
                  </button>
                </div>
              )}
              <div className="ps-3">
                <Label>Items de ce nœud</Label>
                <Items items={n.items} prefix="it" add="un item" onChange={(items) => set({ ...n, items })} />
              </div>
            </div>
          );
        }} />
      {pathway.nodes.length > 0 && (
        <p className={`text-xs ${problems.length ? "font-medium text-caution" : "text-muted"}`}>
          {problems.length ? `${problems.length} problème(s) dans l'arbre : impasses ou nœuds inatteignables.` : "Chaque branche mène quelque part, chaque nœud est atteint."}
        </p>
      )}
    </div>
  );
}
