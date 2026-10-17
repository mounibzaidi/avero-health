"use client";

import { TEMPLATE_LABEL, type ChangeLogEntry, type Meta, type Review, type Scope, type Source } from "@medguides/schema";
import { useEffect, useState } from "react";

import { inputCls } from "@/components/ui";
import { api, apiForm } from "@/lib/api";

import { Ids, Label, LineIssues, Lines, List, Text } from "./fields";

export function MetaEditor({ meta, scope, onMeta, onScope }: { meta: Meta; scope: Scope; onMeta: (m: Meta) => void; onScope: (s: Scope) => void }) {
  const set = (patch: Partial<Meta>) => onMeta({ ...meta, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <Text label="Titre" className="md:col-span-2" value={meta.title} onChange={(title) => set({ title })} />
        <label className="flex flex-col gap-1">
          <Label>Modèle</Label>
          <select className={inputCls} value={meta.template} onChange={(e) => set({ template: e.target.value as Meta["template"] })}>
            {Object.entries(TEMPLATE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <Text label="Spécialité" value={meta.specialite} onChange={(specialite) => set({ specialite })} />
        <Text label="Version (x.y.z)" value={meta.version} onChange={(version) => set({ version })} />
        <Text label="Pays" value={meta.country} onChange={(country) => set({ country })} />
        <Text label="Langue" value={meta.language} onChange={(language) => set({ language })} />
        <Ids label="Public (ex. MG)" value={meta.audience} onChange={(audience) => set({ audience })} />
        <Text label="Dernière relecture" type="date" value={meta.last_reviewed_at} onChange={(v) => set({ last_reviewed_at: v || null })} />
        <Text label="Prochaine relecture" type="date" value={meta.next_review_at} onChange={(v) => set({ next_review_at: v || null })} />
      </div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <Lines label="Motifs de consultation" value={meta.motifs} onChange={(motifs) => set({ motifs })} />
        <Text label="Population" value={scope.population} onChange={(v) => onScope({ ...scope, population: v || null })} />
        <Lines label="Exclusions" value={scope.exclusions} onChange={(exclusions) => onScope({ ...scope, exclusions })} />
      </div>
    </div>
  );
}

/**
 * The fiche's sources, and the stored PDF of each, used by the quote check: a PDF uploaded here (kept with the fiche,
 * fiches/<id>/) or one kept in a Collecte topic. The PDF link is kept in the table source_pdfs, not in the fiche: it
 * is saved at once.
 */
export function SourcesEditor({ sources, onChange, topic, pdfs, onPdf }: {
  sources: Source[]; onChange: (v: Source[]) => void; topic: string; pdfs: Record<string, string>; onPdf: (sourceId: string, path: string | null) => void;
}) {
  const [folder, setFolder] = useState("");
  const [files, setFiles] = useState<{ path: string; title: string }[]>([]);
  const [own, setOwn] = useState<{ path: string; title: string }[]>([]);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pdfsOnly = (t: { files: { path: string | null; title: string }[] }) => t.files.filter((x): x is { path: string; title: string } => !!x.path);
  const loadOwn = () => api<{ files: { path: string | null; title: string }[] }>(`/crawl/fiches/${encodeURIComponent(topic)}/files`)
    .then((t) => setOwn(pdfsOnly(t)), () => setOwn([]));
  useEffect(() => {
    void loadOwn();
  }, [topic]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!folder.trim()) return;
    void api<{ files: { path: string | null; title: string }[] }>(`/crawl/topics/${encodeURIComponent(folder.trim())}`)
      .then((t) => setFiles(pdfsOnly(t)), () => setFiles([]));
  }, [folder]);
  const topicFiles = folder.trim() ? files : [];
  const choices = [...own, ...topicFiles.filter((x) => !own.some((o) => o.path === x.path))];
  /** Store the chosen PDF with the fiche, then link it to the source. */
  const upload = async (sourceId: string, file: File | undefined) => {
    if (!file) return;
    setUploading(sourceId);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { path } = await apiForm<{ path: string }>(`/crawl/fiches/${encodeURIComponent(topic)}/upload`, form);
      await loadOwn();
      onPdf(sourceId, path);
    } catch (e) {
      setError(`Téléversement impossible : ${(e as Error).message}`);
    } finally {
      setUploading(null);
    }
  };
  const title = (t: string) => { try { return decodeURIComponent(t); } catch { return t; } };

  return (
    <div className="flex flex-col gap-2">
      <Text label="Thème Collecte (facultatif) : proposer aussi ses PDF" className="w-80" value={folder} onChange={setFolder} />
      {error && <p className="text-xs text-flag">{error}</p>}
      <List items={sources} add="une source" onChange={onChange}
        blank={(): Source => ({ id: "", title: "", organisation: "", citation: "", url: null, publication_date: null, page_offset: 0, accessed_at: new Date().toISOString().slice(0, 10) })}
        render={(s, set) => (
          <div id={`line-${s.id}`} className="my-1 grid scroll-mt-20 grid-cols-1 gap-2 rounded-lg bg-panel/60 p-2 md:grid-cols-4">
            <Text label="Identifiant (cité par les preuves)" mono value={s.id} onChange={(id) => set({ ...s, id })} />
            <Text label="Organisation (nom court affiché)" value={s.organisation} onChange={(organisation) => set({ ...s, organisation })} />
            <Text label="Titre" className="md:col-span-2" value={s.title} onChange={(t) => set({ ...s, title: t })} />
            <Text label="Citation" className="md:col-span-2" value={s.citation} onChange={(citation) => set({ ...s, citation })} />
            <Text label="Lien (DOI ou URL)" className="md:col-span-2" value={s.url} onChange={(v) => set({ ...s, url: v || null })} />
            <Text label="Date de publication" type="date" value={s.publication_date} onChange={(v) => set({ ...s, publication_date: v || null })} />
            <Text label="Consultée le" type="date" value={s.accessed_at} onChange={(v) => set({ ...s, accessed_at: v || null })} />
            <Text label="Décalage de page (PDF moins imprimée)" type="number" value={s.page_offset} onChange={(v) => set({ ...s, page_offset: Math.trunc(Number(v) || 0) })} />
            <label className="flex flex-col gap-1 md:col-span-3">
              <Label>PDF stocké (enregistré tout de suite)</Label>
              <select className={inputCls} value={pdfs[s.id] ?? ""} disabled={!s.id} onChange={(e) => onPdf(s.id, e.target.value || null)}>
                <option value="">{choices.length ? "Aucun" : "Aucun PDF : téléversez-le à droite"}</option>
                {choices.map((x) => <option key={x.path} value={x.path}>{title(x.title)}</option>)}
                {pdfs[s.id] && !choices.some((x) => x.path === pdfs[s.id]) && <option value={pdfs[s.id]}>{pdfs[s.id]}</option>}
              </select>
            </label>
            <label className={`flex items-end ${!s.id ? "pointer-events-none opacity-50" : "cursor-pointer"}`} title={s.id ? undefined : "Donnez d'abord un identifiant à la source"}>
              <span className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-panel">
                {uploading === s.id ? "Téléversement…" : "Téléverser un PDF"}
              </span>
              <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={!s.id || !!uploading}
                onChange={(e) => { void upload(s.id, e.target.files?.[0]); e.target.value = ""; }} />
            </label>
            <div className="md:col-span-4"><LineIssues id={s.id} /></div>
          </div>
        )} />
    </div>
  );
}

