"use client";

import { elements, SECTION_KEYS, validateFiche, type Fiche, type Finding, type SectionKey, type ValidateContext } from "@medguides/schema";
import { useState } from "react";

import { Button, ButtonLink, Card, ErrorNote, inputCls, Spinner, Tag } from "@/components/ui";
import { dateFr } from "@/lib/labels";

export type FicheRow = { id: string; latest: { version: number; content: Fiche; publishedAt: string | null }; published: number | null };

const SECTION: Record<SectionKey, string> = {
  "1_essentiel": "Essentiel", "2_presentation": "Présentation", "3_champ": "Champ", "4_gravite": "Gravité", "5_conduite": "Conduite",
  "6_examens": "Examens", "7_traitement": "Traitement", "8_ne_pas_faire": "Ne pas faire", "9_orientation": "Orientation",
  "10_surveillance": "Surveillance", "11_suivi": "Suivi", "12_ordonnance": "Ordonnance", "13_definitions": "Définitions",
};
const STATE: Record<string, { label: string; cls: string }> = {
  filled: { label: "rempli", cls: "bg-accent" },
  sans_objet: { label: "sans objet", cls: "bg-edge/20" },
  non_traité: { label: "non traité par la source", cls: "bg-caution" },
};

/** The 13 sections of the numbered schema, one bar each. */
function Completeness({ f }: { f: Fiche }) {
  return (
    <div>
      <div className="flex gap-1">
        {SECTION_KEYS.map((k) => {
          const st = STATE[f.sections[k].state];
          return <div key={k} title={`${SECTION[k]} : ${st.label}`} className={`h-2.5 flex-1 rounded-sm ${st.cls}`} />;
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] leading-tight text-muted">
        {SECTION_KEYS.map((k) => (
          <span key={k} className="flex-1 truncate text-center" title={SECTION[k]}>{SECTION[k]}</span>
        ))}
      </div>
    </div>
  );
}

function Row({ label, tone, children }: { label: string; tone?: "ok" | "warn" | "bad"; children: React.ReactNode }) {
  const ink = tone === "bad" ? "text-flag" : tone === "warn" ? "text-caution" : tone === "ok" ? "text-accent" : "text-ink";
  return (
    <div className="flex gap-3 border-t border-line py-2 text-sm">
      <div className="w-40 shrink-0 text-muted">{label}</div>
      <div className={`min-w-0 flex-1 ${ink}`}>{children}</div>
    </div>
  );
}

/** Findings grouped by message: "Risque élevé : à relire individuellement (59) · sca-001, sca-002…". */
function Findings({ items }: { items: Finding[] }) {
  const groups = new Map<string, Finding[]>();
  for (const f of items) groups.set(f.message, [...(groups.get(f.message) ?? []), f]);
  return (
    <ul className="list-disc space-y-1 ps-4">
      {[...groups].map(([message, fs]) => {
        const ids = fs.map((f) => f.element ?? f.path).filter(Boolean) as string[];
        return (
          <li key={message}>
            <span className="font-medium">{message}</span>
            {fs.length > 1 ? ` (${fs.length})` : ""}
            {ids.length ? <span className="ms-1 font-mono text-xs text-soft">{ids.slice(0, 6).join(", ")}{ids.length > 6 ? "…" : ""}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** A fiche of the hub: what its latest version holds, what blocks its publication, and the gate. */
export function FicheCard({ row, ctx, canPublish, defaultReviewer, onPublish, outdated }: {
  row: FicheRow; ctx: ValidateContext; canPublish: boolean; defaultReviewer: string; onPublish: (content: Fiche) => Promise<void>;
  /** The fiche's source guidelines that the registry marks replaced. */
  outdated?: string[];
}) {
  const [doctor, setDoctor] = useState(defaultReviewer);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const f = row.latest.content;
  const m = f.meta;
  const isPublished = row.latest.publishedAt !== null;
  const now = new Date().toISOString();
  // What publishing would save: this version, signed by the reviewer today.
  const candidate: Fiche = { ...f, meta: { ...m, status: "published", reviewer: doctor.trim() || null, reviewed_at: now } };
  const current = validateFiche(f, ctx);
  const gate = validateFiche(candidate, ctx);
  const lines = [...elements(f)].length + f.sections["7_traitement"].posologies.length;

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      await onPublish(candidate);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-ink">{m.title}</h2>
        <Tag tone={m.template === "urgence" ? "urgent" : "neutral"}>{m.template}</Tag>
        <Tag tone={isPublished ? "accent" : "neutral"}>{isPublished ? "publié" : row.published ? `brouillon (v${row.published} publiée)` : "brouillon"}</Tag>
        <Tag>v{row.latest.version}</Tag>
        <span className="min-w-0 flex-1 text-xs text-muted">{lines} lignes · {m.specialite} · {m.sources[0]?.citation}</span>
        <ButtonLink className="h-8" href={`/fiche/${row.id}`}>Ouvrir et modifier</ButtonLink>
      </div>
      {outdated && outdated.length > 0 && (
        <p className="mb-3 rounded-lg bg-flagbg px-3 py-2 text-sm font-medium text-flag">Source mise à jour, fiche à revoir : {outdated.join(" ; ")}</p>
      )}
      <Completeness f={f} />
      <div className="mt-3">
        <Row label="Bloquant" tone={current.failures.length ? "bad" : "ok"}>{current.failures.length ? <Findings items={current.failures} /> : "Aucun"}</Row>
        {current.warnings.length > 0 && <Row label="À vérifier" tone="warn"><Findings items={current.warnings} /></Row>}
        <Row label="Relecture" tone={m.reviewer ? "ok" : undefined}>
          {m.reviewer && m.reviewed_at ? `Vérifié par ${m.reviewer} le ${dateFr(m.reviewed_at)}` : "En attente d'un médecin"}
        </Row>
      </div>
      {canPublish && !isPublished && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <input value={doctor} onChange={(e) => setDoctor(e.target.value)} placeholder="Médecin relecteur (Dr …)" className={`${inputCls} w-64`} />
          <Button variant="primary" disabled={busy || !doctor.trim() || gate.failures.length > 0} onClick={publish}>
            {busy ? <Spinner /> : "Publier"}
          </Button>
          {gate.failures.length > 0 && <span className="text-sm text-flag">{gate.failures.length} point(s) bloquant(s)</span>}
        </div>
      )}
      {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
    </Card>
  );
}
