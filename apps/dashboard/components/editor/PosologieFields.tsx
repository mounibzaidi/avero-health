"use client";

import type { Posologie } from "@medguides/schema";
import { useContext } from "react";

import { Cite, Item, ItemFindings, List, ListText, Text } from "./fields";
import { EditorCtx, SourceFields } from "./ElementFields";

let counter = 0;
const blankPosologie = (sourceId: string): Posologie => ({
  id: `pos-${Date.now().toString(36)}-${(counter++).toString(36)}`, drug_dci: "", dose: "", dose_max: null, route: "", administration: null,
  frequency_or_duration: "", condition: null, risk: "high", source: { source_id: sourceId, page: 1, quote: "" }, translated: false, missing: [],
  titration: null, algerie: { brands: [], statut: null }, note: null,
});

/** One dose card: read as the app shows it closed (drug, role, dose), its fields one at a time. Brands are
 * computed by the matcher from the national nomenclature: shown, never typed. */
function PosologieItem({ p, onChange }: { p: Posologie; onChange: (v: Posologie) => void }) {
  const { me } = useContext(EditorCtx);
  const set = (patch: Partial<Posologie>) => onChange({ ...p, ...patch, checked: undefined });
  const t = p.titration ?? { start: null, step: null, interval: null, max: null };
  return (
    <div className="my-1 rounded-xl border border-edge/15 bg-surface">
      <div className="rounded-t-xl bg-tint/50 p-1">
        <Item shown={{ source: p.source, label: `${p.drug_dci} ${p.dose}` }} blank={!p.drug_dci}
          read={
            <>
              <p className="text-sm">
                <span className="font-semibold text-ink">{p.drug_dci || "Médicament (DCI)"}</span>
                {p.condition && <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-accentink">{p.condition}</span>}
                <span className={`ml-2 rounded px-1 py-0.5 text-[11px] font-medium ${p.checked ? "bg-tint text-accentink" : "bg-flagbg text-flag"}`}>{p.checked ? `relu · ${p.checked.by}` : "à relire"}</span>
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-ink">
                {p.dose || <span className="font-sans font-normal text-caution">dose non précisée</span>}
                {p.route ? <span className="ml-2 font-sans font-normal text-soft">{p.route}</span> : null}
                {p.frequency_or_duration ? <span className="ml-2 font-sans font-normal text-soft">Durée : {p.frequency_or_duration}</span> : null}
              </p>
              {p.dose_max && <p className="text-xs font-semibold text-flag">Dose maximale : {p.dose_max}</p>}
              <p className="text-xs text-muted">{p.algerie.brands.length ? `DZ · ${p.algerie.brands.map((b) => b.brand).join(", ")}` : `DZ · ${p.algerie.statut ?? "non apparié"}`} <span className="font-mono">{p.id}</span></p>
              <Cite source={p.source} />
              <ItemFindings id={p.id} />
            </>
          }
          form={
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Text label="Médicament (DCI)" value={p.drug_dci} onChange={(drug_dci) => set({ drug_dci })} />
                <Text label="Rôle / condition (dose d'attaque…)" value={p.condition} onChange={(v) => set({ condition: v || null })} />
                <Text label="Dose" mono value={p.dose} onChange={(dose) => set({ dose })} />
                <Text label="Dose maximale (rouge sur la carte)" mono value={p.dose_max} onChange={(v) => set({ dose_max: v || null })} />
                <Text label="Voie" value={p.route} onChange={(route) => set({ route })} />
                <Text label="Administration" value={p.administration} onChange={(v) => set({ administration: v || null })} />
                <Text label="Fréquence ou durée" value={p.frequency_or_duration} onChange={(frequency_or_duration) => set({ frequency_or_duration })} />
                <ListText label="Champs absents de la source" value={p.missing} onChange={(missing) => set({ missing })} />
              </div>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                {(["start", "step", "interval", "max"] as const).map((k) => (
                  <Text key={k} label={`Titration : ${{ start: "début", step: "palier", interval: "intervalle", max: "maximum" }[k]}`} value={t[k]}
                    onChange={(v) => {
                      const next = { ...t, [k]: v || null };
                      set({ titration: Object.values(next).some(Boolean) ? next : null });
                    }} />
                ))}
              </div>
              <SourceFields value={p.source} onChange={(source) => set({ source })} />
              <Text label="Note (incohérence de la source, signalée et non corrigée)" value={p.note} onChange={(v) => set({ note: v || null })} />
              <label className="flex items-center gap-2 rounded-lg bg-flagbg px-2 py-1.5 text-xs font-medium text-flag">
                <input type="checkbox" checked={!!p.checked} onChange={(e) => onChange({ ...p, checked: e.target.checked ? { by: me, at: new Date().toISOString() } : undefined })} />
                Dose relue individuellement{p.checked ? ` · ${p.checked.by}` : ""}
              </label>
            </>
          }
        />
      </div>
    </div>
  );
}

export function Posologies({ items, onChange }: { items: Posologie[]; onChange: (v: Posologie[]) => void }) {
  const { sources } = useContext(EditorCtx);
  return <List items={items} onChange={onChange} add="une dose" blank={() => blankPosologie(sources[0]?.source_id ?? "")} render={(p, set) => <PosologieItem p={p} onChange={set} />} />;
}
