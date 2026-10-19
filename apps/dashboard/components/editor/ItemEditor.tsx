"use client";

import {
  quoteKey, type Evidence, type Item, type QuoteResult, type Source,
} from "@medguides/schema";
import { createContext, useContext } from "react";

import { ORIGIN_LABEL, STRENGTH_LABEL, TIMING_LABEL, TO_COMPLETE } from "@/lib/labels";
import { inputCls } from "@/components/ui";

import { Area, Ids, Label, List, Select, ShowCtx, Text } from "./fields";

/** What every line editor needs from the fiche around it. */
export type EditorEnv = {
  sources: Source[];
  quotes: Record<string, QuoteResult>;
  /** A new id with this prefix, unused in the fiche. */
  newId: (prefix: string) => string;
};
export const EnvCtx = createContext<EditorEnv>({ sources: [], quotes: {}, newId: (p) => p });

function QuoteState({ r }: { r: QuoteResult | undefined }) {
  if (!r) return <span className="text-xs text-muted">not checked</span>;
  return r.found
    ? <span className="text-xs font-medium text-accent">found on the page</span>
    : <span className="text-xs font-medium text-flag">not found{r.message ? `: ${r.message}` : ""}</span>;
}

/** The evidence of a line: source picker, page, quote, and the quote check's result for each. */
export function EvidenceList({ lineId, value, onChange, label }: { lineId: string; value: Evidence[]; onChange: (v: Evidence[]) => void; label: string }) {
  const { sources, quotes } = useContext(EnvCtx);
  const show = useContext(ShowCtx);
  return (
    <div className="flex flex-col gap-1">
      <Label>Evidence</Label>
      <List items={value} add="evidence" onChange={onChange} blank={(): Evidence => ({ source_id: sources[0]?.id ?? "", page: null, quote: "" })}
        render={(e, set, i) => (
          <div className="my-1 flex flex-col gap-1.5 rounded-lg bg-panel/60 p-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <Label>Source</Label>
                <select className={`${inputCls} w-64`} value={e.source_id} onChange={(x) => set({ ...e, source_id: x.target.value })}>
                  <option value="">{TO_COMPLETE}</option>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.organisation || s.id} · {s.title.slice(0, 50)}</option>)}
                  {e.source_id && !sources.some((s) => s.id === e.source_id) && <option value={e.source_id}>{e.source_id} (not in the sources)</option>}
                </select>
              </label>
              <Text label="Page (printed)" type="number" className="w-28" value={e.page} onChange={(v) => set({ ...e, page: v ? Math.max(1, Math.trunc(Number(v))) : null })} />
              <div className="flex flex-1 items-center gap-2 pb-2">
                <QuoteState r={quotes[quoteKey(lineId, i)]} />
                {e.quote && e.page ? (
                  <button type="button" className="text-xs font-medium text-accentink hover:underline" onClick={() => show({ evidence: e, label })}>Show in the PDF</button>
                ) : null}
              </div>
            </div>
            <Area label="Quote (the source's exact words)" rows={2} value={e.quote} onChange={(v) => set({ ...e, quote: v })} />
          </div>
        )} />
    </div>
  );
}

/** The less-used fields of a line, under it when "⋯" is open: condition, timing, strength, origin, evidence, refs. */
export function ItemDetails({ item, onChange }: { item: Item; onChange: (v: Item) => void }) {
  const set = (patch: Partial<Item>) => onChange({ ...item, ...patch });
  return (
    <>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <Text label="Condition (shown as “Si …”)" className="md:col-span-2" value={item.condition} onChange={(v) => set({ condition: v || null })} />
        <Select label="Timing" value={item.timing} options={TIMING_LABEL} onChange={(timing) => set({ timing })} />
        <Select label="Strength" value={item.strength} options={STRENGTH_LABEL} onChange={(strength) => set({ strength })} />
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <label className="flex flex-col gap-1">
          <Label>Origin</Label>
          <select className={inputCls} value={item.origin} onChange={(e) => set({ origin: e.target.value as Item["origin"] })}>
            {Object.entries(ORIGIN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {item.origin === "adaptation_locale" && (
          <Text label="Justification (basis), signed by the reviewer" className="md:col-span-3" value={item.basis} onChange={(v) => set({ basis: v || null })} />
        )}
      </div>
      <EvidenceList lineId={item.id} label={item.text} value={item.evidence} onChange={(evidence) => set({ evidence })} />
      <Ids label="References (scores or fiches, e.g. S-wells)" value={item.refs} onChange={(refs) => set({ refs })} />
    </>
  );
}

export const blankItem = (id: string): Item => ({
  id, text: "", condition: null, timing: null, strength: null, origin: "source", basis: null, evidence: [], refs: [],
});
