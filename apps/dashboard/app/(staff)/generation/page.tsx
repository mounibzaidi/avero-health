"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ProgressBar, RUNNING } from "@/components/GenerationProgress";
import { Button, Card, Empty, ErrorNote, inputCls, PageHeader, Spinner, Tag } from "@/components/ui";
import { api, apiForm } from "@/lib/api";
import { dateFr } from "@/lib/labels";
import { createClient } from "@/lib/supabase/client";

/** One draft generated from a guideline PDF (services/api/app/fichegen), as listed. */
interface DraftRow {
  id: string; topic_id: string; form: { title: string; source?: { title?: string } }; status: string; stage: string;
  stage_detail: string | null; error: string | null; licence_scope: "internal" | "publish"; coverage_pct: string | null; quote_check: string | null;
  created_at: string;
}
interface Subject { id: string; title: string; template: "urgence" | "pathologie"; specialite: string }

const STAGE: Record<string, string> = {
  uploaded: "PDF reçu", ingesting: "Lecture du PDF", needs_offset: "Pages à numéroter", ready: "En attente", routing: "Répartition",
  parsing: "Tableaux et figures", generating: "Rédaction", checking: "Citations", coverage: "Couverture", done: "Brouillon prêt", error: "Erreur",
};

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

/**
 * Fiche generation: drop a guideline PDF, pick its topic, and generation starts on its own (Haiku, each line checked
 * on the PDF). Drafts are grouped by topic, with their progress; a finished draft opens in its editor.
 */
