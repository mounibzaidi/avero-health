"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, Card, Empty, ErrorNote, inputCls, PageHeader, Spinner, Tag } from "@/components/ui";
import { api, apiForm } from "@/lib/api";
import { dateFr } from "@/lib/labels";
import { createClient } from "@/lib/supabase/client";

// Collecte: the source guidelines of each topic. The search asks the literature APIs (PubMed, Europe PMC) and the
// listing pages of the French and Algerian bodies (services/crawler/literature.py); results are grouped into
// guideline families (newest version first). Every PDF kept is in the "sources" bucket with its provenance.

interface Topic { id: string; fr: string; group: string; section: string; priority: number | null }
interface StoredFile { path: string | null; title: string; bytes: number | null; document_url: string | null; fetched_at: string | null; licence: string | null; scraper: string | null; link_only?: boolean }
export interface Rec {
  pmid: string | null; title: string; journal: string; url: string; doi: string | null; pdf_url: string | null; kind: "guideline" | "consensus" | "article";
  why: string; body: string | null; body_name: string | null; version_year: number | null; version?: "actuelle" | "antérieure"; on_listing?: boolean; official?: boolean;
  also_in?: { journal: string; url: string }[];
}
export interface Family { body: string | null; versions: Rec[]; newer_elsewhere?: { body: string; year: number; title: string } }
interface SourceStatus { id: string; name: string; status: "ok" | "ajout manuel" | "erreur"; reason: string | null; url?: string; entries: number }
export interface Result { query?: string | null; families: Family[]; articles: Rec[]; sources: SourceStatus[]; searched_at?: string; error?: string }
interface TopicView { id: string; fr: string; group: string; files: StoredFile[]; search: Result | null }
interface Job { id: string; status: "running" | "succeeded" | "partial" | "failed"; stage: string; error: string | null; stored: string[]; link_only?: boolean; title?: string }

const KIND = { guideline: "Recommandation", consensus: "Consensus", article: "Article" } as const;
const decoded = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const kb = (n: number | null) => (n ? `${Math.max(1, Math.round(n / 1024))} Ko` : "");

