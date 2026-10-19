"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button, ButtonLink, Card, Empty, ErrorNote, inputCls, PageHeader, Spinner, Tag } from "@/components/ui";
import { api, apiForm } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { deleteStored } from "@/lib/delete";
import { dateFr } from "@/lib/labels";
import { createClient } from "@/lib/supabase/client";

// Collecte: the source guidelines of each topic. The search asks the literature APIs (PubMed, Europe PMC) and the
// listing pages of the French and Algerian bodies (services/crawler/literature.py); results are grouped into
// guideline families (newest version first). Every PDF kept is in the "sources" bucket with its provenance.

interface Topic { id: string; fr: string; group: string; section: string; priority: number | null }
interface StoredFile { path: string | null; ref?: string; title: string; bytes: number | null; document_url: string | null; fetched_at: string | null; licence: string | null; scraper: string | null; link_only?: boolean }
export interface Rec {
  pmid: string | null; title: string; journal: string; url: string; doi: string | null; pdf_url: string | null; kind: "guideline" | "consensus" | "article";
  why: string; body: string | null; body_name: string | null; version_year: number | null; version?: "actuelle" | "antérieure"; on_listing?: boolean; official?: boolean;
  /** Publication year; version_year is the edition year when they differ ("JCS 2020 Guideline" published 2023). */
  year?: number | null;
  also_in?: { journal: string; url: string }[];
  /** A guideline published as one article per question: its chapters (literature.chapters). */
  chapters?: { title: string; url: string }[];
  /** The issuing body's region (shared/guideline_bodies.yaml): dz, fr, eu, na, intl, other. */
  region?: string | null;
  /** The classifier's label (services/crawler/classifier.py) and its judgement of the topic. */
  label?: "primary_guidance" | "derivative" | "correction" | "methodology" | "patient_material" | "research" | "commentary" | "expired" | null;
  relevance?: "core" | "adjacent" | "off_topic" | null;
  derived_from?: string | { body?: string; year?: number } | null;
  language?: "fr" | "en" | string;
  /** Named by the librarian as a current reference, and verified (PubMed or the body's listing). */
  reference?: { role: "core" | "adjacent"; tier: 1 | 2 | 3; doc_type: string | null; supersedes: { title: string; year: number | null }[]; notes: string | null };
}
export interface Family { body: string | null; versions: Rec[]; newer_elsewhere?: { body: string; year: number; title: string } }
interface SourceStatus { id: string; name: string; status: "ok" | "ajout manuel" | "erreur"; reason: string | null; url?: string; entries: number }
/** A body's status from its crawl (services/crawler/bodies.py), not from the librarian's guess. */
interface BodyStatus { body: string; status: string; found: number; discovered: boolean; method: string | null }
/** The librarian's answer (services/crawler/librarian.py): its verified documents are the `reference` versions. */
interface Shelf {
  model: string | null; error: string | null; scope_note: string | null;
  bodies: BodyStatus[];
  unverified: { body: string; co_bodies: string[] | null; title: string; year: number | null; doc_type: string | null; tier: number | null; url_hint: string | null; verification_queries: string[] | null; confidence: string | null; notes: string | null; check: string }[];
}
/** A results page section (literature.sections): families, or for "articles" groups of records by label. */
interface Section { id: string; title: string; families?: Family[]; groups?: { label: string; items: Rec[] }[]; bodies?: BodyStatus[]; always?: boolean; collapsed?: boolean }
export interface Result { query?: string | null; families: Family[]; articles: Rec[]; sources: SourceStatus[]; searched_at?: string; error?: string; librarian?: Shelf | null; sections?: Section[]; classifier_error?: string | null }
interface TopicView { id: string; fr: string; group: string; files: StoredFile[]; search: Result | null }
interface Job { id: string; status: "running" | "succeeded" | "partial" | "failed"; stage: string; error: string | null; stored: string[]; link_only?: boolean; title?: string }

