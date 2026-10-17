"use client";

import { fromLegacy, type Medication } from "@medguides/schema";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BrandPicker } from "@/components/editor/BrandPicker";
import type { PdfSelection } from "@/components/fichegen/ContinuousPdf";
import { LineCard } from "@/components/fichegen/LineCard";
import { RUNNING, Stepper } from "@/components/GenerationProgress";
import { Button, Card, ErrorNote, inputCls, Spinner, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { KEYS, type Part, PLACES, type Proposal, SECTION_LABEL, SUB_LABEL, type Target, targetLabel } from "@/lib/fichegen";
import { IMPORT_KEY } from "@/lib/fiche-import";
import { createClient } from "@/lib/supabase/client";

const ContinuousPdf = dynamic(() => import("@/components/fichegen/ContinuousPdf"), { ssr: false, loading: () => <p className="p-6 text-sm text-muted">Chargement du PDF…</p> });

/** A line of a fiche-protocole fiche (element) and a dose. */
interface Line { id: string; text: string; type: string; condition: string | null; source: { source_id: string; page: number | null; quote: string }; grade: string | null; missing: string[] }
interface Dose {
  drug_dci: string; dose: string; dose_max: string | null; route: string; frequency_or_duration: string; condition: string | null;
  source: { page: number | null; quote: string }; missing: string[]; algerie: { brands: string[]; statut: string | null }; note: string | null;
}
type Fiche = { meta: Record<string, unknown> & { title: string; status: string; quote_check: string; excluded_by_audience: string[] }; sections: Record<string, Record<string, unknown>> };
interface LineMeta { element_id: string; section: string; quote_status: "pdf" | "parsed" | "failed" | null; from_figure: boolean; dropped: boolean; dropped_line: Line | null; reason: string | null }
interface Draft {
  id: string; topic_id: string; content: Fiche | null; status: string; stage: string; stage_detail: string | null; error: string | null;
  licence_scope: "internal" | "publish"; page_offset: number | null; offset_detected: boolean; pdf_path: string; form: { title: string; licence_text?: string };
  lines: LineMeta[]; dropped: LineMeta[]; edit_seconds: number; mode: "auto" | "manual";
  cost: { calls: number; cost_usd: number };
}
/** A recommendation or dose row of the guideline (GET /rows), and whether the fiche covers it. */
interface GuideRow { id: string; kind: "rec" | "dose"; page: number; text: string; quote: string; grade: string | null; harm: boolean; drug: string | null; covered: boolean }

const STATUTS = ["Enregistré", "Non renouvelé", "Retiré", "Aucune présentation enregistrée"] as const;
const TO_STATUS: Record<string, string> = { "Enregistré": "enregistre", "Non renouvelé": "non_renouvele", "Retiré": "retire", "Aucune présentation enregistrée": "aucune_presentation" };
const FROM_STATUS = Object.fromEntries(Object.entries(TO_STATUS).map(([k, v]) => [v, k]));
const SECTIONS = Object.keys(SECTION_LABEL).filter((s) => s !== "12_ordonnance");

/** Every list of lines of the fiche, with where it sits. */
function lineLists(f: Fiche): { section: string; place: string; label: string; path: (string | number)[]; items: Line[] }[] {
  const out: { section: string; place: string; label: string; path: (string | number)[]; items: Line[] }[] = [];
  for (const [section, sec] of Object.entries(f.sections)) {
    for (const [key, value] of Object.entries(sec)) {
      if (key === "nodes") {
        (value as { node: string; branches: Line[] }[]).forEach((n, i) => out.push({ section, place: "node", label: n.node, path: ["sections", section, "nodes", i, "branches"], items: n.branches }));
      } else if (Array.isArray(value) && key !== "posologies") {
        out.push({ section, place: key, label: SUB_LABEL[key] ?? key, path: ["sections", section, key], items: value as Line[] });
      } else if (value && typeof value === "object" && "elements" in (value as object)) {
        out.push({ section, place: key, label: SUB_LABEL[key] ?? key, path: ["sections", section, key, "elements"], items: (value as { elements: Line[] }).elements });
      }
    }
  }
  return out;
}
const dosesOf = (f: Fiche) => (f.sections["7_traitement"]?.posologies as Dose[] | undefined) ?? [];
const countOf = (f: Fiche, section: string) => lineLists(f).filter((l) => l.section === section).reduce((n, l) => n + l.items.length, 0) + (section === "7_traitement" ? dosesOf(f).length : 0);

function at(obj: unknown, path: (string | number)[]): unknown[] {
  return path.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k], obj) as unknown[];
}

