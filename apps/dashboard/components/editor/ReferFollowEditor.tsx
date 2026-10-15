"use client";

import { STRENGTH_LABEL, URGENCY_LABEL, type FollowUp, type Referral } from "@medguides/schema";
import { useContext } from "react";

import { Line, List, Select, Text, Val } from "./fields";
import { EnvCtx, EvidenceList, TagLine } from "./ItemEditor";

export function Referrals({ items, onChange }: { items: Referral[]; onChange: (v: Referral[]) => void }) {
  const { newId } = useContext(EnvCtx);
  return (
    <List items={items} add="une orientation" onChange={onChange}
      blank={(): Referral => ({ id: newId("ref"), criteria: "", urgency: null, destination: null, strength: null, evidence: [] })}
      render={(r, set, _i, fresh) => (
        <Line id={r.id} blank={fresh}
          summary={
            <>
              <Val value={r.criteria} className="text-ink" /> : adressez <Val value={r.urgency ? URGENCY_LABEL[r.urgency] : null} className="font-medium text-ink" />
              {r.destination ? <> ({r.destination})</> : null}
              <TagLine evidence={r.evidence} strength={r.strength} />
            </>
          }
          form={
            <>
              <span className="font-mono text-xs text-muted">{r.id}</span>
              <Text label="Critères" value={r.criteria} onChange={(criteria) => set({ ...r, criteria })} />
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <Select label="Urgence" value={r.urgency} options={URGENCY_LABEL} onChange={(urgency) => set({ ...r, urgency })} />
                <Text label="Destination" value={r.destination} onChange={(v) => set({ ...r, destination: v || null })} />
                <Select label="Force" value={r.strength} options={STRENGTH_LABEL} onChange={(strength) => set({ ...r, strength })} />
              </div>
              <EvidenceList lineId={r.id} label={r.criteria} value={r.evidence} onChange={(evidence) => set({ ...r, evidence })} />
            </>
          } />
      )} />
  );
}

export function FollowUps({ items, onChange }: { items: FollowUp[]; onChange: (v: FollowUp[]) => void }) {
  const { newId } = useContext(EnvCtx);
  return (
    <List items={items} add="un suivi" onChange={onChange} blank={(): FollowUp => ({ id: newId("fu"), when: "", what: "", evidence: [] })}
      render={(f, set, _i, fresh) => (
        <Line id={f.id} blank={fresh}
          summary={<><Val value={f.when} className="font-medium text-ink" /> : <Val value={f.what} className="text-ink" /><TagLine evidence={f.evidence} strength={null} /></>}
          form={
            <>
              <span className="font-mono text-xs text-muted">{f.id}</span>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                <Text label="Quand" value={f.when} onChange={(when) => set({ ...f, when })} />
                <Text label="Quoi" className="md:col-span-2" value={f.what} onChange={(what) => set({ ...f, what })} />
              </div>
              <EvidenceList lineId={f.id} label={`${f.when} : ${f.what}`} value={f.evidence} onChange={(evidence) => set({ ...f, evidence })} />
            </>
          } />
      )} />
  );
}