const KIND = { guideline: "Guideline", consensus: "Consensus", article: "Article" } as const;
const TIER: Record<number, string> = { 1: "International reference", 2: "National reference", 3: "Reference (other country)" };
const LABEL: Record<string, string> = {
  primary_guidance: "Guideline", derivative: "Summary", correction: "Correction", methodology: "Methodology",
  patient_material: "Patient material", research: "Study", commentary: "Commentary", expired: "Expired",
};
const OLD_YEARS = 10;
const THIS_YEAR = new Date().getFullYear();
/** "d'après ESC 2023" from the classifier's derived_from, whatever its shape. */
const derivedFrom = (d: Rec["derived_from"]) =>
  !d ? null : typeof d === "string" ? d : [d.body, d.year].filter(Boolean).join(" ") || null;
/** A verification query as a link: PubMed for a PubMed query, a web search for a "site:" query. */
const queryUrl = (q: string) =>
  /\bsite:/.test(q) ? `https://www.google.com/search?q=${encodeURIComponent(q)}` : `https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(q)}`;
const decoded = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const kb = (n: number | null) => (n ? `${Math.max(1, Math.round(n / 1024))} KB` : "");

/** One version of a guideline: title, label, body, language, year, where it was found, and how to keep it. */
function Version({ r, older, onKeep, busy }: { r: Rec; older?: boolean; onKeep: (link: string, single: boolean) => void; busy: boolean }) {
  const label = r.label ? LABEL[r.label] : KIND[r.kind];
  const year = r.version_year;
  const published = r.year && year && r.year !== year ? r.year : null;
  const from = r.label === "derivative" ? derivedFrom(r.derived_from) : null;
  return (
    <div className={`flex items-start gap-3 py-2 ${older ? "ps-4 opacity-75" : ""}`}>
      <div className="min-w-0 flex-1">
        <a href={r.url} target="_blank" rel="noreferrer" className="text-sm font-medium text-ink hover:underline">{r.title}</a>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <Tag>{langOf(r) === "fr" ? "FR" : "EN"}</Tag>
          {older ? <Tag>Earlier version</Tag> : <Tag tone={r.label === "primary_guidance" || (!r.label && r.kind !== "article") ? "accent" : "neutral"}>{label}</Tag>}
          {from && <span>based on {from}</span>}
          {!older && r.reference && <Tag tone="accent">{TIER[r.reference.tier] ?? "Reference"}</Tag>}
          {r.relevance === "adjacent" && <Tag>related</Tag>}
          <span className="font-medium text-soft">{r.body_name ?? "Unidentified body"}</span>
          {year && <span>· {year}{published ? ` (published ${published})` : ""}</span>}
          {year && THIS_YEAR - year > OLD_YEARS && <Tag>old ({year})</Tag>}
          <span>· {r.on_listing ? "the body's official page" : r.journal}</span>
          {r.pdf_url && <Tag tone="accent">Open PDF</Tag>}
          {(() => {
            const elsewhere = [...new Set((r.also_in ?? []).map((a) => a.journal).filter((j) => j && j !== r.journal))];
            return elsewhere.length ? <span>· also published {r.on_listing ? "by" : "in"} {elsewhere.join(", ")}</span> : null;
          })()}
          {r.chapters?.length ? <span title={r.chapters.map((c) => c.title).join("\n")} className="cursor-help underline decoration-dotted">· {r.chapters.length} chapter(s)</span> : null}
          <span title={r.why} className="cursor-help underline decoration-dotted">why</span>
        </div>
      </div>
      {r.pdf_url ? (
        <Button className="h-8 shrink-0 text-xs" disabled={busy} title="Downloads the PDF and adds it to the topic's sources" onClick={() => onKeep(r.pdf_url!, true)}>Download the PDF</Button>
      ) : r.doi ? (
        <Button className="h-8 shrink-0 text-xs" disabled={busy} title="Keeps the reference (DOI) in the topic: the PDF is not open access" onClick={() => onKeep(r.doi!, true)}>Keep the reference</Button>
      ) : null}
    </div>
  );
}

