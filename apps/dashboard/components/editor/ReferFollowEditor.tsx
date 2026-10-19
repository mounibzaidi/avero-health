"use client";

import type { FollowUp, Referral } from "@avero/schema";

import { STRENGTH_LABEL } from "@/lib/labels";

import { Select } from "./fields";
import { EvidenceList } from "./ItemEditor";

/** A referral's strength and evidence, under its row when "⋯" is open (criteria, urgency, destination are in the row). */
export function ReferralDetails({ r, onChange }: { r: Referral; onChange: (v: Referral) => void }) {
  return (
    <>
      <Select label="Strength" className="w-48" value={r.strength} options={STRENGTH_LABEL} onChange={(strength) => onChange({ ...r, strength })} />
      <EvidenceList lineId={r.id} label={r.criteria} value={r.evidence} onChange={(evidence) => onChange({ ...r, evidence })} />
    </>
  );
}

/** A follow-up's evidence, under its row when "⋯" is open. */
export const FollowUpDetails = ({ f, onChange }: { f: FollowUp; onChange: (v: FollowUp) => void }) =>
  <EvidenceList lineId={f.id} label={`${f.when} : ${f.what}`} value={f.evidence} onChange={(evidence) => onChange({ ...f, evidence })} />;
