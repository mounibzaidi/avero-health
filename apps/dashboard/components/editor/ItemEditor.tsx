"use client";

import {
  ORIGIN_LABEL, quoteKey, STRENGTH_LABEL, TIMING_LABEL, type Evidence, type Item, type QuoteResult, type Source, type Strength,
} from "@medguides/schema";
import { createContext, useContext } from "react";

import { inputCls } from "@/components/ui";

import { Area, Ids, Label, Line, List, Select, ShowCtx, Text, Val } from "./fields";

/** What every line editor needs from the fiche around it. */
export type EditorEnv = {
  sources: Source[];
  quotes: Record<string, QuoteResult>;
  /** A new id with this prefix, unused in the fiche. */
  newId: (prefix: string) => string;
};
export const EnvCtx = createContext<EditorEnv>({ sources: [], quotes: {}, newId: (p) => p });

/** "AHA/ACC p. 1678" for a line's first evidence. */
export function citeShort(e: Evidence | undefined, sources: Source[]): string | null {
  if (!e) return null;
  const s = sources.find((x) => x.id === e.source_id);
  return `${s?.organisation || e.source_id || "?"}${e.page ? ` p. ${e.page}` : ""}`;
}

function QuoteState({ r }: { r: QuoteResult | undefined }) {
  if (!r) return <span className="text-xs text-muted">non vérifiée</span>;
  return r.found
    ? <span className="text-xs font-medium text-accent">trouvée sur la page</span>
    : <span className="text-xs font-medium text-flag">introuvable{r.message ? ` : ${r.message}` : ""}</span>;
}

/** The evidence of a line: source picker, page, quote, and the quote check's result for each. */
export function EvidenceList({ lineId, value, onChange, label }: { lineId: string; value: Evidence[]; onChange: (v: Evidence[]) => void; label: string }) {
  const { sources, quotes } = useContext(EnvCtx);
  const show = useContext(ShowCtx);
  return (
    <div className="flex flex-col gap-1">
      <Label>Preuves</Label>
      <List items={value} add="une preuve" onChange={onChange} blank={(): Evidence => ({ source_id: sources[0]?.id ?? "", page: null, quote: "" })}
        render={(e, set, i) => (
          <div className="my-1 flex flex-col gap-1.5 rounded-lg bg-panel/60 p-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <Label>Source</Label>
                <select className={`${inputCls} w-64`} value={e.source_id} onChange={(x) => set({ ...e, source_id: x.target.value })}>
                  <option value="">[à compléter]</option>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.organisation || s.id} · {s.title.slice(0, 50)}</option>)}
                  {e.source_id && !sources.some((s) => s.id === e.source_id) && <option value={e.source_id}>{e.source_id} (absente des sources)</option>}
                </select>
              </label>
              <Text label="Page (imprimée)" type="number" className="w-28" value={e.page} onChange={(v) => set({ ...e, page: v ? Math.max(1, Math.trunc(Number(v))) : null })} />
              <div className="flex flex-1 items-center gap-2 pb-2">
                <QuoteState r={quotes[quoteKey(lineId, i)]} />
                {e.quote && e.page ? (
                  <button type="button" className="text-xs font-medium text-accentink hover:underline" onClick={() => show({ evidence: e, label })}>Voir dans le PDF</button>
                ) : null}
              </div>
            </div>
            <Area label="Citation (mots exacts de la source)" rows={2} value={e.quote} onChange={(v) => set({ ...e, quote: v })} />
          </div>
        )} />
    </div>
  );
}

/** The grey tag the app shows under a line: source, page, strength. */
export function TagLine({ evidence, strength }: { evidence: Evidence[]; strength: Strength | null }) {
  const { sources } = useContext(EnvCtx);
  const cite = citeShort(evidence[0], sources);
  return (
    <span className="ms-2 text-xs text-muted">
      {cite ?? "sans preuve"}{evidence.length > 1 ? ` +${evidence.length - 1}` : ""} · {strength ? STRENGTH_LABEL[strength] : "force [à compléter]"}
    </span>
  );
}

export function ItemEditor({ item, onChange, fresh }: { item: Item; onChange: (v: Item) => void; fresh?: boolean }) {
  const set = (patch: Partial<Item>) => onChange({ ...item, ...patch });
  return (
    <Line id={item.id} blank={fresh}
      summary={
        <>
          {item.condition && <span className="text-soft">Si {item.condition} : </span>}
          <Val value={item.text} className="text-ink" />
          {item.origin === "adaptation_locale"
            ? <span className="ms-2 text-xs text-caution">adaptation locale</span>
            : <TagLine evidence={item.evidence} strength={item.strength} />}
        </>
      }
      form={
        <>
          <div className="flex items-center gap-2 text-xs text-muted"><span className="font-mono">{item.id}</span></div>
          <Area label="Texte (synthèse en français, voix active)" value={item.text} onChange={(text) => set({ text })} />
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <Text label="Condition" className="md:col-span-2" value={item.condition} onChange={(v) => set({ condition: v || null })} />
            <Select label="Délai" value={item.timing} options={TIMING_LABEL} onChange={(timing) => set({ timing })} />
            <Select label="Force" value={item.strength} options={STRENGTH_LABEL} onChange={(strength) => set({ strength })} />
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <label className="flex flex-col gap-1">
              <Label>Origine</Label>
              <select className={inputCls} value={item.origin} onChange={(e) => set({ origin: e.target.value as Item["origin"] })}>
                {Object.entries(ORIGIN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            {item.origin === "adaptation_locale" && (
              <Text label="Justification (basis), signée par le relecteur" className="md:col-span-3" value={item.basis} onChange={(v) => set({ basis: v || null })} />
            )}
          </div>
          <EvidenceList lineId={item.id} label={item.text} value={item.evidence} onChange={(evidence) => set({ evidence })} />
          <Ids label="Références (scores ou fiches, ex. S-wells)" value={item.refs} onChange={(refs) => set({ refs })} />
        </>
      } />
  );
}

export const blankItem = (id: string): Item => ({
  id, text: "", condition: null, timing: null, strength: null, origin: "source", basis: null, evidence: [], refs: [],
});

/** A list of items with the "+ add" link. */
export function Items({ items, onChange, add, prefix }: { items: Item[]; onChange: (v: Item[]) => void; add: string; prefix: string }) {
  const { newId } = useContext(EnvCtx);
  return (
    <List items={items} add={add} onChange={onChange} blank={() => blankItem(newId(prefix))}
      render={(it, set, _i, fresh) => <ItemEditor item={it} onChange={set} fresh={fresh} />} />
  );
}