export function ReviewEditor({ review, onChange, me }: { review: Review; onChange: (r: Review) => void; me: string }) {
  const set = (patch: Partial<Review>) => onChange({ ...review, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
        <Text label="Médecin relecteur" value={review.reviewer} onChange={(v) => set({ reviewer: v || null })} />
        <Text label="Relu le" type="date" value={review.reviewed_at} onChange={(v) => set({ reviewed_at: v || null })} />
        <label className="flex items-center gap-2 pt-5 text-sm font-medium text-ink">
          <input type="checkbox" checked={review.clinical_approval}
            onChange={(e) => set({ clinical_approval: e.target.checked, reviewer: review.reviewer ?? (me || null), reviewed_at: review.reviewed_at ?? new Date().toISOString().slice(0, 10) })} />
          Validation clinique (j&apos;approuve cette fiche)
        </label>
      </div>
      <LineIssues id={null} />
      <Lines label="Points non résolus (sources en conflit)" value={review.unresolved_issues} onChange={(unresolved_issues) => set({ unresolved_issues })} />
      <div className="flex flex-col gap-1">
        <Label>Journal des modifications</Label>
        <List items={review.change_log} add="une entrée" onChange={(change_log) => set({ change_log })}
          blank={(): ChangeLogEntry => ({ date: new Date().toISOString().slice(0, 10), by: me, summary: "" })}
          render={(c, setC) => (
            <div className="my-1 grid grid-cols-1 gap-2 md:grid-cols-4">
              <Text type="date" value={c.date} onChange={(date) => setC({ ...c, date })} />
              <Text value={c.by} onChange={(by) => setC({ ...c, by })} />
              <Text className="md:col-span-2" value={c.summary} onChange={(summary) => setC({ ...c, summary })} />
            </div>
          )} />
      </div>
    </div>
  );
}
