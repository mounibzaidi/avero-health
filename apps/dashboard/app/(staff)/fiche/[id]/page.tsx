"use client";

import {
  evidenceLines, forStorage, publicationGate, quoteKey, validateStructure, type Issue, type Protocol, type QuoteResult,
} from "@avero/schema";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { IssuesCtx, ReviewCtx, ShowCtx, type Review, type Reviewed, type Shown } from "@/components/editor/fields";
import { FichePreview } from "@/components/editor/FichePreview";
import { goTo, Issues } from "@/components/editor/Issues";
import { EnvCtx, type EditorEnv } from "@/components/editor/ItemEditor";
import { MetaEditor, ReviewEditor, SourcesEditor } from "@/components/editor/MetaEditors";
import { Button, ErrorNote, Spinner, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { deleteFiche } from "@/lib/delete";
import { SECTION_TITLE, TO_COMPLETE } from "@/lib/labels";
import { useAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

const ContinuousPdf = dynamic(() => import("@/components/ContinuousPdf"), { ssr: false, loading: () => <p className="p-6 text-sm text-muted">Loading the PDF…</p> });

// A fiche of Protocol Schema v1.1 (docs/protocol_schema_v1.1.md) beside its guideline PDF: each block is checked
// against its quote (a click shows it marked in the PDF), ticked, and once every block is ticked and the publication
// gate passes, "Publish" signs the clinical approval and publishes. Every save is a new version.

type QuoteState = { sig: string; results: Record<string, QuoteResult> };
const NOT_CHECKED: Record<string, QuoteResult> = {};
const today = () => new Date().toISOString().slice(0, 10);

/** A short hash of a block as checked: an edit changes it, and the block reads as not checked again. */
function sigOf(line: Reviewed): string {
  const s = JSON.stringify(line);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** Every line id of the fiche, with the section it is in (to count a section's issues). */
function lineSections(p: Protocol): Map<string, string> {
  const m = new Map<string, string>();
  const put = (sec: string, ids: { id: string }[]) => ids.forEach((x) => m.set(x.id, sec));
  put("red_box", [...p.red_box.signs, ...p.red_box.actions]);
  put("assess", [...p.assess.symptoms, ...p.assess.ask, ...p.assess.examine, ...p.assess.tests, ...p.assess.diagnosis, ...p.assess.pathway.nodes, ...p.assess.pathway.nodes.flatMap((n) => n.items)]);
  put("treat", [...p.treat.medications, ...p.treat.actions, ...p.treat.do_not]);
  put("advise", p.advise);
  put("refer_follow", [...p.refer_follow.refer, ...p.refer_follow.follow_up]);
  put("sources", p.sources);
  return m;
}

/** A new id unused in the fiche: items "ep-001" (initials of the fiche id), nodes "n4", others "med-2", "ref-1", "fu-3". */
function makeNewId(p: Protocol) {
  const used = [...lineSections(p).keys()];
  const initials = p.meta.id.split("-").map((w) => w[0]).join("") || "it";
  return (prefix: string) => {
    const base = prefix === "it" ? initials : prefix;
    const re = new RegExp(`^${base}-?(\\d+)$`);
    const n = used.reduce((max, id) => Math.max(max, Number(re.exec(id)?.[1] ?? 0)), 0) + 1;
    const id = prefix === "n" ? `n${n}` : prefix === "it" ? `${base}-${String(n).padStart(3, "0")}` : `${base}-${n}`;
    used.push(id);
    return id;
  };
}

function Section({ id, title, count, done, issues, closed, children }: { id: string; title: string; count?: number; done?: number; issues: number; closed?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(!closed);
  return (
    <section id={`section-${id}`} className="scroll-mt-28 border-t border-line pt-4 first:border-0">
      <button type="button" className="mb-2 flex w-full items-baseline gap-2 text-left" onClick={() => setOpen(!open)}>
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        {count !== undefined && count > 0 && <span className={`text-xs tabular-nums ${done === count ? "text-accent" : "text-muted"}`}>{done ?? 0}/{count} checked</span>}
        {issues > 0 && <span className="rounded bg-flagbg px-1.5 text-xs font-medium text-flag">{issues}</span>}
        <span className="text-xs text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="flex flex-col gap-4">{children}</div>}
    </section>
  );
}

const noneUsed = () => [];

export default function FicheEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { session, staff, isAdmin, viewOnly } = useAuth();
  const me = staff?.name || session?.user.email || "";

  const [f, setF] = useState<Protocol | null>(null);
  const [version, setVersion] = useState(0);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [published, setPublished] = useState<Set<string>>(new Set());
  const [pdfs, setPdfs] = useState<Record<string, string>>({});
  const [reviews, setReviews] = useState<Map<string, string>>(new Map());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<QuoteState>({ sig: "", results: {} });
  const [showIssues, setShowIssues] = useState(false);
  // the PDF beside the fiche: which source, its link, the quote to mark
  const [active, setActive] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<{ path: string; url: string } | null>(null);
  const [focus, setFocus] = useState<{ pdfPage: number; quote: string; nonce: number } | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [showUsed, setShowUsed] = useState(false); // every passage the draft quotes, highlighted in the PDF

  useEffect(() => {
    void (async () => {
      const [pub, sp, lr, fv] = await Promise.all([
        supabase.from("published_fiches").select("subject_id"),
        supabase.from("source_pdfs").select("source_id,pdf_path"),
        supabase.from("line_reviews").select("line_id,sig").eq("subject_id", id),
        supabase.from("fiche_versions").select("version,content,published_at").eq("subject_id", id).order("version", { ascending: false }),
      ]);
      setPublished(new Set((pub.data ?? []).map((r: { subject_id: string }) => r.subject_id)));
      setPdfs(Object.fromEntries((sp.data ?? []).map((r: { source_id: string; pdf_path: string }) => [r.source_id, r.pdf_path])));
      setReviews(new Map((lr.data ?? []).map((r: { line_id: string; sig: string }) => [r.line_id, r.sig])));
      if (fv.error || !fv.data?.length) return setError(fv.error?.message ?? "Fiche not found");
      const { protocol, issues } = validateStructure(fv.data[0].content);
      if (!protocol) return setError(`Unreadable version (not in the v1.1 format): ${issues.slice(0, 3).map((i) => i.message).join(" ; ")}`);
      setF(protocol);
      setVersion(fv.data[0].version);
      setPublishedVersion((fv.data as { version: number; published_at: string | null }[]).find((v) => v.published_at)?.version ?? null);
    })();
  }, [supabase, id]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit = useCallback((fn: (d: Protocol) => void) => {
    setF((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setNote(null);
  }, []);

  // ─── The PDF: the source shown (the first with a PDF, or the one of the block clicked), its link ───────────
  const source = f?.sources.find((s) => s.id === active) ?? f?.sources.find((s) => pdfs[s.id]) ?? null;
  const path = source ? pdfs[source.id] : undefined;
  useEffect(() => {
    if (!path || pdfUrl?.path === path) return;
    api<{ url: string }>(`/crawl/file?path=${encodeURIComponent(path)}`).then((r) => setPdfUrl({ path, url: r.url }), (e) => setError((e as Error).message));
  }, [path, pdfUrl]);
  const offset = source?.page_offset ?? 0;
  const show = useCallback((s: Shown) => {
    const e = s.evidence;
    if (e.page == null || !f) return;
    const src = f.sources.find((x) => x.id === e.source_id);
    setActive(e.source_id);
    setFocus({ pdfPage: Math.max(1, e.page + (src?.page_offset ?? 0)), quote: e.quote, nonce: Date.now() });
  }, [f]);
  const usedOn = useCallback((pdf: number) => (!f || !source ? [] : evidenceLines(f).flatMap((l) => l.evidence)
    .filter((e) => e.source_id === source.id && e.page != null && e.page + offset === pdf).map((e) => e.quote)), [f, source, offset]);

  // ─── Quote check: every evidence of the fiche, live (debounced) ─────────────────────────────────────────
  const evidence = useMemo(() => (f ? evidenceLines(f).flatMap((l) => l.evidence.map((e, i) => ({ key: quoteKey(l.id, i), ...e }))) : []), [f]);
  const sig = useMemo(() => JSON.stringify([evidence, f?.sources.map((s) => [s.id, s.page_offset]), pdfs]), [evidence, f?.sources, pdfs]);
  const checkQuotes = useCallback(async () => {
    if (!f || !evidence.length) return;
    try {
      const r = await api<{ results: { key: string; found: boolean; message: string | null }[] }>("/checks/quotes", {
        method: "POST", body: JSON.stringify({ sources: f.sources.map((s) => ({ id: s.id, page_offset: s.page_offset })), evidence }),
      });
      setQuotes({ sig, results: Object.fromEntries(r.results.map((x) => [x.key, { found: x.found, message: x.message }])) });
    } catch (e) {
      setError(`Quote check failed: ${(e as Error).message}`);
    }
  }, [f, evidence, sig]);
  useEffect(() => {
    if (!isAdmin || !evidence.length || quotes.sig === sig) return;
    const t = setTimeout(() => void checkQuotes(), 1500);
    return () => clearTimeout(t);
  }, [isAdmin, evidence.length, sig, quotes.sig, checkQuotes]);
  const quoteResults = quotes.sig === sig ? quotes.results : NOT_CHECKED;

  // ─── Each block ticked once checked against the PDF (line_reviews), undone by any edit of the block ────────
  const blocks = useMemo(() => (f ? evidenceLines(f) : []), [f]);
  const verified = useCallback((line: Reviewed) => reviews.get(line.id) === sigOf(line), [reviews]);
  const review: Review = useMemo(() => ({
    verified,
    toggle: (line) => {
      if (!session) return;  // view only
      const on = !verified(line);
      const s = sigOf(line);
      setReviews((m) => { const n = new Map(m); if (on) n.set(line.id, s); else n.delete(line.id); return n; });
      const q = on
        ? supabase.from("line_reviews").upsert({ subject_id: id, line_id: line.id, sig: s, reviewed_by: session?.user.id, reviewed_at: new Date().toISOString() })
        : supabase.from("line_reviews").delete().eq("subject_id", id).eq("line_id", line.id);
      void q.then(({ error }) => error && setError(`Tick not saved: ${error.message}`));
    },
    quote: (lineId) => {
      const n = blocks.find((b) => b.id === lineId)?.evidence.length ?? 0;
      const rs = Array.from({ length: n }, (_, i) => quoteResults[quoteKey(lineId, i)]);
      return rs.some((r) => r && !r.found) ? "missing" : rs.length && rs.every((r) => r?.found) ? "found" : "unchecked";
    },
  }), [verified, supabase, id, session, blocks, quoteResults]);
  const todo = blocks.filter((b) => !verified(b));

  // ─── Both validator levels, on the fiche as it would be published (approval signed by the publisher) ─────
  const candidate = useMemo(() => (f ? {
    ...f, meta: { ...f.meta, status: "published" as const, last_reviewed_at: today() },
    review: { ...f.review, clinical_approval: true, reviewer: f.review.reviewer || me || null, reviewed_at: today() },
  } : null), [f, me]);
  const structure = useMemo(() => (candidate ? validateStructure(candidate).issues : []), [candidate]);
  const gate = useMemo(() => (candidate && !structure.length ? publicationGate(candidate, { published, quotes: quoteResults }) : []), [candidate, structure, published, quoteResults]);
  const issuesById = useMemo(() => {
    const m = new Map<string | null, Issue[]>();
    for (const i of [...structure, ...gate]) m.set(i.item_id, [...(m.get(i.item_id) ?? []), i]);
    return m;
  }, [structure, gate]);
  const problems = structure.length + gate.length;
  const canPublish = isAdmin && !!f && !problems && !todo.length;

  const env: EditorEnv = useMemo(() => ({ sources: f?.sources ?? [], quotes: quoteResults, newId: f ? makeNewId(f) : (p) => p }), [f, quoteResults]);

  const saveVersion = async (content: Protocol, publish: boolean) => {
    if (!session) return;
    const next = version + 1;
    await supabase.from("subjects").update({ title: content.meta.title, template: content.meta.template, specialite: content.meta.specialite, updated_at: new Date().toISOString() }).eq("id", id);
    const now = new Date().toISOString();
    const v = await supabase.from("fiche_versions").insert({
      subject_id: id, version: next, content: forStorage(content), created_by: session.user.id, ...(publish ? { published_at: now, published_by: session.user.id } : {}),
    });
    if (v.error) throw new Error(v.error.message);
    setF(content);
    setVersion(next);
    if (publish) setPublishedVersion(next);
    setDirty(false);
  };
  const run = async (kind: "save" | "publish") => {
    if (!f) return;
    setBusy(kind);
    setError(null);
    try {
      if (kind === "save") {
        const content: Protocol = { ...f, meta: { ...f.meta, status: "draft" } };
        const bad = validateStructure(content).issues;
        if (bad.length) throw new Error(`Format : ${bad.slice(0, 3).map((i) => i.message).join(" ; ")}`);
        await saveVersion(content, false);
        setNote(`Saved (version ${version + 1})`);
      } else {
        if (!canPublish || !candidate) throw new Error("Publishing blocked: some blocks are still to check or fix.");
        await saveVersion(candidate, true);
        setNote(`Published (version ${version + 1})`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = (what: "fiche" | "drafts") => f && deleteFiche(supabase, id, f.meta.title || id, what, publishedVersion !== null).then((done) => {
    if (!done) return;
    if (what === "fiche") return router.push("/protocoles");
    setDirty(false);
    window.location.reload();
  }, (e) => setError((e as Error).message));

  const setPdf = async (sourceId: string, p: string | null) => {
    const { error } = p
      ? await supabase.from("source_pdfs").upsert({ source_id: sourceId, pdf_path: p, updated_at: new Date().toISOString(), updated_by: session?.user.id })
      : await supabase.from("source_pdfs").delete().eq("source_id", sourceId);
    if (error) return setError(error.message);
    setPdfs((cur) => { const next = { ...cur }; if (p) next[sourceId] = p; else delete next[sourceId]; return next; });
  };

  if (!f) return <div className="p-6">{error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}</div>;

  const where = lineSections(f);
  const sectionIssues = (sec: string) => [...structure, ...gate].filter((i) => (i.item_id ? where.get(i.item_id) === sec : sec === "review")).length;
  const stat = (sec: string) => {
    const ls = blocks.filter((b) => where.get(b.id) === sec);
    return { count: ls.length, done: ls.filter(verified).length };
  };
  const isLive = publishedVersion === version && !dirty;
  const pct = blocks.length ? Math.round((100 * (blocks.length - todo.length)) / blocks.length) : 0;

  return (
    <EnvCtx.Provider value={env}>
    <IssuesCtx.Provider value={issuesById}>
    <ShowCtx.Provider value={show}>
    <ReviewCtx.Provider value={review}>
    <div className="grid h-[calc(100dvh-3rem)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ── the guideline ── */}
      <section className="hidden min-h-0 flex-col border-r border-line lg:flex">
        <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2 text-sm">
          {f.sources.length > 1 ? f.sources.map((s) => (
            <button key={s.id} type="button" disabled={!pdfs[s.id]} onClick={() => setActive(s.id)}
              className={`rounded-lg px-2.5 py-1 text-xs ${s.id === source?.id ? "bg-tint font-medium text-accentink" : "text-soft hover:bg-panel disabled:opacity-40"}`}>{s.organisation || s.id}</button>
          )) : <span className="font-medium text-ink">{source?.organisation || "Guide"}</span>}
          <label className="ms-auto flex cursor-pointer select-none items-center gap-1.5 text-xs text-soft" title="Highlight every passage this draft quotes">
            <input type="checkbox" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)} className="size-3.5 accent-[rgb(var(--c-accent))]" />
            All quotes
          </label>
          <span className="text-xs text-muted">page <b className="tabular-nums text-ink">{pdfPage - offset}</b></span>
        </div>
        <div className="min-h-0 flex-1">
          {path && pdfUrl?.path === path ? <ContinuousPdf key={path} url={pdfUrl.url} focus={focus} usedOn={showUsed ? usedOn : noneUsed} onPage={setPdfPage} />
            : <p className="p-6 text-sm text-muted">{path ? "Loading the PDF…" : viewOnly ? "The PDF of this source is not stored yet: its quotes are shown under each line." : "No PDF for this source: add it in Sources, at the bottom of the fiche."}</p>}
        </div>
      </section>

      {/* ── the fiche ── */}
      <div className="min-h-0 overflow-auto px-5 pb-16">
        <div className="sticky top-0 z-10 -mx-5 flex flex-col gap-2 border-b border-line bg-bg/95 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <Link href="/protocoles" className="text-sm text-muted hover:text-accentink">‹</Link>
            <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{f.meta.title || TO_COMPLETE}</h1>
            <Tag tone={isLive ? "accent" : "neutral"}>{isLive ? "published" : publishedVersion ? `draft (v${publishedVersion} published)` : "draft"}</Tag>
            {dirty && isAdmin && <Button className="h-8" disabled={!!busy} onClick={() => run("save")}>{busy === "save" ? <Spinner /> : "Save"}</Button>}
            {isAdmin && <Button className="h-8" variant="primary" disabled={!!busy || !canPublish || isLive} onClick={() => run("publish")}>{busy === "publish" ? <Spinner /> : "Publish"}</Button>}
            {isAdmin && (
              <details className="relative">
                <summary className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-lg text-muted hover:bg-panel hover:text-ink" title="More">⋯</summary>
                <div className="absolute right-0 z-30 mt-1 flex w-56 flex-col rounded-xl border border-edge/15 bg-surface p-1 text-sm shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)]">
                  {publishedVersion !== null && !isLive && <button type="button" className="rounded-lg px-3 py-2 text-left text-flag hover:bg-flagbg" onClick={() => void remove("drafts")}>Delete draft</button>}
                  <button type="button" className="rounded-lg px-3 py-2 text-left text-flag hover:bg-flagbg" onClick={() => void remove("fiche")}>Delete fiche</button>
                </div>
              </details>
            )}
          </div>
          {!viewOnly && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-panel"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} /></div>
            <span className="tabular-nums text-soft">{blocks.length - todo.length}/{blocks.length} blocks checked</span>
            {todo.length > 0 && !viewOnly && <button type="button" className="font-medium text-accentink hover:underline" onClick={() => { goTo(todo[0].id); const e = todo[0].evidence[0]; if (e) show({ evidence: e, label: "" }); }}>Next to check ›</button>}
            {problems > 0 && <button type="button" className="font-medium text-flag hover:underline" onClick={() => setShowIssues((x) => !x)}>{problems} problem{problems > 1 ? "s" : ""} to fix {showIssues ? "▴" : "▾"}</button>}
            {!todo.length && !problems && !isLive && !viewOnly && <span className="font-medium text-accent">Ready to publish</span>}
            {note && <span className="text-accent">{note}</span>}
          </div>}
          {showIssues && problems > 0 && <div className="max-h-64 overflow-auto rounded-xl border border-line bg-surface p-3"><Issues structure={structure} gate={gate} /></div>}
          {error && <ErrorNote>{error}</ErrorNote>}
        </div>

        <div className="mt-6 flex flex-col gap-5 pb-10">
          <FichePreview f={f} edit={edit} stat={stat} readOnly={viewOnly} />

          {!viewOnly && <>
          <h2 className="mt-6 border-t border-line pt-5 text-xs font-semibold uppercase tracking-wide text-muted">Settings</h2>
          <Section id="meta" title="Identity" closed issues={0}>
            <MetaEditor meta={f.meta} scope={f.scope} onMeta={(meta) => edit((d) => void (d.meta = { ...meta, id: d.meta.id }))} onScope={(scope) => edit((d) => void (d.scope = scope))} />
          </Section>

          <Section id="sources" title={SECTION_TITLE.sources} closed issues={sectionIssues("sources")}>
            <SourcesEditor sources={f.sources} topic={f.meta.id} pdfs={pdfs} onPdf={setPdf} onChange={(v) => edit((d) => void (d.sources = v))} />
          </Section>

          <Section id="review" title={SECTION_TITLE.review} closed issues={sectionIssues("review")}>
            <ReviewEditor review={f.review} me={me} onChange={(r) => edit((d) => void (d.review = r))} />
          </Section>
          </>}
        </div>
      </div>
    </div>
    </ReviewCtx.Provider>
    </ShowCtx.Provider>
    </IssuesCtx.Provider>
    </EnvCtx.Provider>
  );
}