/** One version of a guideline: title, kind, body, year, where it was found, and how to keep it. */
function Version({ r, older, onKeep, busy }: { r: Rec; older?: boolean; onKeep: (link: string, single: boolean) => void; busy: boolean }) {
  return (
    <div className={`flex items-start gap-3 py-2 ${older ? "ps-4 opacity-75" : ""}`}>
      <div className="min-w-0 flex-1">
        <a href={r.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-ink hover:underline">{r.title}</a>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {older ? <Tag>Version antérieure</Tag> : <Tag tone={r.kind === "guideline" ? "accent" : r.kind === "consensus" ? "caution" : "neutral"}>{KIND[r.kind]}</Tag>}
          <span className="font-medium text-soft">{r.body_name ?? "Organisme non identifié"}</span>
          {r.version_year && <span>· {r.version_year}</span>}
          <span>· {r.on_listing ? "page officielle de l'organisme" : r.journal}</span>
          {r.pdf_url && <Tag tone="accent">PDF libre</Tag>}
          {r.also_in?.length ? <span title={r.also_in.map((a) => a.journal).join(", ")}>· aussi publié dans {r.also_in.length} autre(s) revue(s)</span> : null}
          <span title={r.why} className="cursor-help underline decoration-dotted">pourquoi</span>
        </div>
      </div>
      {r.pdf_url ? (
        <Button className="h-8 shrink-0 text-xs" disabled={busy} title="Télécharge le PDF et l'ajoute aux sources du thème" onClick={() => onKeep(r.pdf_url!, true)}>Télécharger le PDF</Button>
      ) : r.doi ? (
        <Button className="h-8 shrink-0 text-xs" disabled={busy} title="Garde la référence (DOI) dans le thème : le PDF n'est pas en accès libre" onClick={() => onKeep(r.doi!, true)}>Garder la référence</Button>
      ) : null}
    </div>
  );
}

export function Results({ result, onKeep, busy }: { result: Result; onKeep: (link: string, single: boolean) => void; busy: boolean }) {
  const [articles, setArticles] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [all, setAll] = useState(false);
  // a result saved in another format may lack a list: shown as empty, never a crash
  const families = result.families ?? [];
  const articleList = result.articles ?? [];
  const sources = result.sources ?? [];
  const manual = sources.filter((s) => s.status === "ajout manuel");
  const failed = sources.filter((s) => s.status === "erreur");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        {families.length} recommandation(s) ou consensus · {articleList.length} article(s) masqué(s) · sources :{" "}
        {sources.filter((s) => s.status === "ok").map((s) => s.name).join(", ")}
      </p>
      {manual.length > 0 && (
        <p className="rounded-lg bg-cautionbg px-3 py-2 text-xs text-caution">
          Ajout manuel : {manual.map((s, i) => <span key={s.id}>{i ? " ; " : ""}{s.url ? <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name} ({s.reason})</span>)}
        </p>
      )}
      {failed.length > 0 && <p className="text-xs text-flag">Injoignables : {failed.map((s) => `${s.name} (${s.reason})`).join(" ; ")}</p>}
      {families.length === 0 ? (
        <Empty>Aucune recommandation trouvée. Ajoutez-la par son lien, son DOI ou son PDF.</Empty>
      ) : (
        <ul className="flex flex-col">
          {(all ? families : families.slice(0, 15)).map((f, i) => (
            <li key={i} className="border-t border-line first:border-0">
              {f.newer_elsewhere && (
                <p className="mt-2 rounded-lg bg-cautionbg px-3 py-1.5 text-xs font-medium text-caution">
                  Recommandation plus récente disponible : {f.newer_elsewhere.body} {f.newer_elsewhere.year}
                </p>
              )}
              <Version r={f.versions[0]} onKeep={onKeep} busy={busy} />
              {f.versions.length > 1 && (
                <button type="button" className="mb-2 text-xs text-accentink hover:underline" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
                  {open[i] ? "Masquer" : "Voir"} les versions antérieures ({f.versions.length - 1})
                </button>
              )}
              {open[i] && f.versions.slice(1).map((v, k) => <Version key={k} r={v} older onKeep={onKeep} busy={busy} />)}
            </li>
          ))}
        </ul>
      )}
      {!all && families.length > 15 && (
        <button type="button" className="self-start text-xs font-semibold text-accentink hover:underline" onClick={() => setAll(true)}>Voir les {families.length - 15} autres</button>
      )}
      {articleList.length > 0 && (
        <button type="button" className="self-start text-xs text-accentink hover:underline" onClick={() => setArticles(!articles)}>
          {articles ? "Masquer" : "Afficher"} les articles ({articleList.length}) : commentaires, corrections, études
        </button>
      )}
      {articles && <ul className="flex flex-col">{articleList.map((a, i) => <li key={i} className="border-t border-line"><Version r={a} onKeep={onKeep} busy={busy} /></li>)}</ul>}
    </div>
  );
}

