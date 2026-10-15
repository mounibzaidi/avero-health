"use client";

import type { Element, Posologie, SourceMeta, SourceRef } from "@medguides/schema";
import { createContext, useContext } from "react";

import { inputCls } from "@/components/ui";

import { Area, Cite, Item, ItemFindings, Label, List, ListText, Select, Text } from "./fields";

/** What every element form needs to know about the fiche and the editor. */
export const EditorCtx = createContext<{ sources: SourceMeta[]; posologies: Posologie[]; me: string }>({ sources: [], posologies: [], me: "" });

const TYPES = [["action", "Action"], ["conditional", "Conditionnelle (« Si … »)"], ["info", "Information"], ["row", "Ligne de tableau"]] as const;
const RISKS = [["high", "élevé"], ["medium", "moyen"], ["low", "faible"]] as const;
const ORIGINS = [["explicit", "dans la source"], ["local_adaptation", "adaptation locale (Algérie)"]] as const;
const DELAIS = [["", "aucun"], ["immédiat", "Immédiat"], ["<1h", "< 1 h"], ["<24h", "< 24 h"]] as const;
const PHASES = [["", "orientation (sans phase)"], ["avant_transfert", "avant le transfert"], ["pendant_transfert", "pendant le transfert"]] as const;

let counter = 0;
const newId = () => `l-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const blankElement = (sourceId: string, risk: Element["risk"] = "medium"): Element => ({
  id: newId(), text: "", type: "action", condition: null, order: null, source: { source_id: sourceId, page: 1, quote: "" }, translated: false,
  grade: null, risk, origin: "explicit", conflict_group: null, variant_group: null, missing: [], refs: [], attached_to: [], delai: null,
});

/** The source of a line: which document, which page, the source's own words. */
export function SourceFields({ value, onChange }: { value: SourceRef; onChange: (v: SourceRef) => void }) {
  const { sources } = useContext(EditorCtx);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Source" className="min-w-48 flex-1" value={value.source_id} options={sources.map((s) => [s.source_id, s.title] as const)} onChange={(v) => onChange({ ...value, source_id: v ?? "" })} />
        <label className="flex w-20 flex-col gap-1">
          <Label>Page</Label>
          <input type="number" min={1} className={`${inputCls} w-full`} value={value.page || ""} onChange={(e) => onChange({ ...value, page: Number(e.target.value) })} />
        </label>
        <label className="flex w-20 flex-col gap-1">
          <Label>à la page</Label>
          <input type="number" min={1} className={`${inputCls} w-full`} value={value.page_end ?? ""} onChange={(e) => onChange({ ...value, page_end: e.target.value ? Number(e.target.value) : undefined })} />
        </label>
      </div>
      <Area label="Citation de la source (mot pour mot)" required value={value.quote} onChange={(quote) => onChange({ ...value, quote })} />
    </div>
  );
}

/** One element, read first as the app shows it; its fields open one at a time. Editing a reviewed line clears its review. */
export function ElementFields({ el, onChange, section, tone = "text-ink" }: { el: Element; onChange: (v: Element) => void; section: string; tone?: string }) {
  const { sources, posologies, me } = useContext(EditorCtx);
  const set = (patch: Partial<Element>) => onChange({ ...el, ...patch, checked: undefined });
  const local = el.origin === "local_adaptation";
  return (
    <Item shown={{ source: el.source, label: el.text }} blank={!el.text}
      read={
        <>
          <p className={`text-sm ${tone}`}>
            {el.type === "conditional" && el.condition ? <span className="font-semibold text-accentink">Si {el.condition} → </span> : null}
            {el.text || <span className="text-muted">Ligne vide</span>}
            {el.risk === "high" && <span className={`ml-2 rounded px-1 py-0.5 text-[11px] font-medium ${el.checked ? "bg-tint text-accentink" : "bg-flagbg text-flag"}`}>{el.checked ? `relu · ${el.checked.by}` : "risque élevé"}</span>}
            {el.attached_to.length > 0 && <span className="ml-2 rounded bg-panel px-1 py-0.5 text-[11px] text-soft">↳ {el.attached_to.join(", ")}</span>}
          </p>
          <Cite source={el.source} origin={el.origin} reviewer={el.reviewer} />
          <ItemFindings id={el.id} />
        </>
      }
      form={
        <>
          <Area label="Ligne (ce que l'application affiche, en français)" autoFocus={!el.text} value={el.text} onChange={(text) => set({ text })} />
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Select label="Type" value={el.type} options={TYPES} onChange={(v) => set({ type: v ?? "action" })} />
            <Select label="Risque" value={el.risk} options={RISKS} onChange={(v) => set({ risk: v ?? "medium" })} />
            <Select label="Origine" value={el.origin} options={ORIGINS} onChange={(v) => set({ origin: v ?? "explicit", source: v === "local_adaptation" ? el.source : (el.source ?? { source_id: sources[0]?.source_id ?? "", page: 1, quote: "" }) })} />
            <Text label="Grade (tel qu'écrit)" value={el.grade} onChange={(v) => set({ grade: v || null })} />
          </div>
          {el.type === "conditional" && <Text label="Condition (« Si … »)" value={el.condition} onChange={(v) => set({ condition: v || null })} />}
          {local ? (
            <div className="flex flex-col gap-2 rounded-lg bg-cautionbg/60 p-2">
              <Text label="Relecteur qui signe cette adaptation (obligatoire sans citation)" value={el.reviewer} onChange={(v) => set({ reviewer: v || null })} />
              {el.source ? (
                <>
                  <SourceFields value={el.source} onChange={(source) => set({ source })} />
                  <button type="button" className="self-start text-xs text-flag hover:underline" onClick={() => set({ source: null })}>Retirer la citation</button>
                </>
              ) : (
                <button type="button" className="self-start text-xs text-accentink hover:underline" onClick={() => set({ source: { source_id: sources[0]?.source_id ?? "", page: 1, quote: "" } })}>+ une citation</button>
              )}
            </div>
          ) : (
            <SourceFields value={el.source ?? { source_id: sources[0]?.source_id ?? "", page: 1, quote: "" }} onChange={(source) => set({ source })} />
          )}
          <label className="flex items-center gap-2 text-xs text-soft">
            <input type="checkbox" checked={el.translated} onChange={(e) => set({ translated: e.target.checked })} />
            Citation dans une autre langue (traduite)
          </label>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Text label="Moment" value={el.timing} onChange={(v) => set({ timing: v || null })} />
            <Text label="Justification" value={el.reason} onChange={(v) => set({ reason: v || null })} />
            <Select label="Délai (badge)" value={el.delai} options={DELAIS} onChange={(v) => set({ delai: v })} />
            {section === "9_orientation" && <Select label="Transfert" value={el.phase ?? null} options={PHASES} onChange={(v) => set({ phase: v })} />}
          </div>
          {posologies.length > 0 && (
            <div className="flex flex-col gap-1">
              <Label>Rattachée aux doses (affichée dans leur carte)</Label>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {posologies.map((p) => (
                  <label key={p.id} className="flex items-center gap-1.5 text-xs text-soft">
                    <input type="checkbox" checked={el.attached_to.includes(p.id)}
                      onChange={(e) => set({ attached_to: e.target.checked ? [...el.attached_to, p.id] : el.attached_to.filter((x) => x !== p.id) })} />
                    {p.drug_dci} {p.condition ? `(${p.condition})` : ""} <span className="font-mono text-muted">{p.id}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Text label="Variante de perfusion (groupe)" value={el.variant_group} onChange={(v) => set({ variant_group: v || null })} />
            <Text label="Sources divergentes (groupe)" value={el.conflict_group} onChange={(v) => set({ conflict_group: v || null })} />
            <ListText label="Renvois (ids)" value={el.refs} onChange={(refs) => set({ refs })} />
            <ListText label="Absent de la source" value={el.missing} onChange={(missing) => set({ missing })} />
          </div>
          {el.type === "row" && (
            <div className="flex flex-col gap-1">
              <Label>Cellules du tableau</Label>
              <List items={Object.entries(el.cells ?? {})} blank={() => ["", ""] as [string, string]} add="une cellule"
                onChange={(cells) => set({ cells: Object.fromEntries(cells) })}
                render={([k, v], setCell) => (
                  <div className="flex gap-2">
                    <input className={`${inputCls} w-40`} placeholder="colonne" value={k} onChange={(e) => setCell([e.target.value, v])} />
                    <input className={`${inputCls} flex-1`} placeholder="valeur" value={v} onChange={(e) => setCell([k, e.target.value])} />
                  </div>
                )} />
            </div>
          )}
          {el.risk === "high" && (
            <label className="flex items-center gap-2 rounded-lg bg-flagbg px-2 py-1.5 text-xs font-medium text-flag">
              <input type="checkbox" checked={!!el.checked} onChange={(e) => onChange({ ...el, checked: e.target.checked ? { by: me, at: new Date().toISOString() } : undefined })} />
              Relu individuellement (risque élevé){el.checked ? ` · ${el.checked.by}` : ""}
            </label>
          )}
        </>
      }
    />
  );
}

/** A list of elements with its "+" link. New lines take the section's required risk. */
export const Elements = ({ items, onChange, section, add = "une ligne", risk, tone }: {
  items: Element[]; onChange: (v: Element[]) => void; section: string; add?: string; risk?: Element["risk"]; tone?: string;
}) => {
  const { sources } = useContext(EditorCtx);
  return (
    <List items={items} onChange={onChange} add={add} blank={() => blankElement(sources[0]?.source_id ?? "", risk)}
      render={(el, set) => <ElementFields el={el} onChange={set} section={section} tone={tone} />} />
  );
};
