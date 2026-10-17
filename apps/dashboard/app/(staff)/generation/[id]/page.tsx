"use client";

import { fromLegacy, type Medication } from "@medguides/schema";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BrandPicker } from "@/components/editor/BrandPicker";
import { Composer, type Part, type Proposal, type Target } from "@/components/fichegen/Composer";
import { RUNNING, Stepper } from "@/components/GenerationProgress";
import { Button, Card, ErrorNote, inputCls, PageHeader, Spinner, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { IMPORT_KEY } from "@/lib/fiche-import";
import { createClient } from "@/lib/supabase/client";

const PdfViewer = dynamic(() => import("@/components/PdfViewer"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">Chargement du PDF…</p> });

/** A recommendation or dose row of the guideline (GET /rows), and whether the fiche covers it. */
interface GuideRow { id: string; kind: "rec" | "dose"; page: number; text: string; quote: string; grade: string | null; harm: boolean; drug: string | null; covered: boolean }

/** A line of a fiche-protocole fiche (element) and a dose, as generated. */
interface Line { id: string; text: string; type: string; condition: string | null; source: { source_id: string; page: number | null; quote: string }; grade: string | null; missing: string[] }
interface Dose {
  drug_dci: string; dose: string; dose_max: string | null; route: string; frequency_or_duration: string; condition: string | null;
  source: { page: number | null; quote: string }; missing: string[]; algerie: { brands: string[]; statut: string | null }; note: string | null;
}
type Fiche = { meta: Record<string, unknown> & { title: string; status: string; quote_check: string; excluded_by_audience: string[] }; sections: Record<string, Record<string, unknown>> };
interface LineMeta { element_id: string; section: string; quote_status: "pdf" | "parsed" | "failed" | null; from_figure: boolean; retries: number; model: string | null; dropped: boolean; dropped_line: Line | null; reason: string | null }
interface Coverage {
  rows: number; rec_rows: number; dose_rows: number; matched: number; excluded: number; harm_rows: number; harm_in_8: number; pct: number; pct_before: number;
  uncovered: { kind: "rec" | "dose"; page: number; text: string; cor?: string; loe?: string }[];
}
interface Draft {
  id: string; topic_id: string; content: Fiche | null; status: string; stage: string; stage_detail: string | null; error: string | null;
  licence_scope: "internal" | "publish"; page_offset: number | null; offset_detected: boolean; pdf_path: string; form: { title: string; licence_text?: string };
  lines: LineMeta[]; dropped: LineMeta[]; models: string[]; coverage: Coverage | null; edit_seconds: number; mode: "auto" | "manual";
  cost: { calls: number; cost_usd: number; by_model: Record<string, number>; input_tokens: number; output_tokens: number; cache_read_tokens: number };
}

const SECTION_LABEL: Record<string, string> = {
  "1_essentiel": "Essentiel", "2_presentation": "Présentation", "3_champ": "Champ", "4_gravite": "Gravité", "5_conduite": "Conduite à tenir",
  "6_examens": "Examens", "7_traitement": "Traitement", "8_ne_pas_faire": "Ne pas faire", "9_orientation": "Orientation",
  "10_surveillance": "Surveillance", "11_suivi": "Suivi", "12_ordonnance": "Ordonnance", "13_definitions": "Définitions",
};
const SUB_LABEL: Record<string, string> = {
  signes_typiques: "Signes typiques", formes_trompeuses: "Formes trompeuses", examen_clinique: "Examen clinique", signes_de_gravite: "Signes de gravité",
  gestes_immediats: "Gestes immédiats", contre_indications: "Contre-indications", elements: "",
};
const STATUTS = ["Enregistré", "Non renouvelé", "Retiré", "Aucune présentation enregistrée"] as const;
const TO_STATUS: Record<string, string> = { "Enregistré": "enregistre", "Non renouvelé": "non_renouvele", "Retiré": "retire", "Aucune présentation enregistrée": "aucune_presentation" };
const FROM_STATUS = Object.fromEntries(Object.entries(TO_STATUS).map(([k, v]) => [v, k]));

/** Every list of lines of the fiche, with where it sits: [label, path to the array]. */
function lineLists(f: Fiche): { section: string; label: string; path: (string | number)[]; items: Line[] }[] {
  const out: { section: string; label: string; path: (string | number)[]; items: Line[] }[] = [];
  for (const [section, sec] of Object.entries(f.sections)) {
    for (const [key, value] of Object.entries(sec)) {
      if (key === "nodes") {
        (value as { node: string; branches: Line[] }[]).forEach((n, i) => out.push({ section, label: n.node, path: ["sections", section, "nodes", i, "branches"], items: n.branches }));
      } else if (Array.isArray(value) && key !== "posologies") {
        out.push({ section, label: SUB_LABEL[key] ?? key, path: ["sections", section, key], items: value as Line[] });
      } else if (value && typeof value === "object" && "elements" in (value as object)) {
        out.push({ section, label: SUB_LABEL[key] ?? key, path: ["sections", section, key, "elements"], items: (value as { elements: Line[] }).elements });
      }
    }
  }
  return out;
}

/** Every quote of the fiche cited on this printed page (lines and doses): marked in the PDF in the second colour. */
function quotesOnPage(f: Fiche | null, printed: number | null): string[] {
  if (!f || printed == null) return [];
  const lines = lineLists(f).flatMap((l) => l.items);
  const doses = (f.sections["7_traitement"]?.posologies as Dose[] | undefined) ?? [];
  return [...lines, ...doses].filter((x) => x.source.page === printed).map((x) => x.source.quote);
}

/** The fiche with a new line at its target (select-to-add): next element id, a new 5_conduite node when asked. */
function insertLine(f: Fiche, target: Target, line: Proposal["line"]): Fiche {
  const next = structuredClone(f);
  const sec = next.sections[target.section] as Record<string, unknown> & { state: string };
  if (target.place === "posologies") {
    (sec.posologies as unknown[]).push(line);
  } else {
    const nums = lineLists(next).flatMap((l) => l.items).map((x) => Number(/-(\d+)$/.exec(x.id ?? "")?.[1] ?? 0));
    const el: Record<string, unknown> = { ...line, id: `${String(next.meta.topic_id)}-${String(Math.max(0, ...nums) + 1).padStart(3, "0")}` };
    if (target.place === "node") {
      const nodes = sec.nodes as { node: string; branches: Record<string, unknown>[] }[];
      let i = target.node ?? nodes.length;
      if (i >= nodes.length) { nodes.push({ node: target.node_label || "Conduite", branches: [] }); i = nodes.length - 1; }
      el.order = nodes[i].branches.length + 1;
      nodes[i].branches.push(el);
    } else if (target.place === "gestes_immediats" || target.place === "contre_indications") {
      const sub = sec[target.place] as { state: string; elements: unknown[] };
      sub.elements.push(el);
      sub.state = "filled";
    } else {
      (sec[target.place] as unknown[]).push(el);
    }
  }
  sec.state = "filled";
  return next;
}

/** Editing time: counted while the page is visible and the reviewer active (a key, a click or a move in the last
 * minute), sent every 30 s. Returns the seconds not yet sent, to show the live total. */
function useEditTime(id: string): number {
  const [pending, setPending] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    last.current = Date.now();
    const seen = () => { last.current = Date.now(); };
    const events = ["keydown", "mousedown", "mousemove", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, seen, { passive: true }));
    let unsent = 0;
    const tick = setInterval(() => {
      if (document.visibilityState === "visible" && Date.now() - last.current < 60_000) { unsent += 5; setPending(unsent); }
    }, 5_000);
    const flush = setInterval(() => {
      if (!unsent) return;
      const seconds = unsent;
      unsent = 0;
      setPending(0);
      api(`/fichegen/drafts/${id}/time`, { method: "POST", body: JSON.stringify({ seconds }) }).catch(() => { unsent += seconds; });
    }, 30_000);
    return () => { events.forEach((e) => window.removeEventListener(e, seen)); clearInterval(tick); clearInterval(flush); };
  }, [id]);
  return pending;
}

