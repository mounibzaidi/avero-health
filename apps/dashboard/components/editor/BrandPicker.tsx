"use client";

import type { AvailabilityStatus, Medication, Prescriber } from "@avero/schema";
import { useMemo, useState } from "react";

import { AVAILABILITY_LABEL, PRESCRIBER_LABEL, TO_COMPLETE } from "@/lib/labels";
import { Button, inputCls, Spinner } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/** One brand of the national nomenclature, its presentations merged. */
type Brand = {
  name: string;
  dci: string;
  statut: "enregistre" | "non_renouvele" | "retire";
  officine: boolean;
  hopital: boolean;
  presentations: string[];
};
type Row = { nom_marque: string; dci_brut: string; forme: string | null; dosage: string | null; statut: Brand["statut"]; officine: boolean; hopital: boolean };

const RANK: Record<Brand["statut"], number> = { enregistre: 0, non_renouvele: 1, retire: 2 };

function merge(rows: Row[]): Brand[] {
  const out = new Map<string, Brand>();
  for (const r of rows) {
    const b = out.get(r.nom_marque) ?? { name: r.nom_marque, dci: r.dci_brut, statut: r.statut, officine: false, hopital: false, presentations: [] };
    if (RANK[r.statut] < RANK[b.statut]) b.statut = r.statut;
    b.officine ||= r.officine && r.statut === "enregistre";
    b.hopital ||= r.hopital && r.statut === "enregistre";
    const p = [r.forme, r.dosage].filter(Boolean).join(" ");
    if (p && !b.presentations.includes(p)) b.presentations.push(p);
    out.set(r.nom_marque, b);
  }
  return [...out.values()].sort((a, b) => RANK[a.statut] - RANK[b.statut] || a.name.localeCompare(b.name, "fr"));
}

/**
 * Status and prescriber from the ticked brands, never typed. Status: the best of the ticked brands (registered, else
 * not renewed, else withdrawn). Prescriber: officine when a ticked registered brand is sold in officine, else hôpital.
 */
export function derive(ticked: Brand[]): { status: AvailabilityStatus; prescriber: Prescriber | null } {
  const best = ticked.reduce<Brand["statut"]>((s, b) => (RANK[b.statut] < RANK[s] ? b.statut : s), "retire");
  const pool = ticked.filter((b) => b.statut === best);
  const prescriber: Prescriber | null = pool.some((b) => b.officine) ? "officine" : pool.some((b) => b.hopital) ? "hopital" : null;
  return { status: best, prescriber };
}

/**
 * Brands of a medication from the national nomenclature: the view medicaments_officine (registered, sold in officine)
 * first; with no match there, the whole nomenclature (hospital only, not renewed, withdrawn). Nothing at all: the status
 * is "aucune_presentation". I tick the brands; status and prescriber follow.
 */
export function BrandPicker({ med, onChange }: { med: Medication; onChange: (patch: Partial<Medication>) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const [q, setQ] = useState(med.inn);
  const [found, setFound] = useState<{ q: string; from: "officine" | "nomenclature"; brands: Brand[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticked = new Set(med.local_availability.brands);

  const search = async () => {
    const term = q.trim();
    if (!term) return;
    setBusy(true);
    setError(null);
    const cols = "nom_marque,dci_brut,forme,dosage,statut,officine,hopital";
    const like = `%${term.replace(/[%_]/g, "")}%`;
    try {
      const off = await supabase.from("medicaments_officine").select(cols).ilike("dci_brut", like).limit(500);
      if (off.error) throw off.error;
      if (off.data.length) return setFound({ q: term, from: "officine", brands: merge(off.data as Row[]) });
      const all = await supabase.from("nomenclature").select(cols).ilike("dci_brut", like).limit(500);
      if (all.error) throw all.error;
      setFound({ q: term, from: "nomenclature", brands: merge(all.data as Row[]) });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (name: string) => {
    if (!found) return;
    const names = ticked.has(name) ? med.local_availability.brands.filter((b) => b !== name) : [...med.local_availability.brands, name];
    const chosen = found.brands.filter((b) => names.includes(b.name));
    const d = chosen.length ? derive(chosen) : { status: null, prescriber: null };
    onChange({ prescriber: d.prescriber, local_availability: { ...med.local_availability, brands: names, status: d.status } });
  };

  const none = () => onChange({ prescriber: null, local_availability: { ...med.local_availability, brands: [], status: "aucune_presentation" } });

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-panel/60 p-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Search the INN in the nomenclature</span>
          <input className={`${inputCls} w-64`} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void search())} />
        </label>
        <Button className="h-9" onClick={search} disabled={busy || !q.trim()}>{busy ? <Spinner /> : "Chercher"}</Button>
        <div className="pb-2 text-xs text-soft">
          Status: <b className="text-ink">{med.local_availability.status ? AVAILABILITY_LABEL[med.local_availability.status] : TO_COMPLETE}</b>
          {" · "}Prescriber: <b className="text-ink">{med.prescriber ? PRESCRIBER_LABEL[med.prescriber] : med.local_availability.status === "aucune_presentation" ? "not applicable" : TO_COMPLETE}</b>
        </div>
      </div>
      {error && <p className="text-xs text-flag">{error}</p>}
      {found && (
        found.brands.length === 0 ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-caution">No presentation of “{found.q}” in the nomenclature.</span>
            {med.local_availability.status !== "aucune_presentation" && <Button className="h-8" onClick={none}>Mark “no presentation”</Button>}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <p className="text-xs text-muted">
              {found.from === "officine" ? "Registered and available in pharmacies (medicaments_officine)" : "None in pharmacies: the whole nomenclature (hospital, not renewed, withdrawn)"}
              {" · "}{found.brands.length} brand(s). Tick the ones to show.
            </p>
            <div className="grid max-h-64 grid-cols-1 gap-x-4 overflow-auto md:grid-cols-2">
              {found.brands.map((b) => (
                <label key={b.name} className="flex items-start gap-2 py-0.5 text-sm">
                  <input type="checkbox" className="mt-1" checked={ticked.has(b.name)} onChange={() => toggle(b.name)} />
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{b.name}</span>
                    <span className="ms-1 text-xs text-muted">
                      {[b.officine ? "OFF" : null, b.hopital ? "HOP" : null].filter(Boolean).join("/") || "non disponible"}
                      {b.statut !== "enregistre" ? ` · ${AVAILABILITY_LABEL[b.statut]}` : ""}
                      {" · "}{b.presentations.join(", ")}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )
      )}
      {med.local_availability.brands.length > 0 && (
        <p className="text-xs text-soft">Brands kept: <span className="text-ink">{med.local_availability.brands.join(", ")}</span>{!found && " (search to change)"}</p>
      )}
    </div>
  );
}