function TopicPanel({ id }: { id: string }) {
  const [view, setView] = useState<TopicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [searching, setSearching] = useState(false);
  const upload = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api<TopicView>(`/crawl/topics/${id}`).then((v) => (setView(v), setError(null)), (e) => setError((e as Error).message)), [id]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!job || job.status !== "running") return;
    const t = setInterval(() => {
      api<Job>(`/crawl/jobs/${job.id}`).then((j) => {
        setJob(j);
        if (j.status !== "running") void load();
      }, (e) => setError((e as Error).message));
    }, 2000);
    return () => clearInterval(t);
  }, [job, load]);

  const run = (p: Promise<unknown>) => p.catch((e) => setError((e as Error).message));
  const search = () => {
    setSearching(true);
    return run(api<Result>(`/crawl/search/${id}`, { method: "POST" }).then(() => load())).finally(() => setSearching(false));
  };
  const keep = (link: string, single: boolean) =>
    run(api<Job>("/crawl/collect", { method: "POST", body: JSON.stringify({ url: link, topic: id, single }) }).then((j) => (setJob(j), j.status !== "running" ? load() : undefined)));
  const open = (path: string) => run(api<{ url: string }>(`/crawl/file?path=${encodeURIComponent(path)}`).then((r) => window.open(r.url, "_blank")));
  const send = (f: File) => {
    const form = new FormData();
    form.append("file", f);
    return run(apiForm(`/crawl/topics/${id}/upload`, form).then(() => load()));
  };

  if (!view) return <div className="p-6">{error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}</div>;
  const busy = job?.status === "running";
  const typed = url.trim();
  const direct = /\.pdf($|[?#])/i.test(typed) || /^(https?:\/\/(dx\.)?doi\.org\/|doi:\s*)?10\./i.test(typed);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title={view.fr} subtitle={`${view.group} · ${view.files.length} source(s) gardée(s)`}
        actions={<Button variant="primary" disabled={searching} onClick={search}>{searching ? <><Spinner /> Recherche…</> : view.search ? "Relancer la recherche" : "Rechercher les recommandations"}</Button>} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <FollowedBodies topic={id} />

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-soft">Sources du thème</h2>
        {view.files.length === 0 ? (
          <p className="text-sm text-muted">Aucune source gardée : téléchargez un résultat, ou ajoutez un lien, un DOI ou un PDF.</p>
        ) : (
          <ul className="flex flex-col">
            {view.files.map((f, i) => (
              <li key={f.path ?? `lien-${i}`} className="border-t border-line py-2 first:border-0">
                {f.path ? (
                  <button type="button" className="text-left text-sm font-medium text-ink hover:underline" onClick={() => open(f.path!)}>{decoded(f.title)}</button>
                ) : (
                  <a href={f.document_url ?? "#"} target="_blank" rel="noreferrer" className="text-sm font-medium text-ink hover:underline">{f.title}</a>
                )}
                <p className="text-xs text-muted">{[kb(f.bytes), f.fetched_at ? dateFr(f.fetched_at) : null, f.licence ? `licence : ${f.licence}` : null, f.scraper].filter(Boolean).join(" · ")}</p>
                {f.path && f.document_url && <a className="block truncate text-xs text-accentink hover:underline" href={f.document_url} target="_blank" rel="noreferrer">{f.document_url}</a>}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <input className={`${inputCls} min-w-64 flex-1`} placeholder="Lien d'un PDF, d'une page, ou DOI (10.xxxx/…)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button disabled={busy || !typed} onClick={() => (keep(typed, direct), setUrl(""))}>Ajouter par URL ou DOI</Button>
          <input ref={upload} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />
          <Button onClick={() => upload.current?.click()}>Uploader un PDF</Button>
        </div>
        {job && (
          <div className={`rounded-lg px-3 py-2 text-sm ${job.status === "running" ? "bg-panel text-soft" : job.status === "failed" ? "bg-flagbg text-flag" : "bg-tint text-accentink"}`}>
            {job.status === "running" ? <><Spinner className="mr-2" />Téléchargement… ({job.stage})</> : job.status === "failed" ? `Échec : ${job.error ?? "voir le journal"}`
              : job.link_only ? `Référence gardée (pas de PDF en accès libre) : ${job.title}` : `Téléchargé et ajouté au thème : ${job.stored.length} fichier(s)`}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold text-soft">Recommandations trouvées</h2>
          {view.search?.searched_at && <span className="text-xs text-muted">le {dateFr(view.search.searched_at)}</span>}
        </div>
        {searching ? <p className="text-sm text-soft"><Spinner className="mr-2" />PubMed, Europe PMC et les pages des organismes français et algériens…</p>
          : view.search ? <Results result={view.search} onKeep={keep} busy={busy} />
          : <Empty>Pas encore de recherche pour ce thème.</Empty>}
      </Card>
    </div>
  );
}

interface Followed { id: string; body_id: string; current_title: string | null; current_year: number | null; current_ref: string | null; status: string }

/** The bodies followed for this topic (Veille), side by side: each one's current guideline and its year. */
function FollowedBodies({ topic }: { topic: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<Followed[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    supabase.from("topic_sources").select("id,body_id,current_title,current_year,current_ref,status").eq("topic_id", topic).then(({ data }) => setRows((data as Followed[]) ?? []));
    api<{ id: string; name: string }[]>("/registry/bodies").then((b) => setNames(Object.fromEntries(b.map((x) => [x.id, x.name]))), () => {});
  }, [supabase, topic]);
  if (!rows) return null;
  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-semibold text-soft">Recommandations de référence suivies</h2>
        <a href="/veille" className="text-xs text-accentink hover:underline">Gérer dans Veille</a>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Aucun organisme suivi pour ce thème : choisissez-les dans Veille.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-line px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <span className="flex-1">{names[r.body_id] ?? r.body_id}</span>
                <span className="tabular-nums">{r.current_year ?? "?"}</span>
              </div>
              <p className="text-xs text-soft">{r.current_title ?? "non renseignée"}</p>
              {r.status !== "actuelle" && <p className="text-xs text-caution">{r.status}</p>}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/** A search on any words, outside the topics ("maladie rénale chronique cardiovasculaire"). */
function FreeSearch() {
  const [q, setQ] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = () => {
    setBusy(true);
    setError(null);
    api<Result>(`/crawl/search?q=${encodeURIComponent(q.trim())}`, { method: "POST" }).then(setResult, (e) => setError((e as Error).message)).finally(() => setBusy(false));
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Rechercher une recommandation" subtitle="PubMed, Europe PMC et les pages des organismes français et algériens. Choisissez un thème à gauche pour garder des sources." />
      <div className="flex gap-2">
        <input className={`${inputCls} flex-1`} placeholder="ex. maladie rénale chronique cardiovasculaire" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim().length > 2 && go()} />
        <Button variant="primary" disabled={busy || q.trim().length < 3} onClick={go}>{busy ? <Spinner /> : "Rechercher"}</Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {result && <Card className="p-4"><Results result={result} onKeep={() => setError("Choisissez d'abord un thème à gauche pour y garder une source.")} busy={false} /></Card>}
    </div>
  );
}

/** Collecte: a free search, and the topics of shared/topics.yaml with their sources. */
export default function CollectePage() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    api<Topic[]>("/crawl/topics").then(setTopics, (e) => setError((e as Error).message));
  }, []);
  const shown = useMemo(() => {
    const fold = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
    return (topics ?? []).filter((t) => !q.trim() || fold(`${t.fr} ${t.group}`).includes(fold(q.trim())));
  }, [topics, q]);

  return (
    <div className="grid min-h-[calc(100dvh-3rem)] grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="border-e border-line bg-panel">
        <div className="sticky top-12 flex max-h-[calc(100dvh-3rem)] flex-col">
          <div className="p-3">
            <button type="button" className={`mb-2 w-full rounded-lg px-2 py-1.5 text-left text-sm font-semibold ${open === null ? "bg-surface" : "hover:bg-surface/60"}`} onClick={() => setOpen(null)}>
              Recherche libre
            </button>
            <input className={`${inputCls} w-full`} placeholder="Filtrer les thèmes…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {error && <div className="p-3"><ErrorNote>{error}</ErrorNote></div>}
            {!topics && !error ? <div className="p-3 text-muted"><Spinner /></div> : null}
            {shown.map((t) => (
              <button key={t.id} type="button" onClick={() => setOpen(t.id)}
                className={`block w-full border-t border-line px-3 py-2 text-left ${open === t.id ? "bg-surface" : "hover:bg-surface/60"}`}>
                <div className="text-sm font-medium text-ink">{t.fr}</div>
                <div className="text-xs text-muted">{t.group}{t.priority === 1 ? " · priorité 1" : ""}</div>
              </button>
            ))}
          </div>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-[1000px] px-5 py-8">
        {open ? <TopicPanel key={open} id={open} /> : <FreeSearch />}
      </main>
    </div>
  );
}