const minutes = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`);

function at(obj: unknown, path: (string | number)[]): unknown[] {
  return path.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k], obj) as unknown[];
}

function Badges({ meta, missing }: { meta?: LineMeta; missing: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {meta?.quote_status === "pdf" && <Tag tone="accent">PDF</Tag>}
      {meta?.quote_status === "parsed" && <Tag tone="caution">Parsé</Tag>}
      {meta?.from_figure && <span className="rounded-md bg-[#efe6fb] px-1.5 py-0.5 text-[11px] font-semibold text-[#6b3fa0]">{meta.quote_status === "parsed" ? "Figure : à confirmer" : "Figure"}</span>}
      {missing.map((m, i) => <Tag key={i} tone="urgent">{m.length > 40 ? `${m.slice(0, 40)}…` : m}</Tag>)}
    </span>
  );
}

/**
 * The review screen of a generated draft: the fiche section by section with each line's verification, the quote and
 * PDF page of the line clicked, edits, Algerian brands and status of the doses, the dropped lines, the cost, and the
 * approval (a human action; publication only with a publishable licence and every dose's status filled).
 */
export default function DraftReview() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [d, setD] = useState<Draft | null>(null);
  const [f, setF] = useState<Fiche | null>(null);
  const [doseMeta, setDoseMeta] = useState<(LineMeta | undefined)[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [shown, setShown] = useState<{ page: number | null; quote: string } | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [viewPage, setViewPage] = useState(1);  // the PDF page on screen (not the printed number)
  const [found, setFound] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"pdf" | "text">("pdf");
  const [pageTexts, setPageTexts] = useState<{ printed_page: number; pdf_page: number; text: string; parsed: string | null; skipped: boolean }[] | null>(null);
  const [parsedView, setParsedView] = useState(false);
  const [selection, setSelection] = useState<Part | null>(null);
  const [guideRows, setGuideRows] = useState<GuideRow[] | null>(null);
  const [rowsOpen, setRowsOpen] = useState(true);
  const source = useRef<HTMLDivElement>(null);
  const pendingTime = useEditTime(id);


  const load = useCallback(() => api<Draft>(`/fichegen/drafts/${id}`).then((x) => {
    setD(x);
    if (!dirty) {
      setF(x.content);
      const metas = new Map(x.lines.map((l) => [l.element_id, l]));
      setDoseMeta(((x.content?.sections["7_traitement"]?.posologies as Dose[] | undefined) ?? []).map((_, i) => metas.get(`dose-${i + 1}`)));
    }
  }, (e) => setError((e as Error).message)), [id, dirty]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!d || !RUNNING.has(d.stage) || (d.mode === "manual" && d.stage === "ready" && d.content)) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [d, load]);
  useEffect(() => {
    if (!d?.pdf_path || pdfUrl) return;
    api<{ url: string }>(`/crawl/file?path=${encodeURIComponent(d.pdf_path)}`).then((r) => setPdfUrl(r.url), (e) => setError((e as Error).message));
  }, [d?.pdf_path, pdfUrl]);

  useEffect(() => {
    if (tab !== "text" || pageTexts) return;
    api<NonNullable<typeof pageTexts>>(`/fichegen/drafts/${id}/pages`).then(setPageTexts, (e) => setError((e as Error).message));
  }, [tab, pageTexts, id]);

  const loadRows = useCallback(() => api<GuideRow[]>(`/fichegen/drafts/${id}/rows`).then(setGuideRows, () => setGuideRows([])), [id]);
  useEffect(() => { if (d?.content) void loadRows(); }, [d?.content, loadRows]);

  const metas = useMemo(() => new Map((d?.lines ?? []).map((l) => [l.element_id, l])), [d]);
  if (!d) return <div className="p-6">{error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}</div>;

  // a line clicked: its quote shown, its printed page opened in the PDF (PDF page = printed page - offset)
  const showLine = (x: { page: number | null; quote: string }) => {
    setShown(x);
    setFound(null);
    if (x.page != null && d.page_offset != null) setViewPage(Math.max(1, x.page - d.page_offset));
  };

  const printedOf = (pdfPage: number) => (d.page_offset == null ? pdfPage : pdfPage + d.page_offset);
  // a selection in the source pane (PDF text layer or page text): the passage and its printed page
  const takeSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (text && sel?.anchorNode && source.current?.contains(sel.anchorNode)) setSelection({ page: printedOf(viewPage), text });
  };
  // a guide row clicked: the whole row is the passage, its page opened and the row marked in the PDF
  const pickRow = (r: GuideRow) => {
    setSelection({ page: r.page, text: r.quote, drug: r.drug });
    showLine({ page: r.page, quote: r.quote });
  };
  // N: the next row the fiche does not cover yet, after the one selected, else from the page on screen
  const nextRow = () => {
    const todo = (guideRows ?? []).filter((r) => !r.covered);
    const at = todo.findIndex((r) => r.quote === selection?.text);
    const r = at >= 0 ? todo[at + 1] ?? todo[0] : todo.find((x) => x.page >= printedOf(viewPage)) ?? todo[0];
    if (r) pickRow(r);
  };
  const acceptLine = async (target: Target, line: Proposal["line"]) => {
    if (!f) return;
    const next = insertLine(f, target, line);
    const r = await api<{ quote_check: string }>(`/fichegen/drafts/${id}/content`, { method: "PUT", body: JSON.stringify({ content: next }) });
    next.meta.quote_check = r.quote_check;
    setF(next);
    setDirty(false);
    setSelection(null);
    showLine({ page: line.source.page, quote: line.source.quote });
    void loadRows();
  };
  const run = async (p: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await p;
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const edit = (fn: (x: Fiche) => void) => setF((cur) => {
    if (!cur) return cur;
    const next = structuredClone(cur);
    fn(next);
    setDirty(true);
    return next;
  });
  const doses = (f?.sections["7_traitement"]?.posologies as Dose[] | undefined) ?? [];
  const blocked = [
    d.licence_scope === "internal" && "licence « usage interne seulement »",
    doses.some((x) => !x.algerie.statut) && "statut algérien manquant sur au moins une dose",
    dirty && "modifications non enregistrées",
    !reviewer.trim() && "nom du relecteur",
  ].filter(Boolean) as string[];

  const openInEditor = async () => {
    if (!f) return;
    const protocol = fromLegacy(f);
    sessionStorage.setItem(IMPORT_KEY, JSON.stringify(protocol));
    const { data } = await supabase.from("subjects").select("id").eq("id", protocol.meta.id).maybeSingle();
    router.push(data ? `/fiche/${protocol.meta.id}` : "/fiche/nouveau");
  };

  // while it generates (or before any content): the steps; when done, the editor below replaces them
  if ((RUNNING.has(d.stage) && d.stage !== "ready") || d.stage === "needs_offset" || !f) {
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-5 py-10">
        <Link href="/generation" className="self-start text-sm text-accentink hover:underline">‹ Génération</Link>
        <Card className="flex flex-col gap-6 p-6">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">{d.topic_id}</p>
            <h1 className="mt-1 text-lg font-semibold tracking-tight text-ink">{d.form?.title ?? d.topic_id}</h1>
            <p className="mt-1 text-sm text-soft">L&apos;éditeur s&apos;ouvre ici dès que le PDF est lu.</p>
          </div>
          <Stepper stage={d.stage} detail={d.stage_detail} />
          {error && <ErrorNote>{error}</ErrorNote>}
          {d.error && <ErrorNote>{d.error}</ErrorNote>}
          {d.stage === "needs_offset" && (
            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-cautionbg p-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-caution">Numéros de page non détectés : page imprimée moins page du PDF (ex. 2134 si la page 1 du PDF est la page 2135)</span>
                <input className={`${inputCls} w-40`} value={offset} onChange={(e) => setOffset(e.target.value)} />
              </label>
              <Button variant="primary" disabled={busy || !/^-?\d+$/.test(offset.trim())} onClick={() => run(api(`/fichegen/drafts/${id}/offset`, { method: "POST", body: JSON.stringify({ offset: Number(offset) }) }))}>Valider et générer</Button>
            </div>
          )}
          {d.cost.calls > 0 && <p className="text-xs text-muted">Coût jusqu&apos;ici : {d.cost.cost_usd.toFixed(4)} $ · {d.cost.calls} appel(s)</p>}
        </Card>
      </div>
    );
  }

  const current = (pageTexts ?? []).find((t) => t.pdf_page === viewPage);
  const pageRows = (guideRows ?? []).filter((r) => r.page === printedOf(viewPage));
  const coveredCount = (guideRows ?? []).filter((r) => r.covered).length;
  const nodes = ((f.sections["5_conduite"]?.nodes as { node: string }[] | undefined) ?? []).map((n) => n.node);

  return (
    <div className="grid h-[calc(100dvh-3rem)] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* left: the guideline, selectable; the composer under it */}
      <section className="flex min-h-0 flex-col border-r border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-3 py-2 text-sm">
          <div className="inline-flex rounded-lg border border-edge/15 bg-panel p-0.5">
            {(["pdf", "text"] as const).map((t) => (
              <button key={t} type="button" onClick={() => setTab(t)}
                className={`rounded-md px-3 py-1 text-xs ${tab === t ? "bg-surface font-medium text-ink shadow-surface" : "text-soft hover:text-ink"}`}>{t === "pdf" ? "PDF" : "Texte"}</button>
            ))}
          </div>
          <span className="text-xs text-muted">p. <b className="tabular-nums text-ink">{printedOf(viewPage)}</b></span>
          {tab === "text" && current?.parsed && (
            <label className="flex items-center gap-1 text-xs text-soft"><input type="checkbox" checked={parsedView} onChange={(e) => setParsedView(e.target.checked)} /> parsé</label>
          )}
          {guideRows && guideRows.length > 0 && (
            <div className="ms-auto flex items-center gap-2">
              <div className="hidden h-1.5 w-24 overflow-hidden rounded-full bg-panel sm:block">
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${Math.round((100 * coveredCount) / guideRows.length)}%` }} />
              </div>
              <span className="text-xs tabular-nums text-soft">{coveredCount}/{guideRows.length} lignes du guide</span>
              <button type="button" onClick={nextRow} className="flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs text-soft hover:border-accent/40 hover:text-accentink">
                Suivante <kbd className="font-mono text-[10px] text-muted">N</kbd></button>
            </div>
          )}
        </div>
        <div ref={source} className="min-h-0 flex-1" onMouseUp={takeSelection} onKeyUp={takeSelection}>
          {tab === "pdf" ? (
            pdfUrl ? (
              <PdfViewer url={pdfUrl} page={viewPage} onPageChange={setViewPage}
                quote={shown?.page != null && d.page_offset != null && viewPage === shown.page - d.page_offset ? shown.quote : ""}
                used={quotesOnPage(f, printedOf(viewPage))} onHighlight={(_, ok) => setFound(ok)} />
            ) : <div className="flex justify-center p-6 text-muted"><Spinner /></div>
          ) : (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between border-b border-line px-3 py-1 text-sm">
                <button type="button" className="rounded px-2 text-soft hover:bg-panel disabled:opacity-40" disabled={viewPage <= 1} onClick={() => setViewPage(viewPage - 1)}>‹</button>
                <span className="text-xs text-muted">{current?.skipped ? "références / annexes" : ""}</span>
                <button type="button" className="rounded px-2 text-soft hover:bg-panel" onClick={() => setViewPage(viewPage + 1)}>›</button>
              </div>
              {!pageTexts ? <div className="flex justify-center p-6 text-muted"><Spinner /></div> : (
                <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-4 font-sans text-[13px] leading-relaxed text-ink selection:bg-[#ffe58a]">
                  {(parsedView && current?.parsed) || current?.text || "Page vide."}
                </pre>
              )}
            </div>
          )}
        </div>
        {shown && found === false && tab === "pdf" && <p className="border-t border-line px-3 py-1 text-xs text-caution">Citation non surlignée (figure ou mise en page) : à lire sur la page.</p>}
        {pageRows.length > 0 && (
          <div className="border-t border-line bg-bg/40">
            <button type="button" onClick={() => setRowsOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-soft hover:text-ink">
              <span className="font-medium">Lignes du guide sur cette page</span>
              <span className="tabular-nums text-muted">{pageRows.filter((r) => r.covered).length}/{pageRows.length}</span>
              <span className="ms-auto text-muted">{rowsOpen ? "▾" : "▸"}</span>
            </button>
            {rowsOpen && (
              <ul className="flex max-h-44 flex-col gap-1 overflow-auto px-2 pb-2">
                {pageRows.map((r) => {
                  const on = selection?.text === r.quote;
                  return (
                    <li key={r.id}>
                      <button type="button" onClick={() => pickRow(r)}
                        className={`flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors ${
                          on ? "border-accent/50 bg-tint" : r.covered ? "border-transparent opacity-55 hover:opacity-100" : "border-line bg-surface hover:border-accent/30"}`}>
                        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-px text-[10px] font-semibold ${
                          r.kind === "dose" ? "bg-panel text-soft" : r.harm ? "bg-flagbg text-flag" : "bg-tint text-accentink"}`}>
                          {r.kind === "dose" ? (r.drug ?? "dose") : r.grade?.replace(/^(COR|Classe) /, "").replace(/ \/ (LOE|Niveau) /, "·")}
                        </span>
                        <span className="line-clamp-2 min-w-0 flex-1 text-ink">{r.text}</span>
                        {r.covered && <span className="shrink-0 text-accentink">✓</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
        <Composer draftId={id} selection={selection} nodes={nodes} onAccept={acceptLine} onNext={nextRow}
          onShow={(p) => showLine({ page: p.page, quote: p.text })} />
      </section>

      {/* right: the fiche */}
      <div className="min-h-0 overflow-auto px-5 pb-16">
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link href="/generation" className="text-sm text-accentink hover:underline">‹ Génération</Link>
            <span className="text-xs text-muted">Temps d&apos;édition : <b className="text-ink">{minutes((d.edit_seconds ?? 0) + pendingTime)}</b></span>
          </div>
          <PageHeader title={d.form?.title ?? d.topic_id}
            subtitle={`${d.topic_id} · ${d.status} · citations ${f.meta.quote_check} · ${d.mode === "manual" ? "construite à la main" : "générée"}`} />
          {error && <ErrorNote>{error}</ErrorNote>}
          {d.error && <ErrorNote>{d.error}</ErrorNote>}

          <Card className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              {dirty && <Button variant="primary" disabled={busy} onClick={() => run(api(`/fichegen/drafts/${id}/content`, { method: "PUT", body: JSON.stringify({ content: f }) }).then(() => setDirty(false)))}>Enregistrer</Button>}
              <input className={`${inputCls} w-48`} placeholder="Nom du relecteur" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
              <Button disabled={busy || dirty || !reviewer.trim()} onClick={() => run(api(`/fichegen/drafts/${id}/approve`, { method: "POST", body: JSON.stringify({ status: "review", reviewer }) }))}>Marquer relu</Button>
              <Button variant="primary" disabled={busy || blocked.length > 0} title={blocked.length ? `Bloqué : ${blocked.join(", ")}` : "Publier"}
                onClick={() => run(api(`/fichegen/drafts/${id}/approve`, { method: "POST", body: JSON.stringify({ status: "published", reviewer }) }))}>Publier</Button>
              {["review", "published"].includes(d.status) && <Button onClick={openInEditor}>Ouvrir en v1.1</Button>}
            </div>
            {blocked.length > 0 && <p className="text-xs text-caution">Publication bloquée : {blocked.join(", ")}.</p>}
            <p className="text-xs text-muted">
              Coût IA : {d.cost.cost_usd.toFixed(4)} $ ({d.cost.calls} appel(s)) · Licence : {d.licence_scope === "internal" ? "usage interne seulement" : "publication autorisée"}
              {f.meta.excluded_by_audience.length > 0 && ` · Hors champ : ${f.meta.excluded_by_audience.join(" · ")}`}
            </p>
          </Card>

          {f && Object.keys(SECTION_LABEL).map((section) => {
            const lists = lineLists(f).filter((l) => l.section === section && l.items.length);
            const sec = f.sections[section];
            const showDoses = section === "7_traitement" && doses.length > 0;
            return (
              <Card key={section} className="flex flex-col gap-2 p-4">
                <h2 className="text-sm font-semibold text-ink">{SECTION_LABEL[section]} <span className="text-xs font-normal text-muted">({String(sec?.state)})</span></h2>
                {lists.map((l) => (
                  <div key={l.path.join("/")} className="flex flex-col gap-1">
                    {l.label && <p className="text-xs font-medium text-soft">{l.label}</p>}
                    {l.items.map((line, i) => (
                      <div key={line.id} className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
                        shown?.quote === line.source.quote && shown?.page === line.source.page ? "bg-tint ring-1 ring-accent/30" : "hover:bg-panel/60"}`}>
                        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => showLine({ page: line.source.page, quote: line.source.quote })}>
                          <textarea rows={1} className="w-full resize-y bg-transparent text-sm text-ink outline-none" value={line.text}
                            onClick={(e) => e.stopPropagation()} onChange={(e) => edit((x) => { (at(x, l.path)[i] as Line).text = e.target.value; })} />
                          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            {line.condition && <span>si {line.condition} ·</span>}
                            <span>p. {line.source.page}</span>{line.grade && <span>· {line.grade}</span>}
                            <Badges meta={metas.get(line.id)} missing={line.missing} />
                          </div>
                        </div>
                        <button type="button" className="text-xs text-flag hover:underline" onClick={() => edit((x) => { at(x, l.path).splice(i, 1); })}>Supprimer</button>
                      </div>
                    ))}
                  </div>
                ))}
                {showDoses && (
                  <div className="flex flex-col gap-2">
                    <p className="text-xs font-medium text-soft">Posologies</p>
                    {doses.map((x, i) => (
                      <div key={i} className="flex flex-col gap-1.5 rounded-lg bg-panel/50 p-2">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1 cursor-pointer text-sm" onClick={() => showLine({ page: x.source.page, quote: x.source.quote })}>
                            <b>{x.drug_dci}</b> {x.dose}{x.dose_max ? ` (max ${x.dose_max})` : ""} · {x.route} · {x.frequency_or_duration}{x.condition ? ` · si ${x.condition}` : ""}
                            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted"><span>p. {x.source.page}</span><Badges meta={doseMeta[i]} missing={x.missing} /></div>
                          </div>
                          <button type="button" className="text-xs text-flag hover:underline"
                            onClick={() => { edit((y) => { (y.sections["7_traitement"].posologies as Dose[]).splice(i, 1); }); setDoseMeta((m) => m.filter((_, k) => k !== i)); }}>Supprimer</button>
                        </div>
                        <BrandPicker
                          med={{ inn: x.drug_dci, prescriber: null, local_availability: { country: "DZ", status: (x.algerie.statut ? TO_STATUS[x.algerie.statut] : null) as Medication["local_availability"]["status"], brands: x.algerie.brands } } as unknown as Medication}
                          onChange={(patch) => edit((y) => {
                            const dose = (y.sections["7_traitement"].posologies as Dose[])[i];
                            if (patch.local_availability) {
                              dose.algerie.brands = patch.local_availability.brands;
                              dose.algerie.statut = patch.local_availability.status ? FROM_STATUS[patch.local_availability.status] : null;
                            }
                            dose.missing = dose.algerie.statut ? dose.missing.filter((m) => m !== "algerie.statut") : [...new Set([...dose.missing, "algerie.statut"])];
                          })} />
                        <label className="flex items-center gap-2 text-xs text-muted">
                          Statut :
                          <select className={`${inputCls} h-8`} value={x.algerie.statut ?? ""} onChange={(e) => edit((y) => {
                            const dose = (y.sections["7_traitement"].posologies as Dose[])[i];
                            dose.algerie.statut = e.target.value || null;
                            dose.missing = dose.algerie.statut ? dose.missing.filter((m) => m !== "algerie.statut") : [...new Set([...dose.missing, "algerie.statut"])];
                          })}>
                            <option value="">à compléter</option>
                            {STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </label>
                      </div>
                    ))}
                  </div>
                )}
                {!lists.length && !showDoses && <p className="text-xs text-muted">Rien pour cette section.</p>}
              </Card>
            );
          })}

          {d.coverage && (
            <Card className="flex flex-col gap-1 p-4">
              <h2 className="text-sm font-semibold text-ink">
                Couverture {d.coverage.pct} % <span className="text-xs font-normal text-muted">
                  ({d.coverage.matched} lignes du guide couvertes + {d.coverage.excluded} hors public sur {d.coverage.rows} : {d.coverage.rec_rows} recommandations, {d.coverage.dose_rows} posologies ·
                  « 3: Harm / No Benefit » en Ne pas faire : {d.coverage.harm_in_8}/{d.coverage.harm_rows})</span>
              </h2>
              {d.coverage.uncovered.map((r, i) => (
                <div key={i} className="cursor-pointer rounded-lg px-2 py-1 text-sm hover:bg-panel/60" onClick={() => showLine({ page: r.page, quote: r.text })}>
                  <span className="me-2 inline-block"><Tag tone="caution">Non couvert</Tag></span>
                  <span className="text-ink">{r.text}</span>
                  <span className="text-xs text-muted"> · p. {r.page}{r.cor ? ` · COR ${r.cor} / LOE ${r.loe}` : " · posologie"}</span>
                </div>
              ))}
            </Card>
          )}

          {d.dropped.length > 0 && (
            <Card className="flex flex-col gap-1 p-4">
              <h2 className="text-sm font-semibold text-ink">Écartées ({d.dropped.length})</h2>
              {d.dropped.map((x) => (
                <div key={x.element_id} className="cursor-pointer rounded-lg px-2 py-1 text-sm hover:bg-panel/60"
                  onClick={() => x.dropped_line && showLine({ page: x.dropped_line.source.page, quote: x.dropped_line.source.quote })}>
                  <span className="text-ink">{x.dropped_line?.text ?? (x.dropped_line as unknown as Dose | null)?.drug_dci}</span>
                  <span className="text-xs text-muted"> · {SECTION_LABEL[x.section] ?? x.section} · {x.reason}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
