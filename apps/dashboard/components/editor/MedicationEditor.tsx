"use client";

import { doseLine, MEDICATION_FIELD_LABELS, MedicationField, type Medication } from "@avero/schema";

import { DOSE_BASIS_LABEL, PHASE_LABEL, STRENGTH_LABEL } from "@/lib/labels";

import { BrandPicker } from "./BrandPicker";
import { Label, Lines, Select, Text } from "./fields";
import { EvidenceList } from "./ItemEditor";

export const blankMedication = (id: string): Medication => ({
  id, inn: "", phase: null, dose: null, dose_unit: null, dose_basis: null, route: null, frequency: null, duration: null, max_dose: null,
  condition: null, adjustments: [], contraindications: [], alternative_group: null, prescriber: null,
  local_availability: { country: "DZ", status: null, brands: [] }, strength: null, evidence: [], missing: [],
});

/** A medication's fields, under its row when "⋯" is open (the INN is edited in the row). */
export function MedicationDetails({ med, onChange }: { med: Medication; onChange: (v: Medication) => void }) {
  const set = (patch: Partial<Medication>) => onChange({ ...med, ...patch });
  const opt = (s: string) => s.trim() || null;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Select label="Phase" value={med.phase} options={PHASE_LABEL} onChange={(phase) => set({ phase })} />
        <Text label="Dose" type="number" value={med.dose} onChange={(v) => set({ dose: v === "" ? null : Number(v) })} />
        <Text label="Unit" value={med.dose_unit} onChange={(v) => set({ dose_unit: opt(v) })} />
        <Select label="Dose basis" value={med.dose_basis} options={DOSE_BASIS_LABEL} onChange={(dose_basis) => set({ dose_basis })} />
        <Text label="Route" value={med.route} onChange={(v) => set({ route: opt(v) })} />
        <Text label="Frequency" value={med.frequency} onChange={(v) => set({ frequency: opt(v) })} />
        <Text label="Duration" value={med.duration} onChange={(v) => set({ duration: opt(v) })} />
        <Text label="Max dose" value={med.max_dose} onChange={(v) => set({ max_dose: opt(v) })} />
        <Select label="Strength" value={med.strength} options={STRENGTH_LABEL} onChange={(strength) => set({ strength })} />
        <Text label={`Alternatives group ("or")`} value={med.alternative_group} onChange={(v) => set({ alternative_group: opt(v) })} />
        <Text label="Condition (shown as “Si …”)" className="col-span-2" value={med.condition} onChange={(v) => set({ condition: opt(v) })} />
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <Lines label="Adjustments" value={med.adjustments} onChange={(adjustments) => set({ adjustments })} />
        <Lines label="Contraindications" value={med.contraindications} onChange={(contraindications) => set({ contraindications })} />
      </div>
      <div className="flex flex-col gap-1">
        <Label>Not given by the sources (shown “[à compléter]” in the app, never invented)</Label>
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
        <Label>Algerian brands (national nomenclature): optional, with none picked the app lists the INN's registered products</Label>
        <BrandPicker med={med} onChange={set} />
      </div>
      <EvidenceList lineId={med.id} label={`${med.inn} : ${doseLine(med)}`} value={med.evidence} onChange={(evidence) => set({ evidence })} />
    </>
  );
}