/** The bodies consulted, each with the status its crawl gave (found, adopts another body's, nothing, unreachable). */
function BodiesLine({ bodies }: { bodies: BodyStatus[] }) {
  return (
    <p>
      <span className="font-medium text-ink">Bodies consulted: </span>
      {bodies.map((b, i) => <span key={i}>{i ? " · " : ""}{b.body}{b.discovered ? "*" : ""}: {b.status}</span>)}
      {bodies.some((b) => b.discovered) && <span className="text-muted"> (* body found by the librarian)</span>}
    </p>
  );
}

/** What the librarian said beyond the verified references: its scope note, the bodies consulted, the documents it
 * named that nothing matched (with its queries, to check by hand). */
function ShelfNote({ shelf }: { shelf: Shelf }) {
  if (shelf.error) return <p className="text-xs text-caution">{shelf.error}</p>;
  const bodies = (shelf.bodies ?? []).filter((b) => typeof b.status === "string" && "found" in b);
  const unverified = shelf.unverified ?? [];
  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-panel/60 px-3 py-2 text-xs text-soft">
      {shelf.scope_note && <p>{shelf.scope_note}</p>}
      {bodies.length > 0 && <BodiesLine bodies={bodies} />}
      {unverified.length > 0 && (
        <div>
          <span className="font-medium text-caution">Proposed, not confirmed:</span>
          <ul className="mt-1 flex flex-col gap-1">
            {unverified.map((u, i) => (
              <li key={i} title={u.notes ?? undefined}>
                <span className="text-ink">{u.body}{u.year ? ` ${u.year}` : ""}</span> · {u.title}
                {u.confidence === "low" && <span className="text-muted"> (uncertain)</span>}
                {u.verification_queries?.length ? (
                  <span className="text-muted"> · search: {u.verification_queries.map((q, k) => (
                    <a key={k} className="underline" href={queryUrl(q)} target="_blank" rel="noreferrer">{k ? ", " : ""}{/\bsite:/.test(q) ? "web" : "PubMed"}</a>
                  ))}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      {shelf.model && <p className="text-muted">Librarian: {shelf.model}. Its suggestions are shown as references only once found on PubMed or in the body&apos;s catalogue.</p>}
    </div>
  );
}

/** One guideline family: its current version, the "newer version" note of its body, its older versions. */
function FamilyItem({ f, onKeep, busy }: { f: Family; onKeep: (link: string, single: boolean) => void; busy: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-t border-line first:border-0">
      {f.newer_elsewhere && (
        <p className="mt-2 rounded-lg bg-cautionbg px-3 py-1.5 text-xs font-medium text-caution">
          Newer version from this body: {f.newer_elsewhere.body} {f.newer_elsewhere.year}
        </p>
      )}
      <Version r={f.versions[0]} onKeep={onKeep} busy={busy} />
      {f.versions.length > 1 && (
        <button type="button" className="mb-2 text-xs text-accentink hover:underline" onClick={() => setOpen(!open)}>
          {open ? "Hide" : "Show"} earlier versions ({f.versions.length - 1})
        </button>
      )}
      {open && f.versions.slice(1).map((v, k) => <Version key={k} r={v} older onKeep={onKeep} busy={busy} />)}
    </li>
  );
}

type Lang = "all" | "fr" | "en";
const FR_WORDS = /\b(de|des|du|la|le|les|et|pour|chez|prise en charge|recommandations?|conduite à tenir)\b/gi;
/** fr or en: the server's language, else (results saved before it existed) the French words of the title. */
const langOf = (r: Rec) => r.language ?? ((r.title.match(FR_WORDS)?.length ?? 0) >= 2 ? "fr" : "en");
const inLang = (r: Rec, lang: Lang) => lang === "all" || (lang === "fr" ? langOf(r) === "fr" : langOf(r) !== "fr");
const LANG_TITLE = { fr: "Documents in French", en: "Documents in English" } as const;

/** One results page section: its families (FR/EN filtered), or when empty the crawl status of its bodies. */
function SectionBlock({ sec, lang, showEmpty, onKeep, busy }: { sec: Section; lang: Lang; showEmpty: boolean; onKeep: (link: string, single: boolean) => void; busy: boolean }) {
  const [open, setOpen] = useState(!sec.collapsed);
  const families = (sec.families ?? []).filter((f) => inLang(f.versions[0], lang));
  const groups = (sec.groups ?? []).map((g) => ({ ...g, items: g.items.filter((r) => inLang(r, lang)) })).filter((g) => g.items.length);
  const count = families.length + groups.reduce((n, g) => n + g.items.length, 0);
  if (!count && !(sec.always && showEmpty)) return null;
  return (
    <section className="flex flex-col gap-1">
      <button type="button" className="flex items-baseline gap-2 text-left" onClick={() => setOpen(!open)}>
        <h3 className="text-sm font-semibold text-ink">{sec.title}</h3>
        <span className="text-xs text-muted">{count}{sec.collapsed ? (open ? " · hide" : " · show") : ""}</span>
      </button>
      {open && families.length > 0 && <ul className="flex flex-col">{families.map((f, i) => <FamilyItem key={i} f={f} onKeep={onKeep} busy={busy} />)}</ul>}
      {open && groups.map((g) => (
        <div key={g.label} className="flex flex-col">
          <p className="mt-1 text-xs font-medium text-soft">{g.label} ({g.items.length})</p>
          <ul className="flex flex-col">{g.items.map((r, i) => <li key={i} className="border-t border-line"><Version r={r} onKeep={onKeep} busy={busy} /></li>)}</ul>
        </div>
      ))}
      {open && !count && (
        <p className="text-xs text-muted">
          {sec.bodies?.length ? sec.bodies.map((b, i) => <span key={i}>{i ? " · " : ""}{b.body}: {b.status}</span>) : "No body consulted for this section."}
          {sec.id === "algerie" && " Add a document by its link or by uploading the PDF above."}
        </p>
      )}
    </section>
  );
}

/**
 * The search result, by sections (literature.sections): international references, French bodies, Algeria, French
 * summaries, other countries, articles. A result saved before sections existed is shown the old way.
 */
export function Results({ result, onKeep, busy }: { result: Result; onKeep: (link: string, single: boolean) => void; busy: boolean }) {
  const [lang, setLang] = useState<Lang>("all");
  // French documents first, English after; the filter shows one language only
  const langs = lang === "all" ? (["fr", "en"] as const) : ([lang] as const);
  if (!result.sections) {
    const part = (l: "fr" | "en"): Result => ({
      ...result, families: (result.families ?? []).filter((f) => inLang(f.versions[0], l)), articles: (result.articles ?? []).filter((a) => inLang(a, l)),
    });
    return (
      <div className="flex flex-col gap-6">
        {(["fr", "en"] as const).map((l) => (
          <div key={l} className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-ink">{LANG_TITLE[l]}</h3>
            <LegacyResults result={l === "fr" ? part(l) : { ...part(l), librarian: null }} onKeep={onKeep} busy={busy} />
          </div>
        ))}
      </div>
    );
  }
  const sources = result.sources ?? [];
  const failed = sources.filter((s) => s.status === "erreur");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        {(["all", "fr", "en"] as const).map((l, i) => (
          <span key={l}>{i ? "· " : ""}<button type="button" className={lang === l ? "font-semibold text-ink" : "hover:underline"} onClick={() => setLang(l)}>
            {{ all: "All", fr: "French", en: "English" }[l]}</button></span>
        ))}
        <span className="ms-auto">sources: {sources.filter((s) => s.status === "ok").map((s) => s.name).join(", ")}</span>
      </div>
      {failed.length > 0 && <p className="text-xs text-flag">Unreachable: {failed.map((s) => `${s.name} (${s.reason})`).join(" ; ")}</p>}
      {result.classifier_error && <p className="text-xs text-caution">{result.classifier_error}</p>}
      {result.librarian && <ShelfNote shelf={result.librarian} />}
      {langs.map((l) => (
        <div key={l} className="flex flex-col gap-4">
          {lang === "all" && <h2 className="border-b border-line pb-1 text-base font-semibold text-ink">{LANG_TITLE[l]}</h2>}
          {result.sections!.map((sec) => <SectionBlock key={sec.id} sec={sec} lang={l} showEmpty={l === "fr"} onKeep={onKeep} busy={busy} />)}
        </div>
      ))}
    </div>
  );
}

/**
 * The search result. Main list: guidance of an identified body (shared/guideline_bodies.yaml, a body's own
 * catalogue, or a verified librarian reference). Guidance whose body is unknown and the articles are folded away.
 */
function LegacyResults({ result, onKeep, busy }: { result: Result; onKeep: (link: string, single: boolean) => void; busy: boolean }) {
  const [articles, setArticles] = useState(false);
  const [others, setOthers] = useState(false);
  const [all, setAll] = useState(false);
  // a result saved in another format may lack a list: shown as empty, never a crash
  const families = result.families ?? [];
  const official = families.filter((f) => f.versions[0].official || f.versions[0].reference);
  const unknown = families.filter((f) => !(f.versions[0].official || f.versions[0].reference));
  const articleList = result.articles ?? [];
  const sources = result.sources ?? [];
  const manual = sources.filter((s) => s.status === "ajout manuel");
  const failed = sources.filter((s) => s.status === "erreur");
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        {official.length} guideline(s) from identified bodies · {unknown.length} from unidentified bodies · {articleList.length} article(s) · sources:{" "}
        {sources.filter((s) => s.status === "ok").map((s) => s.name).join(", ")}
      </p>
      {manual.length > 0 && (
        <p className="rounded-lg bg-cautionbg px-3 py-2 text-xs text-caution">
          Add by hand: {manual.map((s, i) => <span key={s.id}>{i ? " ; " : ""}{s.url ? <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name} ({s.reason})</span>)}
        </p>
      )}
      {failed.length > 0 && <p className="text-xs text-flag">Unreachable: {failed.map((s) => `${s.name} (${s.reason})`).join(" ; ")}</p>}
      {result.librarian && <ShelfNote shelf={result.librarian} />}
      {official.length === 0 ? (
        <Empty>No guideline from an identified body. Add it by its link, DOI or PDF.</Empty>
      ) : (
        <ul className="flex flex-col">
          {(all ? official : official.slice(0, 15)).map((f, i) => <FamilyItem key={i} f={f} onKeep={onKeep} busy={busy} />)}
        </ul>
      )}
      {!all && official.length > 15 && (
        <button type="button" className="self-start text-xs font-semibold text-accentink hover:underline" onClick={() => setAll(true)}>Show the {official.length - 15} others</button>
      )}
      {unknown.length > 0 && (
        <button type="button" className="self-start text-xs text-accentink hover:underline" onClick={() => setOthers(!others)}>
          {others ? "Hide" : "Show"} guidelines from unidentified bodies ({unknown.length})
        </button>
      )}
      {others && <ul className="flex flex-col">{unknown.map((f, i) => <FamilyItem key={i} f={f} onKeep={onKeep} busy={busy} />)}</ul>}
      {articleList.length > 0 && (
        <button type="button" className="self-start text-xs text-accentink hover:underline" onClick={() => setArticles(!articles)}>
          {articles ? "Hide" : "Show"} articles ({articleList.length}): commentaries, corrections, studies, articles about a guideline
        </button>
      )}
      {articles && <ul className="flex flex-col">{articleList.map((a, i) => <li key={i} className="border-t border-line"><Version r={a} onKeep={onKeep} busy={busy} /></li>)}</ul>}
    </div>
  );
}

/** The topic's fiche: made from its JSON and one of the PDFs kept here (/fiche/nouveau, this topic's PDFs on offer). */
function FicheBox({ topic }: { topic: string }) {
  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <p className="min-w-0 flex-1 text-sm text-soft">This topic&apos;s fiche: paste its JSON, pick the PDF from those kept here, then check it block by block.</p>
      <ButtonLink href={`/fiche/nouveau?topic=${encodeURIComponent(topic)}`}>Create the fiche</ButtonLink>
    </Card>
  );
}

function TopicPanel({ id }: { id: string }) {
  const [view, setView] = useState<TopicView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [job, setJob] = useState<Job | null>(null);
  const [searching, setSearching] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const { isAdmin } = useAuth();

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
  /** ai: also run the paid steps (librarian, classifier); without it the search is free and reuses their saved answers. */
  const search = (ai = false) => {
    setSearching(true);
    return run(api<Result>(`/crawl/search/${id}${ai ? "?ai=true" : ""}`, { method: "POST" }).then(() => load())).finally(() => setSearching(false));
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
      <PageHeader title={view.fr} subtitle={`${view.group} · ${view.files.length} source(s) kept`}
        actions={isAdmin && <div className="flex gap-2">
          <Button disabled={searching} title="Librarian and AI classification (Claude), cached for a week" onClick={() => search(true)}>Analyse with AI (≈ $0.05)</Button>
          <Button variant="primary" disabled={searching} onClick={() => search()}>{searching ? <><Spinner /> Searching…</> : view.search ? "Search again" : "Search for guidelines"}</Button>
        </div>} />
      {error && <ErrorNote>{error}</ErrorNote>}
      {isAdmin && <FicheBox topic={id} />}
      <FollowedBodies topic={id} />

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-soft">Topic sources</h2>
        {view.files.length === 0 ? (
          <p className="text-sm text-muted">No source kept: download a result, or add a link, a DOI or a PDF.</p>
        ) : (
          <ul className="flex flex-col">
            {view.files.map((f, i) => (
              <li key={f.path ?? `lien-${i}`} className="group relative border-t border-line py-2 pe-20 first:border-0">
                {isAdmin && (f.path ?? f.ref) && (
                  <button type="button" className="absolute right-0 top-2 rounded px-2 py-0.5 text-xs text-flag opacity-0 hover:bg-flagbg focus:opacity-100 group-hover:opacity-100"
                    onClick={() => void deleteStored((f.path ?? f.ref)!, decoded(f.title)).then((done) => { if (done) void load(); }, (e) => setError((e as Error).message))}>Delete</button>
                )}
                {f.path ? (
                  <button type="button" className="text-left text-sm font-medium text-ink hover:underline" onClick={() => open(f.path!)}>{decoded(f.title)}</button>
                ) : (
                  <a href={f.document_url ?? "#"} target="_blank" rel="noreferrer" className="text-sm font-medium text-ink hover:underline">{f.title}</a>
                )}
                <p className="text-xs text-muted">{[kb(f.bytes), f.fetched_at ? dateFr(f.fetched_at) : null, f.licence ? `licence: ${f.licence}` : null, f.scraper].filter(Boolean).join(" · ")}</p>
                {f.path && f.document_url && <a className="block truncate text-xs text-accentink hover:underline" href={f.document_url} target="_blank" rel="noreferrer">{f.document_url}</a>}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <input className={`${inputCls} min-w-64 flex-1`} placeholder="Link to a PDF or a page, or a DOI (10.xxxx/…)" value={url} onChange={(e) => setUrl(e.target.value)} />
          <Button disabled={busy || !typed} onClick={() => (keep(typed, direct), setUrl(""))}>Add by URL or DOI</Button>
          <input ref={upload} type="file" accept="application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && void send(e.target.files[0])} />
          <Button onClick={() => upload.current?.click()}>Upload a PDF</Button>
        </div>}
        {job && (
          <div className={`rounded-lg px-3 py-2 text-sm ${job.status === "running" ? "bg-panel text-soft" : job.status === "failed" ? "bg-flagbg text-flag" : "bg-tint text-accentink"}`}>
            {job.status === "running" ? <><Spinner className="mr-2" />Downloading… ({job.stage})</> : job.status === "failed" ? `Failed: ${job.error ?? "see the log"}`
              : job.link_only ? `Reference kept (no open-access PDF): ${job.title}` : `Downloaded and added to the topic: ${job.stored.length} file(s)`}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-semibold text-soft">Guidelines found</h2>
          {view.search?.searched_at && <span className="text-xs text-muted">on {dateFr(view.search.searched_at)}</span>}
        </div>
        {searching ? <p className="text-sm text-soft"><Spinner className="mr-2" />PubMed, Europe PMC and the pages of the French and Algerian bodies…</p>
          : view.search ? <Results result={view.search} onKeep={keep} busy={busy || !isAdmin} />
          : <Empty>No search for this topic yet.</Empty>}
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
        <h2 className="text-sm font-semibold text-soft">Reference guidelines followed</h2>
        <a href="/veille" className="text-xs text-accentink hover:underline">Manage in Watch</a>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No body followed for this topic: choose them in Watch.</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg border border-line px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <span className="flex-1">{names[r.body_id] ?? r.body_id}</span>
                <span className="tabular-nums">{r.current_year ?? "?"}</span>
              </div>
              <p className="text-xs text-soft">{r.current_title ?? "not set"}</p>
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
      <PageHeader title="Search for a guideline" subtitle="PubMed, Europe PMC and the pages of the French and Algerian bodies. Pick a topic on the left to keep sources." />
      <div className="flex gap-2">
        <input className={`${inputCls} flex-1`} placeholder="e.g. maladie rénale chronique cardiovasculaire" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && q.trim().length > 2 && go()} />
        <Button variant="primary" disabled={busy || q.trim().length < 3} onClick={go}>{busy ? <Spinner /> : "Search"}</Button>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {result && <Card className="p-4"><Results result={result} onKeep={() => setError("Pick a topic on the left first to keep a source in it.")} busy={false} /></Card>}
    </div>
  );
}

/** Collecte: a free search, and the topics of shared/topics.yaml with their sources. */
export default function CollectePage() {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { isAdmin } = useAuth();

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
            {isAdmin && <button type="button" className={`mb-2 w-full rounded-lg px-2 py-1.5 text-left text-sm font-semibold ${open === null ? "bg-surface" : "hover:bg-surface/60"}`} onClick={() => setOpen(null)}>
              Free search
            </button>}
            <input className={`${inputCls} w-full`} placeholder="Filter topics…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {error && <div className="p-3"><ErrorNote>{error}</ErrorNote></div>}
            {!topics && !error ? <div className="p-3 text-muted"><Spinner /></div> : null}
            {shown.map((t) => (
              <button key={t.id} type="button" onClick={() => setOpen(t.id)}
                className={`block w-full border-t border-line px-3 py-2 text-left ${open === t.id ? "bg-surface" : "hover:bg-surface/60"}`}>
                <div className="text-sm font-medium text-ink">{t.fr}</div>
                <div className="text-xs text-muted">{t.group}{t.priority === 1 ? " · priority 1" : ""}</div>
              </button>
            ))}
          </div>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-[1000px] px-5 py-8">
        {open ? <TopicPanel key={open} id={open} /> : isAdmin ? <FreeSearch /> : <Empty>Pick a topic on the left to see its sources and the guidelines found.</Empty>}
      </main>
    </div>
  );
}
