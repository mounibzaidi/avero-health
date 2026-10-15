"use client";

import {
  emptyProtocol, evidenceLines, publicationGate, quoteKey, SECTION_TITLE, TEMPLATE_LABEL, validateStructure,
  type Issue, type Protocol, type QuoteResult, type Template,
} from "@medguides/schema";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { Block, IssuesCtx, ShowCtx, Text, type Shown } from "@/components/editor/fields";
import { EnvCtx, Items, type EditorEnv } from "@/components/editor/ItemEditor";
import { Medications } from "@/components/editor/MedicationEditor";
import { MetaEditor, ReviewEditor, SourcesEditor } from "@/components/editor/MetaEditors";
import { PathwayEditor } from "@/components/editor/PathwayEditor";
import { FollowUps, Referrals } from "@/components/editor/ReferFollowEditor";
import { SidePanel } from "@/components/editor/SidePanel";
import { Button, ErrorNote, inputCls, Spinner, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

// A fiche of Protocol Schema v1.1 (docs/protocol_schema_v1.1.md), edited section by section in the screen order.
// The side panel shows both validator levels and the quote check, live. Publishing is possible only when the
// publication gate passes. Every save is a new version; publishing saves a published version.

type QuoteState = { sig: string; results: Record<string, QuoteResult> };
const NOT_CHECKED: Record<string, QuoteResult> = {};

/** Every line id of the fiche, with the section it is in (to count a section's issues). */
function lineSections(p: Protocol): Map<string, string> {
  const m = new Map<string, string>();
  const put = (sec: string, ids: { id: string }[]) => ids.forEach((x) => m.set(x.id, sec));
  put("red_box", [...p.red_box.signs, ...p.red_box.actions]);
  put("assess", [...p.assess.ask, ...p.assess.examine, ...p.assess.tests, ...p.assess.pathway.nodes, ...p.assess.pathway.nodes.flatMap((n) => n.items)]);
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

function Section({ id, title, count, issues, children }: { id: string; title: string; count?: number; issues: number; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section id={`section-${id}`} className="scroll-mt-16 border-t border-line pt-4 first:border-0">
      <button type="button" className="mb-2 flex w-full items-baseline gap-2 text-left" onClick={() => setOpen(!open)}>
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        {count !== undefined && <span className="text-xs text-muted">{count} ligne{count > 1 ? "s" : ""}</span>}
        {issues > 0 && <span className="rounded bg-flagbg px-1.5 text-xs font-medium text-flag">{issues}</span>}
        <span className="text-xs text-muted">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="flex flex-col gap-4">{children}</div>}
    </section>
  );
}

export default function FicheEditor() {
  const { id } = useParams<{ id: string }>();
  const fresh = id === "nouveau";
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { session, staff, isAdmin } = useAuth();
  const me = staff?.name || session?.user.email || "";

  const [f, setF] = useState<Protocol | null>(null);
  const [version, setVersion] = useState(0); // the latest saved version; 0 for a new fiche
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [published, setPublished] = useState<Set<string>>(new Set());
  const [pdfs, setPdfs] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; title: string; template: Template }>({ id: "", title: "", template: "urgence" });
  const [quotes, setQuotes] = useState<QuoteState>({ sig: "", results: {} });
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);

  useEffect(() => {
    void (async () => {
      const [pub, sp] = await Promise.all([supabase.from("published_fiches").select("subject_id"), supabase.from("source_pdfs").select("source_id,pdf_path")]);
      setPublished(new Set((pub.data ?? []).map((r: { subject_id: string }) => r.subject_id)));
      setPdfs(Object.fromEntries((sp.data ?? []).map((r: { source_id: string; pdf_path: string }) => [r.source_id, r.pdf_path])));
      if (fresh) return;
      const { data, error } = await supabase.from("fiche_versions").select("version,content,published_at").eq("subject_id", id).order("version", { ascending: false });
      if (error || !data?.length) return setError(error?.message ?? "Fiche introuvable");
      const { protocol, issues } = validateStructure(data[0].content);
      if (!protocol) return setError(`Version illisible (pas au format v1.1) : ${issues.slice(0, 3).map((i) => i.message).join(" ; ")}`);
      setF(protocol);
      setVersion(data[0].version);
      setPublishedVersion((data as { version: number; published_at: string | null }[]).find((v) => v.published_at)?.version ?? null);
    })();
  }, [supabase, id, fresh]);

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

  // ─── Quote check: every evidence of the fiche, live (debounced) when an evidence, offset or PDF changes ─────
  const evidence = useMemo(() => {
    if (!f) return [];
    return evidenceLines(f).flatMap((l) => l.evidence.map((e, i) => ({ key: quoteKey(l.id, i), ...e })));
  }, [f]);
  const sig = useMemo(() => JSON.stringify([evidence, f?.sources.map((s) => [s.id, s.page_offset]), pdfs]), [evidence, f?.sources, pdfs]);
  const checkQuotes = useCallback(async () => {
    if (!f || !evidence.length) return;
    setChecking(true);
    setCheckError(null);
    try {
      const r = await api<{ results: { key: string; found: boolean; message: string | null }[] }>("/checks/quotes", {
        method: "POST", body: JSON.stringify({ sources: f.sources.map((s) => ({ id: s.id, page_offset: s.page_offset })), evidence }),
      });
      setQuotes({ sig, results: Object.fromEntries(r.results.map((x) => [x.key, { found: x.found, message: x.message }])) });
    } catch (e) {
      setCheckError((e as Error).message);
    } finally {
      setChecking(false);
    }
  }, [f, evidence, sig]);
  useEffect(() => {
    if (!isAdmin || !evidence.length || quotes.sig === sig) return;
    const t = setTimeout(() => void checkQuotes(), 1500);
    return () => clearTimeout(t);
  }, [isAdmin, evidence.length, sig, quotes.sig, checkQuotes]);
  const quoteResults = quotes.sig === sig ? quotes.results : NOT_CHECKED; // stale results count as not checked

  // ─── Both validator levels, live ───────────────────────────────────────────────────────────────────────
  const candidate = useMemo(() => (f ? { ...f, meta: { ...f.meta, status: "published" as const } } : null), [f]);
  const structure = useMemo(() => (candidate ? validateStructure(candidate).issues : []), [candidate]);
  const gate = useMemo(() => (candidate && !structure.length ? publicationGate(candidate, { published, quotes: quoteResults }) : []), [candidate, structure, published, quoteResults]);
  const issuesById = useMemo(() => {
    const m = new Map<string | null, Issue[]>();
    for (const i of [...structure, ...gate]) m.set(i.item_id, [...(m.get(i.item_id) ?? []), i]);
    return m;
  }, [structure, gate]);
  const canPublish = isAdmin && !!f && !structure.length && !gate.length;

  const env: EditorEnv = useMemo(() => ({ sources: f?.sources ?? [], quotes: quoteResults, newId: f ? makeNewId(f) : (p) => p }), [f, quoteResults]);

  const saveVersion = async (content: Protocol, publish: boolean) => {
    if (!session) return;
    const sid = content.meta.id;
    const next = version + 1;
    if (fresh || version === 0) {
      const s = await supabase.from("subjects").insert({ id: sid, title: content.meta.title, template: content.meta.template, specialite: content.meta.specialite || "" });
      if (s.error) throw new Error(s.error.code === "23505" ? `Une fiche « ${sid} » existe déjà : ouvrez-la pour la modifier.` : s.error.message);
    } else {
      await supabase.from("subjects").update({ title: content.meta.title, template: content.meta.template, specialite: content.meta.specialite, updated_at: new Date().toISOString() }).eq("id", sid);
    }
    const now = new Date().toISOString();
    const v = await supabase.from("fiche_versions").insert({
      subject_id: sid, version: next, content, created_by: session.user.id, ...(publish ? { published_at: now, published_by: session.user.id } : {}),
    });
    if (v.error) throw new Error(v.error.message);
    setF(content);
    setVersion(next);
    if (publish) setPublishedVersion(next);
    setDirty(false);
    if (fresh) router.replace(`/fiche/${sid}`);
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
        setNote(`Enregistré : version ${version + 1} (brouillon).`);
      } else {
        if (!canPublish || !candidate) throw new Error("La publication est bloquée : voir les contrôles.");
        await saveVersion(candidate, true);
        setNote(`Publié : version ${version + 1}.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const setPdf = async (sourceId: string, path: string | null) => {
    const q = path
      ? supabase.from("source_pdfs").upsert({ source_id: sourceId, pdf_path: path, updated_at: new Date().toISOString(), updated_by: session?.user.id })
      : supabase.from("source_pdfs").delete().eq("source_id", sourceId);
    const { error } = await q;
    if (error) return setError(error.message);
    setPdfs((p) => {
      const next = { ...p };
      if (path) next[sourceId] = path;
      else delete next[sourceId];
      return next;
    });
  };

  const loadPasted = () => {
    let raw: unknown;
    try {
      raw = JSON.parse(paste ?? "");
    } catch (e) {
      return setError(`JSON illisible : ${(e as Error).message}`);
    }
    const { protocol, issues } = validateStructure(raw);
    if (!protocol) return setError(`Ce JSON n'est pas une fiche v1.1 : ${issues.slice(0, 5).map((i) => i.message).join(" ; ")}`);
    if (!fresh && protocol.meta.id !== id) return setError(`Ce JSON est la fiche « ${protocol.meta.id} », pas « ${id} ».`);
    setF(protocol);
    setPaste(null);
    setError(null);
    setDirty(true);
  };

  const pasteBox = (
    <div className="flex flex-col gap-2 rounded-xl border border-accent bg-surface p-3">
      <p className="text-sm text-soft">Collez le JSON complet d&apos;une fiche au format v1.1. Il remplace ce qui est affiché ; rien n&apos;est enregistré avant « Enregistrer ».</p>
      <textarea autoFocus rows={14} spellCheck={false} className={`${inputCls} h-auto py-2 font-mono text-xs`} placeholder='{ "schema_version": "1.1.0", "meta": { … } }'
        value={paste ?? ""} onChange={(e) => setPaste(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={!(paste ?? "").trim()} onClick={loadPasted}>Afficher</Button>
        <Button onClick={() => setPaste(null)}>Annuler</Button>
      </div>
    </div>
  );

  if (!f && fresh) {
    const ok = /^[a-z0-9-]+$/.test(draft.id) && draft.title.trim();
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-5 py-6">
        <Link href="/protocoles" className="self-start text-sm text-accentink hover:underline">‹ Protocoles</Link>
        <h1 className="text-lg font-semibold tracking-tight">Nouvelle fiche</h1>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex flex-wrap items-end gap-2">
          <Text label="Identifiant (minuscules, chiffres, tirets)" mono className="w-64" value={draft.id} onChange={(v) => setDraft({ ...draft, id: v.trim() })} />
          <Text label="Titre" className="min-w-64 flex-1" value={draft.title} onChange={(title) => setDraft({ ...draft, title })} />
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Modèle</span>
            <select className={inputCls} value={draft.template} onChange={(e) => setDraft({ ...draft, template: e.target.value as Template })}>
              {Object.entries(TEMPLATE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <Button variant="primary" disabled={!ok} onClick={() => { setF(emptyProtocol(draft.id, draft.title.trim(), draft.template)); setDirty(true); }}>Créer</Button>
        </div>
        <p className="text-sm text-muted">Ou collez une fiche complète :</p>
        {paste === null ? <Button className="self-start" onClick={() => setPaste("")}>Coller un JSON</Button> : pasteBox}
      </div>
    );
  }
  if (!f) return <div className="p-6">{error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}</div>;

  const where = lineSections(f);
  const sectionIssues = (sec: string) => [...structure, ...gate].filter((i) => (i.item_id ? where.get(i.item_id) === sec : sec === "review")).length;
  const n = (...lists: unknown[][]) => lists.reduce((s, l) => s + l.length, 0);
  const isLive = publishedVersion === version && !dirty;

  return (
    <EnvCtx.Provider value={env}>
    <IssuesCtx.Provider value={issuesById}>
    <ShowCtx.Provider value={setShown}>
    <div className="grid h-[calc(100dvh-3rem)] grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-h-0 overflow-auto px-5 pb-16">
        <div className="flex flex-col gap-5">
          <div className="sticky top-0 z-10 -mx-5 flex flex-wrap items-center gap-3 border-b border-line bg-bg/95 px-5 py-3 backdrop-blur">
            <Link href="/protocoles" className="text-sm text-accentink hover:underline">‹ Protocoles</Link>
            <h1 className="min-w-0 flex-1 basis-48 truncate text-lg font-semibold tracking-tight">{f.meta.title || "[à compléter]"}</h1>
            {version > 0 && <Tag>v{version}</Tag>}
            <Tag tone={isLive ? "accent" : "neutral"}>{isLive ? "publiée" : publishedVersion ? `brouillon (v${publishedVersion} publiée)` : "brouillon"}</Tag>
            {note && <span className="text-xs text-accent">{note}</span>}
            {dirty && <span className="text-xs text-caution">Modifications non enregistrées</span>}
            <Button className="h-8 px-2.5 text-xs" onClick={() => setPaste(paste === null ? "" : null)}>Coller un JSON</Button>
            <Button className="h-8" disabled={!!busy || !dirty || !isAdmin} onClick={() => run("save")}>{busy === "save" ? <Spinner /> : "Enregistrer"}</Button>
            <Button className="h-8" variant="primary" disabled={!!busy || !canPublish || isLive}
              title={canPublish ? "Publier cette version" : "Bloqué tant que les contrôles ne passent pas"} onClick={() => run("publish")}>
              {busy === "publish" ? <Spinner /> : "Publier"}
            </Button>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          {paste !== null && pasteBox}

          <Section id="meta" title="Identité" issues={0}>
            <MetaEditor meta={f.meta} scope={f.scope} onMeta={(meta) => edit((d) => void (d.meta = { ...meta, id: d.meta.id }))} onScope={(scope) => edit((d) => void (d.scope = scope))} />
          </Section>

          <Section id="red_box" title={SECTION_TITLE.red_box} count={n(f.red_box.signs, f.red_box.actions)} issues={sectionIssues("red_box")}>
            <Block title="Quand appeler le SAMU / adresser aux urgences"><Items items={f.red_box.signs} prefix="it" add="un signe" onChange={(v) => edit((d) => void (d.red_box.signs = v))} /></Block>
            <Block title="En attendant"><Items items={f.red_box.actions} prefix="it" add="une action" onChange={(v) => edit((d) => void (d.red_box.actions = v))} /></Block>
          </Section>

          <Section id="assess" title={SECTION_TITLE.assess} count={n(f.assess.ask, f.assess.examine, f.assess.tests)} issues={sectionIssues("assess")}>
            <Block title="Demander"><Items items={f.assess.ask} prefix="it" add="une question" onChange={(v) => edit((d) => void (d.assess.ask = v))} /></Block>
            <Block title="Examiner"><Items items={f.assess.examine} prefix="it" add="un signe à examiner" onChange={(v) => edit((d) => void (d.assess.examine = v))} /></Block>
            <Block title="Examens complémentaires"><Items items={f.assess.tests} prefix="it" add="un examen" onChange={(v) => edit((d) => void (d.assess.tests = v))} /></Block>
            <Block title="Arbre de décision" hint="Une liste de nœuds et leurs branches. Les impasses et les nœuds inatteignables sont signalés.">
              <PathwayEditor pathway={f.assess.pathway} onChange={(p) => edit((d) => void (d.assess.pathway = p))} />
            </Block>
          </Section>

          <Section id="treat" title={SECTION_TITLE.treat} count={n(f.treat.medications, f.treat.actions, f.treat.do_not)} issues={sectionIssues("treat")}>
            <Block title="Médicaments" hint="Marques, prescripteur et statut viennent de la nomenclature nationale, jamais saisis à la main.">
              <Medications items={f.treat.medications} onChange={(v) => edit((d) => void (d.treat.medications = v))} />
            </Block>
            <Block title="Autres mesures"><Items items={f.treat.actions} prefix="it" add="une mesure" onChange={(v) => edit((d) => void (d.treat.actions = v))} /></Block>
            <Block title="À ne pas faire"><Items items={f.treat.do_not} prefix="it" add="une interdiction" onChange={(v) => edit((d) => void (d.treat.do_not = v))} /></Block>
          </Section>

          <Section id="advise" title={SECTION_TITLE.advise} count={f.advise.length} issues={sectionIssues("advise")}>
            <Items items={f.advise} prefix="it" add="un conseil" onChange={(v) => edit((d) => void (d.advise = v))} />
          </Section>

          <Section id="refer_follow" title={SECTION_TITLE.refer_follow} count={n(f.refer_follow.refer, f.refer_follow.follow_up)} issues={sectionIssues("refer_follow")}>
            <Block title="Orienter"><Referrals items={f.refer_follow.refer} onChange={(v) => edit((d) => void (d.refer_follow.refer = v))} /></Block>
            <Block title="Suivre (quand / quoi)"><FollowUps items={f.refer_follow.follow_up} onChange={(v) => edit((d) => void (d.refer_follow.follow_up = v))} /></Block>
          </Section>

          <Section id="sources" title={SECTION_TITLE.sources} count={f.sources.length} issues={sectionIssues("sources")}>
            <SourcesEditor sources={f.sources} topic={f.meta.id} pdfs={pdfs} onPdf={setPdf} onChange={(v) => edit((d) => void (d.sources = v))} />
          </Section>

          <Section id="review" title={SECTION_TITLE.review} issues={sectionIssues("review")}>
            <ReviewEditor review={f.review} me={me} onChange={(r) => edit((d) => void (d.review = r))} />
          </Section>
        </div>
      </div>
      <div className="hidden min-h-0 border-l border-line bg-surface lg:flex">
        <SidePanel structure={structure} gate={gate} quotes={quoteResults} quoteTotal={evidence.length} checking={checking} checkError={checkError}
          onCheck={() => void checkQuotes()} shown={shown} onCloseShown={() => setShown(null)} sources={f.sources} pdfs={pdfs} />
      </div>
    </div>
    </ShowCtx.Provider>
    </IssuesCtx.Provider>
    </EnvCtx.Provider>
  );
}
