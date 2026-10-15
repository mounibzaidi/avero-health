"use client";

import {
  doseLine, DOSE_BASIS_LABEL, MEDICATION_FIELD_LABELS, MedicationField, PHASE_LABEL, PRESCRIBER_LABEL, STRENGTH_LABEL, TO_COMPLETE, type Medication,
} from "@medguides/schema";
import { useContext } from "react";

import { Tag } from "@/components/ui";

import { BrandPicker } from "./BrandPicker";
import { Label, Line, Lines, List, Select, Text, Val } from "./fields";
import { EnvCtx, EvidenceList, TagLine } from "./ItemEditor";

export const blankMedication = (id: string): Medication => ({
  id, inn: "", phase: null, dose: null, dose_unit: null, dose_basis: null, route: null, frequency: null, duration: null, max_dose: null,
  condition: null, adjustments: [], contraindications: [], alternative_group: null, prescriber: null,
  local_availability: { country: "DZ", status: null, brands: [] }, strength: null, evidence: [], missing: [],
});

export function MedicationEditor({ med, onChange, fresh }: { med: Medication; onChange: (v: Medication) => void; fresh?: boolean }) {
  const set = (patch: Partial<Medication>) => onChange({ ...med, ...patch });
  const opt = (s: string) => s.trim() || null;
  return (
    <Line id={med.id} blank={fresh}
      summary={
        <div className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <Val value={med.inn} className="font-semibold text-ink" />
            {med.phase && <span className="text-xs text-soft">{PHASE_LABEL[med.phase]}</span>}
            {med.prescriber && <Tag tone={med.prescriber === "hopital" ? "caution" : "accent"}>{PRESCRIBER_LABEL[med.prescriber]}</Tag>}
            {med.alternative_group && <span className="text-xs text-muted">groupe « {med.alternative_group} »</span>}
          </div>
          <div className="text-ink">{doseLine(med)}</div>
          <div className="text-xs text-muted">
            {med.local_availability.brands.length ? med.local_availability.brands.join(", ") : med.local_availability.status === "aucune_presentation" ? "Aucune présentation en Algérie" : `Marques ${TO_COMPLETE}`}
            <TagLine evidence={med.evidence} strength={med.strength} />
          </div>
        </div>
      }
      form={
        <>
          <span className="font-mono text-xs text-muted">{med.id}</span>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Text label="DCI" className="col-span-2" value={med.inn} onChange={(inn) => set({ inn })} />
            <Select label="Phase" value={med.phase} options={PHASE_LABEL} onChange={(phase) => set({ phase })} />
            <Select label="Force" value={med.strength} options={STRENGTH_LABEL} onChange={(strength) => set({ strength })} />
            <Text label="Dose" type="number" value={med.dose} onChange={(v) => set({ dose: v === "" ? null : Number(v) })} />
            <Text label="Unité" value={med.dose_unit} onChange={(v) => set({ dose_unit: opt(v) })} />
            <Select label="Base de dose" value={med.dose_basis} options={DOSE_BASIS_LABEL} onChange={(dose_basis) => set({ dose_basis })} />
            <Text label="Voie" value={med.route} onChange={(v) => set({ route: opt(v) })} />
            <Text label="Fréquence" value={med.frequency} onChange={(v) => set({ frequency: opt(v) })} />
            <Text label="Durée" value={med.duration} onChange={(v) => set({ duration: opt(v) })} />
            <Text label="Dose maximale" value={med.max_dose} onChange={(v) => set({ max_dose: opt(v) })} />
            <Text label="Groupe d'alternatives (« ou »)" value={med.alternative_group} onChange={(v) => set({ alternative_group: opt(v) })} />
            <Text label="Condition" className="col-span-2 md:col-span-4" value={med.condition} onChange={(v) => set({ condition: opt(v) })} />
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <Lines label="Adaptations" value={med.adjustments} onChange={(adjustments) => set({ adjustments })} />
            <Lines label="Contre-indications" value={med.contraindications} onChange={(contraindications) => set({ contraindications })} />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Non donné par les sources (affiché « {TO_COMPLETE} », jamais inventé)</Label>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {MedicationField.options.map((f) => (
                <label key={f} className="flex items-center gap-1.5 text-sm text-soft">
                  <input type="checkbox" checked={med.missing.includes(f)}
                    onChange={(e) => set({ missing: e.target.checked ? [...med.missing, f] : med.missing.filter((x) => x !== f) })} />
                  {MEDICATION_FIELD_LABELS[f]}
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Marques algériennes (nomenclature nationale)</Label>
            <BrandPicker med={med} onChange={set} />
          </div>
          <EvidenceList lineId={med.id} label={`${med.inn} : ${doseLine(med)}`} value={med.evidence} onChange={(evidence) => set({ evidence })} />
        </>
      } />
  );
}

export function Medications({ items, onChange }: { items: Medication[]; onChange: (v: Medication[]) => void }) {
  const { newId } = useContext(EnvCtx);
  return (
    <List items={items} add="un médicament" onChange={onChange} blank={() => blankMedication(newId("med"))}
      render={(m, set, _i, fresh) => <MedicationEditor med={m} onChange={set} fresh={fresh} />} />
  );
}