export default function GenerationPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [topic, setTopic] = useState("");  // a subject id, or "" for a new topic
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<"urgence" | "pathologie">("urgence");
  const [sourceTitle, setSourceTitle] = useState("");
  const [citation, setCitation] = useState("");
  const [scope, setScope] = useState<"internal" | "publish">("internal");
  const [licence, setLicence] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api<DraftRow[]>("/fichegen/drafts").then(setRows, (e) => setError((e as Error).message)), []);
  useEffect(() => {
    void load();
    supabase.from("subjects").select("id,title,template,specialite").order("title").then(({ data }) => setSubjects((data ?? []) as Subject[]));
  }, [load, supabase]);
  const running = rows?.some((r) => RUNNING.has(r.stage)) ?? false;
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [running, load]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return setError("Un fichier PDF est attendu");
    setError(null);
    setFile(f);
    if (!sourceTitle) setSourceTitle(f.name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " "));
  };
  const chosen = subjects.find((s) => s.id === topic);
  const topicId = chosen ? chosen.id : slug(title);
  const ficheTitle = chosen ? chosen.title : title.trim();
  const ok = !!file && !!topicId && !!ficheTitle && !!sourceTitle.trim() && !!citation.trim();

  const submit = async () => {
    if (!file || !ok) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("form", JSON.stringify({
        title: ficheTitle, topic_id: topicId, template: chosen?.template ?? template, audience: ["MG", "urgences"], siblings: [],
        source: { source_id: `${topicId}-${new Date().getFullYear()}`.slice(0, 64), type: "full_guideline", title: sourceTitle.trim(), citation: citation.trim() },
        licence_text: licence.trim(), licence_scope: scope, auto_generate: true,
      }));
      const d = await apiForm<DraftRow>("/fichegen/drafts", body);
      router.push(`/generation/${d.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  // drafts by topic, the topic of the latest draft first
  const groups = useMemo(() => {
    const m = new Map<string, DraftRow[]>();
    for (const r of rows ?? []) m.set(r.topic_id, [...(m.get(r.topic_id) ?? []), r]);
    return [...m.entries()];
  }, [rows]);
  const titleOf = (id: string, fallback: string) => subjects.find((s) => s.id === id)?.title ?? fallback;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-8 px-5 py-8">
      <PageHeader title="Génération de fiches"
        subtitle="Déposez une recommandation : chaque ligne de la fiche est rédigée puis retrouvée mot pour mot dans le PDF."
        actions={rows && (
          <div className="flex gap-2 text-xs">
            <Tag>{rows.length} brouillon(s)</Tag>
            {running && <Tag tone="caution">{rows.filter((r) => RUNNING.has(r.stage)).length} en cours</Tag>}
            <Tag tone="accent">{rows.filter((r) => r.stage === "done").length} prêt(s)</Tag>
          </div>
        )} />
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <button type="button" onClick={() => input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
            className={`flex min-h-64 flex-col items-center justify-center gap-3 border-b border-line p-8 text-center transition-colors lg:border-b-0 lg:border-r ${
              drag ? "bg-tint" : file ? "bg-tint/50" : "bg-panel/40 hover:bg-panel/70"}`}>
            <span className={`flex size-14 items-center justify-center rounded-2xl ${file ? "bg-accent text-white" : "bg-surface text-accentink shadow-surface"}`}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                {file ? <path d="M20 6 9 17l-5-5" /> : <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3" /></>}
              </svg>
            </span>
            {file ? (
              <>
                <p className="max-w-full truncate text-sm font-semibold text-ink">{file.name}</p>
                <p className="text-xs text-muted">{(file.size / 1e6).toFixed(1)} Mo · cliquer pour changer</p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-ink">Déposer le PDF de la recommandation</p>
                <p className="text-xs text-muted">ou cliquer pour le choisir</p>
              </>
            )}
            <input ref={input} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </button>

          <div className="flex flex-col gap-4 p-6">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-soft">Sujet</span>
              <select className={inputCls} value={topic} onChange={(e) => setTopic(e.target.value)}>
                <option value="">Nouveau sujet…</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </label>
            {!chosen && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-soft">Titre de la fiche</span>
                  <input className={inputCls} placeholder="Syndrome coronarien aigu : prise en charge initiale" value={title} onChange={(e) => setTitle(e.target.value)} />
                  {title && <span className="font-mono text-[11px] text-muted">{topicId}</span>}
                </label>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-soft">Modèle</span>
                  <Segmented value={template} onChange={setTemplate} options={[["urgence", "Urgence"], ["pathologie", "Pathologie"]]} />
                </div>
              </div>
            )}
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-soft">Titre de la recommandation</span>
              <input className={inputCls} placeholder="2025 ACC/AHA Guideline for the Management of Patients With Acute Coronary Syndromes" value={sourceTitle} onChange={(e) => setSourceTitle(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-soft">Citation (qui a réellement écrit le document)</span>
              <input className={inputCls} placeholder="Rao SV et al. J Am Coll Cardiol. 2025;85(22):2135-2237" value={citation} onChange={(e) => setCitation(e.target.value)} />
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented value={scope} onChange={setScope} options={[["internal", "Usage interne"], ["publish", "Publication autorisée"]]} />
              <button type="button" className="text-xs text-accentink hover:underline" onClick={() => setMore((m) => !m)}>{more ? "Moins d'options" : "Licence…"}</button>
            </div>
            {more && <input className={inputCls} placeholder="Texte de la licence (© ACC/AHA : copie et modification interdites…)" value={licence} onChange={(e) => setLicence(e.target.value)} />}
            <div className="mt-auto flex items-center gap-3 pt-2">
              <Button variant="primary" className="h-10 px-5" disabled={!ok || busy} onClick={submit}>{busy ? <Spinner /> : "Générer la fiche"}</Button>
              <span className="text-xs text-muted">Environ 2 minutes · quelques centimes</span>
            </div>
          </div>
        </div>
      </Card>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">Par sujet</h2>
        {!rows ? <div className="flex justify-center py-8 text-muted"><Spinner /></div> : groups.length === 0 ? <Empty>Aucun brouillon pour l&apos;instant.</Empty> : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {groups.map(([tid, drafts]) => (
              <Card key={tid} className="flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-sm font-semibold text-ink">{titleOf(tid, drafts[0].form?.title ?? tid)}</h3>
                    <p className="font-mono text-[11px] text-muted">{tid}</p>
                  </div>
                  <Tag>{drafts.length} brouillon(s)</Tag>
                </div>
                <ul className="flex flex-col gap-1">
                  {drafts.map((r) => (
                    <li key={r.id}>
                      <Link href={`/generation/${r.id}`} className="flex flex-col gap-1.5 rounded-lg px-2 py-2 hover:bg-panel/60">
                        <div className="flex items-center gap-2 text-xs">
                          <span className={`font-medium ${r.stage === "error" ? "text-flag" : r.stage === "done" ? "text-accentink" : "text-ink"}`}>{STAGE[r.stage] ?? r.stage}</span>
                          {RUNNING.has(r.stage) && <Spinner className="size-3 text-muted" />}
                          <span className="min-w-0 flex-1 truncate text-muted">{r.form?.source?.title}</span>
                          <span className="shrink-0 text-muted">{dateFr(r.created_at)}</span>
                        </div>
                        <ProgressBar stage={r.stage} />
                        {r.stage === "done" && (
                          <div className="flex flex-wrap gap-1.5">
                            {r.quote_check && <Tag tone="accent">citations {r.quote_check}</Tag>}
                            {r.coverage_pct && <Tag tone={Number(r.coverage_pct) >= 90 ? "accent" : "caution"}>couverture {r.coverage_pct} %</Tag>}
                            <Tag>{r.status}</Tag>
                            {r.licence_scope === "internal" && <Tag>usage interne</Tag>}
                          </div>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="inline-flex h-9 rounded-lg border border-edge/15 bg-panel p-0.5 text-sm">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)}
          className={`rounded-md px-3 transition-colors ${value === v ? "bg-surface font-medium text-ink shadow-surface" : "text-soft hover:text-ink"}`}>{label}</button>
      ))}
    </div>
  );
}