/** The fiche with a new line at its target: next element id, a new 5_conduite node when asked. */
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

/** Editing time: counted while the page is visible and the reviewer active in the last minute, sent every 30 s. */
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
const minutes = (s: number) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`);
const typingIn = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/**
 * The fiche editor: the guideline PDF on the left in one scroll, the fiche on the right section by section. Select
 * text in the PDF (or click a guide row, or paste into "+ Ajouter"), choose the section (keys 1-9), fill the defined
 * fields, Ctrl+Enter. Every line keeps its exact quote and printed page; checks run on each.
 */
export default function DraftEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [d, setD] = useState<Draft | null>(null);
  const [f, setF] = useState<Fiche | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ pdfPage: number; quote: string; nonce: number } | null>(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [sel, setSel] = useState<(Part & { rect?: PdfSelection["rect"] }) | null>(null);
  const [card, setCard] = useState<{ key: number; target: Target; parts: Part[] } | null>(null);
  const [last, setLast] = useState<Target>(KEYS[5].target);
  const [tab, setTab] = useState<"fiche" | "guide">("fiche");
  const [guideRows, setGuideRows] = useState<GuideRow[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const pendingTime = useEditTime(id);

  const load = useCallback(() => api<Draft>(`/fichegen/drafts/${id}`).then((x) => {
    setD(x);
    if (!dirty) setF(x.content);
  }, (e) => setError((e as Error).message)), [id, dirty]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!d || !RUNNING.has(d.stage) || (d.stage === "ready" && d.content)) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [d, load]);
  useEffect(() => {
    if (!d?.pdf_path || pdfUrl) return;
    api<{ url: string }>(`/crawl/file?path=${encodeURIComponent(d.pdf_path)}`).then((r) => setPdfUrl(r.url), (e) => setError((e as Error).message));
  }, [d?.pdf_path, pdfUrl]);
  const loadRows = useCallback(() => api<GuideRow[]>(`/fichegen/drafts/${id}/rows`).then(setGuideRows, () => setGuideRows([])), [id]);
  useEffect(() => { if (d?.content) void loadRows(); }, [d?.content, loadRows]);

  const offsetN = d?.page_offset ?? 0;
  const usedOn = useCallback((pdf: number) => {
    if (!f) return [];
    const p = pdf + offsetN;
    return [...lineLists(f).flatMap((l) => l.items), ...dosesOf(f)].filter((x) => x.source.page === p).map((x) => x.source.quote);
  }, [f, offsetN]);
  const onPdfSelect = useCallback((s: PdfSelection | null) => {
    setSel(s ? { page: s.pdfPage + offsetN, text: s.text, rect: s.rect } : null);
  }, [offsetN]);
  const show = useCallback((p: { page: number | null; quote: string }) => {
    if (p.page == null) return;
    setFocus({ pdfPage: Math.max(1, p.page - offsetN), quote: p.quote, nonce: Date.now() });
  }, [offsetN]);
  const openCard = useCallback((target: Target, parts: Part[]) => {
    if (target.place !== "node") setLast(target);
    setTab("fiche");
    setCard({ key: Date.now(), target, parts });
    setMenu(null);
    setSel((s) => (s ? { ...s, rect: undefined } : s));
    requestAnimationFrame(() => document.getElementById(`sec-${target.section}`)?.scrollIntoView({ block: "start", behavior: "smooth" }));
  }, []);
  const pickRow = useCallback((r: GuideRow) => {
    setSel({ page: r.page, text: r.quote, drug: r.drug });
    show({ page: r.page, quote: r.quote });
  }, [show]);
  const nextRow = useCallback(() => {
    const todo = (guideRows ?? []).filter((r) => !r.covered);
    const i = todo.findIndex((r) => r.quote === sel?.text);
    const r = i >= 0 ? todo[i + 1] ?? todo[0] : todo.find((x) => x.page >= pdfPage + offsetN) ?? todo[0];
    if (r) pickRow(r);
  }, [guideRows, sel, pdfPage, offsetN, pickRow]);

  // keys: 1-9 add the selection to a section, Enter to the last one, N the next guide row, Esc clears
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSel(null); setMenu(null); return; }
      if (typingIn(e) || e.metaKey || e.ctrlKey || e.altKey || card) return;
      const k = KEYS.find((x) => x.key === e.key);
      if (k && sel) { e.preventDefault(); openCard(k.target, [{ page: sel.page, text: sel.text, drug: sel.drug }]); return; }
      if (e.key === "Enter" && sel) { e.preventDefault(); openCard(last, [{ page: sel.page, text: sel.text, drug: sel.drug }]); return; }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); nextRow(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sel, card, last, openCard, nextRow]);

  if (!d) return <div className="p-6">{error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}</div>;

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
  const save = () => run(api(`/fichegen/drafts/${id}/content`, { method: "PUT", body: JSON.stringify({ content: f }) }).then(() => { setDirty(false); void loadRows(); }));
  const acceptLine = async (target: Target, line: Proposal["line"]) => {
    if (!f) return;
    const next = insertLine(f, target, line);
    const r = await api<{ quote_check: string }>(`/fichegen/drafts/${id}/content`, { method: "PUT", body: JSON.stringify({ content: next }) });
    next.meta.quote_check = r.quote_check;
    setF(next);
    setDirty(false);
    setCard(null);
    setSel(null);
    window.getSelection()?.removeAllRanges();
    void loadRows();
  };
  const openInEditor = async () => {
    if (!f) return;
    const protocol = fromLegacy(f);
    sessionStorage.setItem(IMPORT_KEY, JSON.stringify(protocol));
    const { data } = await supabase.from("subjects").select("id").eq("id", protocol.meta.id).maybeSingle();
    router.push(data ? `/fiche/${protocol.meta.id}` : "/fiche/nouveau");
  };

  // before the PDF is read: the steps (and the page offset when it was not detected)
  if ((RUNNING.has(d.stage) && d.stage !== "ready") || d.stage === "needs_offset" || !f) {
    return (
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-5 py-10">
        <Link href="/generation" className="self-start text-sm text-accentink hover:underline">‹ Fiches</Link>
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
              <Button variant="primary" disabled={busy || !/^-?\d+$/.test(offset.trim())} onClick={() => run(api(`/fichegen/drafts/${id}/offset`, { method: "POST", body: JSON.stringify({ offset: Number(offset) }) }))}>Valider</Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  const doses = dosesOf(f);
  const lists = lineLists(f);
  const nodes = ((f.sections["5_conduite"]?.nodes as { node: string }[] | undefined) ?? []).map((n) => n.node);
  const total = SECTIONS.reduce((n, s) => n + countOf(f, s), 0);
  const covered = (guideRows ?? []).filter((r) => r.covered).length;
  const todo = (guideRows ?? []).filter((r) => !r.covered);
  const metas = new Map((d.lines ?? []).map((l) => [l.element_id, l]));
  const blocked = [
    d.licence_scope === "internal" && "licence « usage interne seulement »",
    doses.some((x) => !x.algerie.statut) && "statut algérien manquant sur une dose",
    dirty && "modifications non enregistrées",
    !reviewer.trim() && "nom du relecteur",
  ].filter(Boolean) as string[];
  const selPart: Part[] = sel ? [{ page: sel.page, text: sel.text, drug: sel.drug }] : [];

  const lineRow = (line: Line, path: (string | number)[], i: number) => {
    const meta = metas.get(line.id);
    const on = !!focus && line.source.page === focus.pdfPage + offsetN && focus.quote === line.source.quote;
    return (
      <li key={line.id} className={`group flex gap-3 rounded-lg px-3 py-2.5 transition-colors ${on ? "bg-tint" : "hover:bg-panel/60"}`}>
        <div className="min-w-0 flex-1">
          {editing === line.id ? (
            <textarea autoFocus rows={2} className={`${inputCls} h-auto w-full resize-y py-1.5 text-sm`} value={line.text}
              onBlur={() => setEditing(null)} onChange={(e) => edit((x) => { (at(x, path)[i] as Line).text = e.target.value; })} />
          ) : (
            <p className="cursor-text text-[14px] leading-snug text-ink" onClick={() => setEditing(line.id)}>{line.text}</p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            {line.condition && <span>si {line.condition}</span>}
            <button type="button" className="tabular-nums hover:text-accentink" onClick={() => show(line.source)}>p. {line.source.page}</button>
            {line.grade && <span>{line.grade}</span>}
            {meta?.from_figure && <span className="text-caution">figure : à confirmer</span>}
            {line.missing.map((m, k) => <span key={k} className="text-flag">manque : {m}</span>)}
          </p>
        </div>
        <div className="flex shrink-0 items-start gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button type="button" className="rounded px-1.5 py-0.5 text-xs text-soft hover:bg-surface hover:text-ink" onClick={() => show(line.source)}>Voir</button>
          <button type="button" className="rounded px-1.5 py-0.5 text-xs text-soft hover:bg-surface hover:text-ink" onClick={() => setEditing(line.id)}>Modifier</button>
          <button type="button" className="rounded px-1.5 py-0.5 text-xs text-flag hover:bg-flagbg" onClick={() => edit((x) => { at(x, path).splice(i, 1); })}>Supprimer</button>
        </div>
      </li>
    );
  };

  return (
    <div className="grid h-[calc(100dvh-3rem)] grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* ── the guideline ── */}
      <section className="relative flex min-h-0 flex-col border-r border-line">
        <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-sm">
          <span className="font-medium text-ink">Guide</span>
          <span className="text-xs text-muted">page <b className="tabular-nums text-ink">{pdfPage + offsetN}</b></span>
          <span className="ms-auto hidden text-xs text-muted md:inline">Sélectionnez un passage, puis une section (<kbd className="font-mono">1</kbd>–<kbd className="font-mono">9</kbd>)</span>
        </div>
        <div className="min-h-0 flex-1">
          {pdfUrl ? <ContinuousPdf url={pdfUrl} focus={focus} usedOn={usedOn} onPage={setPdfPage} onSelect={onPdfSelect} />
            : <div className="flex justify-center p-8 text-muted"><Spinner /></div>}
        </div>

        {/* the bar next to a selection */}
        {sel?.rect && !card && (
          <div className="fixed z-30 flex -translate-x-1/2 flex-wrap items-center gap-1 rounded-xl border border-edge/15 bg-surface p-1 shadow-[0_12px_40px_-8px_rgba(0,0,0,0.35)]"
            style={{ left: Math.max(280, sel.rect.x), top: Math.max(56, sel.rect.y - 52) }}>
            <span className="px-2 text-[11px] font-medium text-muted">Ajouter à</span>
            {KEYS.map((k) => (
              <button key={k.key} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => openCard(k.target, selPart)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink hover:bg-tint hover:text-accentink">
                <span className="font-mono text-[10px] text-muted">{k.key}</span>{k.label}
              </button>
            ))}
          </div>
        )}
        {sel && !sel.rect && !card && (
          <div className="absolute inset-x-4 bottom-4 z-20 flex items-center gap-3 rounded-xl border border-accent/30 bg-surface px-4 py-3 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)]">
            <span className="shrink-0 text-xs font-semibold text-accentink">p. {sel.page}</span>
            <span className="line-clamp-2 min-w-0 flex-1 text-xs text-ink">{sel.text}</span>
            <span className="shrink-0 text-[11px] text-muted"><kbd className="font-mono">1</kbd>–<kbd className="font-mono">9</kbd> ou <kbd className="font-mono">Entrée</kbd> ({targetLabel(last)})</span>
          </div>
        )}
      </section>

      {/* ── the fiche ── */}
      <section className="flex min-h-0 flex-col bg-bg">
        <header className="flex flex-col gap-3 border-b border-line bg-surface px-5 py-3">
          <div className="flex items-center gap-3">
            <Link href="/generation" className="text-sm text-muted hover:text-accentink">‹</Link>
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold tracking-tight text-ink">{d.form?.title ?? d.topic_id}</h1>
              <p className="text-xs text-muted">{total} ligne(s) · citations {f.meta.quote_check} · {minutes((d.edit_seconds ?? 0) + pendingTime)} d&apos;édition{d.licence_scope === "internal" ? " · usage interne" : ""}</p>
            </div>
            {dirty && <Button variant="primary" className="h-8" disabled={busy} onClick={save}>Enregistrer</Button>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-edge/15 bg-panel p-0.5 text-xs">
              <button type="button" onClick={() => setTab("fiche")} className={`rounded-md px-3 py-1 ${tab === "fiche" ? "bg-surface font-medium text-ink shadow-surface" : "text-soft"}`}>Fiche</button>
              <button type="button" onClick={() => setTab("guide")} className={`rounded-md px-3 py-1 ${tab === "guide" ? "bg-surface font-medium text-ink shadow-surface" : "text-soft"}`}>
                À couvrir {guideRows ? <span className="tabular-nums text-muted">{todo.length}</span> : null}</button>
            </div>
            {guideRows && guideRows.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-20 overflow-hidden rounded-full bg-panel"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((100 * covered) / guideRows.length)}%` }} /></div>
                <span className="text-[11px] tabular-nums text-muted">{covered}/{guideRows.length} du guide</span>
                <button type="button" onClick={nextRow} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-soft hover:border-accent/40 hover:text-accentink">Suivante <kbd className="font-mono">N</kbd></button>
              </div>
            )}
            <div className="ms-auto flex items-center gap-1.5">
              <input className={`${inputCls} h-8 w-36 text-xs`} placeholder="Relecteur" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
              <Button className="h-8" disabled={busy || dirty || !reviewer.trim()} onClick={() => run(api(`/fichegen/drafts/${id}/approve`, { method: "POST", body: JSON.stringify({ status: "review", reviewer }) }))}>Relu</Button>
              <Button variant="primary" className="h-8" disabled={busy || blocked.length > 0} title={blocked.length ? `Bloqué : ${blocked.join(", ")}` : "Publier"}
                onClick={() => run(api(`/fichegen/drafts/${id}/approve`, { method: "POST", body: JSON.stringify({ status: "published", reviewer }) }))}>Publier</Button>
              {["review", "published"].includes(d.status) && <Button className="h-8" onClick={openInEditor}>v1.1</Button>}
            </div>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          {tab === "fiche" && (
            <nav className="-mx-1 flex gap-1 overflow-x-auto pb-0.5">
              {SECTIONS.map((s) => {
                const n = countOf(f, s);
                return (
                  <button key={s} type="button" onClick={() => document.getElementById(`sec-${s}`)?.scrollIntoView({ block: "start", behavior: "smooth" })}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${n ? "bg-tint text-accentink" : "text-muted hover:bg-panel"}`}>
                    {SECTION_LABEL[s]}<span className="tabular-nums opacity-70">{n}</span>
                  </button>
                );
              })}
            </nav>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          {tab === "guide" ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted">Recommandations et posologies du guide pas encore dans la fiche. Cliquez une ligne : elle s&apos;ouvre dans le PDF, puis choisissez sa section (<kbd className="font-mono">1</kbd>–<kbd className="font-mono">9</kbd>).</p>
              {!guideRows ? <Spinner /> : todo.length === 0 ? <p className="py-8 text-center text-sm text-accentink">Tout le guide est couvert.</p> : todo.map((r) => (
                <button key={r.id} type="button" onClick={() => pickRow(r)}
                  className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${sel?.text === r.quote ? "border-accent/50 bg-tint" : "border-line bg-surface hover:border-accent/30"}`}>
                  <span className="w-12 shrink-0 text-xs tabular-nums text-muted">p. {r.page}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${r.kind === "dose" ? "bg-panel text-soft" : r.harm ? "bg-flagbg text-flag" : "bg-tint text-accentink"}`}>
                    {r.kind === "dose" ? (r.drug ?? "dose") : r.grade}</span>
                  <span className="line-clamp-3 min-w-0 flex-1 text-[13px] leading-snug text-ink">{r.kind === "dose" ? r.quote : r.text}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {SECTIONS.map((section) => {
                const secLists = lists.filter((l) => l.section === section && l.items.length);
                const n = countOf(f, section);
                const places = PLACES[section] ?? ["elements"];
                return (
                  <article key={section} id={`sec-${section}`} className="scroll-mt-2 rounded-2xl border border-edge/[0.07] bg-surface shadow-surface">
                    <div className="flex items-center gap-2 px-4 pb-2 pt-3">
                      <h2 className="text-sm font-semibold text-ink">{SECTION_LABEL[section]}</h2>
                      <span className="text-xs tabular-nums text-muted">{n || "vide"}</span>
                      <div className="relative ms-auto">
                        <button type="button" onClick={() => (places.length === 1 ? openCard({ section, place: places[0] }, selPart) : setMenu(menu === section ? null : section))}
                          className="rounded-lg px-2.5 py-1 text-xs font-medium text-accentink hover:bg-tint">+ Ajouter</button>
                        {menu === section && (
                          <div className="absolute right-0 z-20 mt-1 flex min-w-44 flex-col rounded-xl border border-edge/15 bg-surface p-1 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)]">
                            {places.map((p) => (
                              <button key={p} type="button" className="rounded-lg px-3 py-1.5 text-left text-xs text-ink hover:bg-tint" onClick={() => openCard({ section, place: p }, selPart)}>
                                {p === "elements" ? "Ligne" : SUB_LABEL[p]}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {card?.target.section === section && (
                      <div className="px-3 pb-3">
                        <LineCard key={card.key} draftId={id} target={card.target} parts={card.parts} nodes={nodes} selection={selPart[0] ?? null}
                          onAccept={acceptLine} onCancel={() => setCard(null)} onShow={(p) => show({ page: p.page, quote: p.text })} />
                      </div>
                    )}
                    {n > 0 && (
                      <div className="px-1 pb-2">
                        {secLists.map((l) => (
                          <div key={l.path.join("/")}>
                            {(l.label || l.place === "node") && <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">{l.place === "node" ? `▸ ${l.label}` : l.label}</p>}
                            <ul>{l.items.map((line, i) => lineRow(line, l.path, i))}</ul>
                          </div>
                        ))}
                        {section === "7_traitement" && doses.length > 0 && (
                          <div>
                            <p className="px-3 pb-0.5 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Posologies</p>
                            <ul>
                              {doses.map((x, i) => (
                                <li key={i} className="group flex flex-col gap-2 rounded-lg px-3 py-2.5 hover:bg-panel/60">
                                  <div className="flex gap-3">
                                    <div className="min-w-0 flex-1 text-[14px] text-ink">
                                      <b className="font-semibold">{x.drug_dci}</b> · {x.dose}{x.dose_max ? ` (max ${x.dose_max})` : ""} · {x.route} · {x.frequency_or_duration}
                                      <p className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted">
                                        {x.condition && <span>si {x.condition}</span>}
                                        <button type="button" className="tabular-nums hover:text-accentink" onClick={() => show(x.source)}>p. {x.source.page}</button>
                                        <span className={x.algerie.statut ? "text-accentink" : "text-caution"}>{x.algerie.statut ?? "statut algérien à compléter"}</span>
                                      </p>
                                    </div>
                                    <button type="button" className="shrink-0 self-start rounded px-1.5 py-0.5 text-xs text-flag opacity-0 hover:bg-flagbg group-hover:opacity-100"
                                      onClick={() => edit((y) => { (y.sections["7_traitement"].posologies as Dose[]).splice(i, 1); })}>Supprimer</button>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
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
                                    <select className={`${inputCls} h-8 text-xs`} value={x.algerie.statut ?? ""} onChange={(e) => edit((y) => {
                                      const dose = (y.sections["7_traitement"].posologies as Dose[])[i];
                                      dose.algerie.statut = e.target.value || null;
                                      dose.missing = dose.algerie.statut ? dose.missing.filter((m) => m !== "algerie.statut") : [...new Set([...dose.missing, "algerie.statut"])];
                                    })}>
                                      <option value="">Statut : à compléter</option>
                                      {STATUTS.map((s) => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              {d.dropped.length > 0 && (
                <details className="rounded-2xl border border-edge/[0.07] bg-surface px-4 py-3 text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-muted">Lignes écartées par la génération automatique ({d.dropped.length})</summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {d.dropped.map((x) => (
                      <li key={x.element_id} className="cursor-pointer text-xs text-soft hover:text-ink" onClick={() => x.dropped_line && show(x.dropped_line.source)}>
                        {x.dropped_line?.text ?? (x.dropped_line as unknown as Dose | null)?.drug_dci} <span className="text-muted">· {x.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {blocked.length > 0 && <p className="px-1 text-xs text-muted">Publication : {blocked.join(" · ")}.</p>}
              {f.meta.excluded_by_audience.length > 0 && <p className="px-1 text-xs text-muted">Hors champ pour ce public : {f.meta.excluded_by_audience.join(" · ")}</p>}
              <div className="flex justify-center pb-6"><Tag>{d.mode === "manual" ? "Fiche construite à la main" : "Fiche issue de la génération"}</Tag></div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
