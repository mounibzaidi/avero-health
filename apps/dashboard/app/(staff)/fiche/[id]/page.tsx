"use client";

import { Fiche, LOCATIONS, SECTION_KEYS, validateFiche, type Element, type ElementPath, type ResolvedRef, type SectionKey, type SectionState, type Sections, type SourceMeta } from "@medguides/schema";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { EditorCtx, Elements } from "@/components/editor/ElementFields";
import { Block, FindingsCtx, Label, List, ListText, ShowCtx, Text, type Note, type Shown } from "@/components/editor/fields";
import { Posologies } from "@/components/editor/PosologieFields";
import { Button, ErrorNote, inputCls, Spinner, Tag } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

// A fiche of the numbered schema, edited by hand beside its source (D2): the v4 editor layout with the
// numbered fields. Every line is read first as the app says it, with its page and the source's words;
// touching it shows its source on the right, "Modifier" opens its fields. Saving makes a new version.

const STATES = [["filled", "rempli"], ["non_traité", "non traité par la source"], ["sans_objet", "sans objet"]] as const;
const TITLE: Record<SectionKey, string> = {
  "1_essentiel": "L'essentiel", "2_presentation": "Présentation clinique", "3_champ": "Champ d'application", "4_gravite": "Gravité et gestes immédiats",
  "5_conduite": "Conduite à tenir", "6_examens": "Examens", "7_traitement": "Traitement", "8_ne_pas_faire": "À ne pas faire", "9_orientation": "Orientation",
  "10_surveillance": "Surveillance", "11_suivi": "Suivi", "12_ordonnance": "Ordonnance type", "13_definitions": "Définitions",
};
const SUB: Partial<Record<ElementPath, string>> = {
  "2_presentation.signes_typiques": "Signes typiques", "2_presentation.formes_trompeuses": "Formes trompeuses", "2_presentation.examen_clinique": "Examen clinique",
  "2_presentation.criteres_diagnostiques": "Critères diagnostiques", "2_presentation.diagnostics_differentiels": "Penser aussi à",
  "4_gravite.decision_initiale": "Décision initiale", "4_gravite.signes_de_gravite": "Signes de gravité", "4_gravite.gestes_immediats": "Gestes immédiats",
  "7_traitement.elements": "Indications et lignes", "7_traitement.contre_indications": "Contre-indications",
  "11_suivi.elements": "Suivi", "11_suivi.conseils_patient": "À dire au patient (« Revenir immédiatement si » : avec une condition)",
};
const HIGH = new Set<ElementPath>(["7_traitement.contre_indications", "8_ne_pas_faire"]);

/** The list of elements at a path, written back into a draft. */
function setPath(S: Sections, path: ElementPath, els: Element[]) {
  const [sec, sub] = path.split(".") as [SectionKey, string | undefined];
  const section = S[sec] as unknown as Record<string, unknown>;
  const target = sub ? section[sub] : section;
  if (Array.isArray(target)) section[sub!] = els;
  else if (target && typeof target === "object") (target as { elements: Element[] }).elements = els;
  else if (sub) section[sub] = { state: els.length ? "filled" : "non_traité", elements: els };
}

const StateSelect = ({ value, onChange }: { value: SectionState; onChange: (v: SectionState) => void }) => (
  <select className={`${inputCls} h-7 text-xs`} value={value} onChange={(e) => onChange(e.target.value as SectionState)} title="État de la section">
    {STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);

/** A numbered section: its title and line count, its state, and its lines. */
function Section({ title, count, state, onState, notes, folded, children }: {
  title: string; count: number; state?: SectionState; onState?: (v: SectionState) => void; notes?: Note[]; folded?: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(!folded);
  return (
    <section className="border-t border-line pt-4 first:border-0">
      <div className="mb-2 flex items-center gap-2">
        <button type="button" className="flex min-w-0 flex-1 items-baseline gap-2 text-left" onClick={() => setOpen(!open)}>
          <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
          {count > 0 && <span className="text-xs text-muted">{count} ligne{count > 1 ? "s" : ""}</span>}
          <span className="text-xs text-muted">{open ? "▾" : "▸"}</span>
        </button>
        {state && onState && <StateSelect value={state} onChange={onState} />}
      </div>
      {notes?.map((n, i) => <p key={i} className={`mb-1 text-xs font-medium ${n.failure ? "text-flag" : "text-caution"}`}>{n.failure ? "✕" : "⚠"} {n.message}</p>)}
      {open && <div className="flex flex-col gap-4">{children}</div>}
    </section>
  );
}

const PdfViewer = dynamic(() => import("@/components/PdfViewer"), { ssr: false, loading: () => <p className="p-4 text-sm text-muted">Chargement…</p> });

/** Right pane: the source of the line in hand, and its PDF (from Collecte) at the cited page with the quote marked. */
function SourcePane({ shown, sources }: { shown: Shown | null; sources: SourceMeta[] }) {
  const ref = shown?.source ?? null;
  const src = sources.find((s) => s.source_id === ref?.source_id) ?? null;
  const link = src?.url ? (ref && /\.pdf($|[?#])/i.test(src.url) ? `${src.url.split("#")[0]}#page=${ref.page}` : src.url) : null;
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [page, setPage] = useState<{ key: string; n: number } | null>(null);
  const [missed, setMissed] = useState<string | null>(null);
  const pdfPath = src?.pdf_path ?? null;
  useEffect(() => {
    if (!pdfPath || urls[pdfPath]) return;
    api<{ url: string }>(`/crawl/file?path=${encodeURIComponent(pdfPath)}`).then((r) => setUrls((u) => ({ ...u, [pdfPath]: r.url })), () => {});
  }, [pdfPath, urls]);
  const key = ref ? `${ref.source_id}|${ref.page}|${ref.quote}` : "";
  const cited = ref ? Math.max(1, ref.page - (src?.page_offset ?? 0)) : 1; // printed page -> PDF page
  const shownPage = page && page.key === key ? page.n : cited;
  return (
    <div className="flex min-h-0 w-full flex-col">
      <div className="flex max-h-[45%] flex-col gap-3 overflow-auto border-b border-line p-5">
        <h3 className="text-sm font-semibold text-soft">Source</h3>
        {!shown ? (
          <p className="text-sm text-muted">Touchez une ligne pour voir ici sa page et la citation de la source.</p>
        ) : (
          <>
            <p className="text-sm text-ink">{shown.label}</p>
            {ref ? (
              <>
                <div className="text-xs font-semibold text-accentink">Page {ref.page}{ref.page_end ? `-${ref.page_end}` : ""}{src?.page_offset ? ` (page ${cited} du PDF)` : ""}</div>
                <blockquote className="border-s-2 border-accent ps-3 text-[15px] leading-6 text-ink">« {ref.quote || "citation vide"} »</blockquote>
                {src ? <div className="text-sm text-soft"><span className="font-medium text-ink">{src.citation}</span> · {src.title}</div> : <p className="text-sm text-flag">Source « {ref.source_id} » absente des sources de la fiche.</p>}
                {link ? <a href={link} target="_blank" rel="noreferrer" className="self-start text-sm font-semibold text-accentink hover:underline">Ouvrir la source originale</a> : null}
              </>
            ) : (
              <p className="text-sm text-caution">Sans citation : adaptation locale signée par un relecteur.</p>
            )}
          </>
        )}
      </div>
      {missed === key && ref?.quote ? <div className="border-b border-flag/30 bg-flagbg px-3 py-2 text-sm text-flag">Citation introuvable sur cette page : vérifiez la page ou le texte.</div> : null}
      <div className="min-h-0 flex-1">
        {ref && pdfPath && urls[pdfPath] ? (
          <PdfViewer url={urls[pdfPath]} page={shownPage} quote={shownPage === cited ? ref.quote : ""}
            onPageChange={(n) => setPage({ key, n })} onHighlight={(_t, found) => setMissed(found ? null : key)} />
        ) : (
          <p className="p-5 text-sm text-muted">{ref && !pdfPath ? "Pas de PDF pour cette source : choisissez-le dans « Identité et sources » (les PDF viennent de Collecte)." : ref ? "Chargement du PDF…" : ""}</p>
        )}
      </div>
    </div>
  );
}

export default function FicheEditor() {
  const { id } = useParams<{ id: string }>();
  const fresh = id === "nouveau";
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { session, staff } = useAuth();
  const [f, setF] = useState<Fiche | null>(null);
  const [version, setVersion] = useState(0); // the latest saved version; 0 for a new fiche
  const [wasPublished, setWasPublished] = useState(false);
  const [newId, setNewId] = useState("");
  const [known, setKnown] = useState<Map<string, ResolvedRef>>(new Map());
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paste, setPaste] = useState<string | null>(fresh ? "" : null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [quoteNotes, setQuoteNotes] = useState<Map<string, Note[]>>(new Map());
  const [checking, setChecking] = useState(false);
  const [topicFiles, setTopicFiles] = useState<{ path: string | null; title: string }[]>([]);

  useEffect(() => {
    void (async () => {
      const [subjects, published] = await Promise.all([supabase.from("subjects").select("id"), supabase.from("published_fiches").select("subject_id")]);
      const pub = new Set((published.data ?? []).map((r: { subject_id: string }) => r.subject_id));
      setKnown(new Map((subjects.data ?? []).map((r: { id: string }) => [r.id, pub.has(r.id) ? "published" : "unpublished"])));
      if (fresh) return;
      const { data, error } = await supabase.from("fiche_versions").select("version,content,published_at").eq("subject_id", id).order("version", { ascending: false }).limit(1).maybeSingle();
      if (error || !data) return setError(error?.message ?? "Fiche introuvable");
      const parsed = Fiche.safeParse(data.content);
      if (!parsed.success) return setError(`Version illisible : ${parsed.error.issues[0]?.message}`);
      setF(parsed.data);
      setVersion(data.version);
      setWasPublished(!!data.published_at || parsed.data.meta.status === "published");
    })();
  }, [supabase, id, fresh]);

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const edit = useCallback((fn: (d: Fiche) => void) => {
    setF((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
    setSaved(null);
  }, []);

  // Live validation of the draft: by element (under each line), by section, and in total.
  const validation = useMemo(() => (f ? validateFiche(f, { resolve: (x) => known.get(x) }) : null), [f, known]);
  const notes = useMemo(() => {
    const byId = new Map<string, Note[]>();
    const add = (key: string, n: Note) => byId.set(key, [...(byId.get(key) ?? []), n]);
    for (const x of validation?.failures ?? []) add(x.element ?? x.path ?? "", { failure: true, message: x.message });
    for (const x of validation?.warnings ?? []) add(x.element ?? x.path ?? "", { failure: false, message: x.message });
    for (const [k, list] of quoteNotes) for (const n of list) add(k, n);
    return byId;
  }, [validation, quoteNotes]);

  // The topic's PDFs (Collecte), to say which one each source is. A fiche's id is its topic's id (subjects.id).
  const topicId = f ? (fresh ? newId.trim() : id) : null;
  useEffect(() => {
    if (!topicId) return;
    api<{ files: { path: string | null; title: string }[] }>(`/crawl/topics/${topicId}`).then((t) => setTopicFiles(t.files.filter((x) => x.path)), () => setTopicFiles([]));
  }, [topicId]);

  /** The server checks every quote on its page of the source PDF, and every number of the line in its quote. */
  const checkQuotes = async () => {
    if (!f) return;
    setChecking(true);
    setError(null);
    try {
      const r = await api<{ checked: number; ok: number; results: { id: string; ok: boolean; message: string | null }[] }>("/checks/quotes", { method: "POST", body: JSON.stringify({ fiche: f }) });
      setQuoteNotes(new Map(r.results.filter((x) => !x.ok).map((x) => [x.id, [{ failure: true, message: x.message ?? "Citation non vérifiée" }]])));
      setSaved(`Citations : ${r.ok}/${r.checked} vérifiées sur leur page du PDF.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const loadPasted = () => {
    let raw: unknown;
    try {
      raw = JSON.parse(paste ?? "");
    } catch (e) {
      return setError(`JSON illisible : ${(e as Error).message}`);
    }
    const parsed = Fiche.safeParse(raw);
    if (!parsed.success) {
      const v = validateFiche(raw);
      return setError(`Ce JSON n'est pas une fiche du schéma numéroté : ${v.failures.slice(0, 5).map((x) => `${x.path ?? ""} ${x.message}`).join(" ; ")}`);
    }
    setF(parsed.data);
    if (fresh && !newId) setNewId(parsed.data.meta.topic_id);
    setPaste(null);
    setError(null);
    setDirty(true);
    setSaved(null);
  };

  const save = async () => {
    if (!f || !session) return;
    const sid = fresh ? newId.trim() : id;
    if (!/^[a-z0-9-]+$/.test(sid)) return setError("Identifiant de la fiche : lettres minuscules, chiffres et tirets (ex. hta-adulte).");
    const next = (fresh ? 0 : version) + 1;
    // A saved change is a new version to sign again: a published fiche goes back to review.
    const content: Fiche = { ...f, meta: { ...f.meta, version: String(next), ...(wasPublished ? { status: "review" as const, reviewer: null, reviewed_at: null } : {}) } };
    // Brands come from the national nomenclature (strict match), never typed: recomputed on every save.
    let brandsNote = "";
    try {
      Object.assign(content, await api<Fiche>("/checks/brands", { method: "POST", body: JSON.stringify({ fiche: content, topic_id: sid }) }));
    } catch {
      brandsNote = " (marques non recalculées : service injoignable)";
    }
    const parsed = Fiche.safeParse(content);
    if (!parsed.success) return setError(`Format : ${parsed.error.issues.slice(0, 5).map((x) => `${x.path.join(".")} ${x.message}`).join(" ; ")}`);
    setSaving(true);
    setError(null);
    try {
      if (fresh) {
        const s = await supabase.from("subjects").insert({ id: sid, title: f.meta.title, template: f.meta.template, specialite: f.meta.specialite });
        if (s.error) throw new Error(s.error.code === "23505" ? `Une fiche « ${sid} » existe déjà : ouvrez-la pour la modifier.` : s.error.message);
      } else {
        await supabase.from("subjects").update({ title: f.meta.title, template: f.meta.template, specialite: f.meta.specialite, updated_at: new Date().toISOString() }).eq("id", sid);
      }
      const v = await supabase.from("fiche_versions").insert({ subject_id: sid, version: next, content: parsed.data, created_by: session.user.id });
      if (v.error) throw new Error(v.error.message);
      setF(parsed.data);
      setVersion(next);
      setWasPublished(false);
      setDirty(false);
      setSaved(`Enregistré : version ${next}${wasPublished ? ", à faire relire avant publication" : ""}${brandsNote}.`);
      if (fresh) router.replace(`/fiche/${sid}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const pasteBox = (
    <div className="flex flex-col gap-2 rounded-xl border border-accent bg-surface p-3">
      <p className="text-sm text-soft">
        Collez le JSON complet d&apos;une fiche (schéma numéroté, comme le format fiche-protocole). Il remplace ce qui est affiché. Rien n&apos;est enregistré tant que vous n&apos;appuyez pas sur Enregistrer.
      </p>
      <textarea autoFocus rows={fresh && !f ? 22 : 10} spellCheck={false} className={`${inputCls} h-auto py-2 font-mono text-xs`} placeholder='{ "kind": "fiche", "meta": { … }, "sections": { … } }'
        value={paste ?? ""} onChange={(e) => setPaste(e.target.value)} />
      <div className="flex items-center gap-2">
        <Button variant="primary" disabled={!(paste ?? "").trim()} onClick={loadPasted}>Afficher</Button>
        {f && <Button onClick={() => setPaste(null)}>Annuler</Button>}
      </div>
    </div>
  );

  if (!f && fresh) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-5 py-6">
        <Link href="/protocoles" className="self-start text-sm text-accentink hover:underline">‹ Protocoles</Link>
        <h1 className="text-lg font-semibold tracking-tight">Nouvelle fiche</h1>
        {error && <ErrorNote>{error}</ErrorNote>}
        {pasteBox}
      </div>
    );
  }
  if (!f) return <div className="p-6">{error ? <ErrorNote>{error}</ErrorNote> : <Spinner />}</div>;

  const S = f.sections;
  const m = f.meta;
  const count = (key: SectionKey) => LOCATIONS.filter((l) => l.section === key).reduce((n, l) => n + l.get(S).length, 0) + (key === "7_traitement" ? S["7_traitement"].posologies.length : 0);
  const list = (path: ElementPath, add?: string) => (
    <Elements section={path.split(".")[0]} items={LOCATIONS.find((l) => l.path === path)!.get(S)} risk={HIGH.has(path) ? "high" : undefined}
      tone={path === "4_gravite.signes_de_gravite" || path === "8_ne_pas_faire" ? "text-flag" : undefined} add={add}
      onChange={(els) => edit((d) => setPath(d.sections, path, els))} />
  );
  const sub = (path: ElementPath, block?: { state: SectionState }) => (
    <Block key={path} title={SUB[path] ?? path} aside={block ? <StateSelect value={block.state} onChange={(v) => edit((d) => void ((d.sections as unknown as Record<string, Record<string, { state: SectionState }>>)[path.split(".")[0]][path.split(".")[1]].state = v))} /> : undefined}>
      {list(path)}
    </Block>
  );
  const sectionNotes = (key: SectionKey) => [...notes].filter(([k]) => k === key || k.startsWith(`${key}.`)).flatMap(([, n]) => n);

  const body: Record<SectionKey, ReactNode> = {
    "1_essentiel": list("1_essentiel"),
    "2_presentation": (["2_presentation.signes_typiques", "2_presentation.formes_trompeuses", "2_presentation.criteres_diagnostiques", "2_presentation.diagnostics_differentiels", "2_presentation.examen_clinique"] as const).map((p) => sub(p)),
    "3_champ": list("3_champ"),
    "4_gravite": (
      <>
        {m.template === "urgence" && (S["4_gravite"].decision_initiale ? sub("4_gravite.decision_initiale", S["4_gravite"].decision_initiale) : (
          <Button className="self-start" onClick={() => edit((d) => void (d.sections["4_gravite"].decision_initiale = { state: "non_traité", elements: [] }))}>+ Décision initiale</Button>
        ))}
        {sub("4_gravite.signes_de_gravite")}
        {sub("4_gravite.gestes_immediats", S["4_gravite"].gestes_immediats)}
      </>
    ),
    "5_conduite": (
      <List items={S["5_conduite"].nodes} add="une étape de décision" blank={() => ({ node: "", branches: [] })}
        onChange={(nodes) => edit((d) => void (d.sections["5_conduite"].nodes = nodes))}
        render={(n, set) => (
          <div className="my-1 flex flex-col gap-1 rounded-lg bg-panel/60 p-2">
            <Text label="Étape (titre du nœud)" value={n.node} onChange={(node) => set({ ...n, node })} />
            <div className="pl-3"><Elements section="5_conduite" items={n.branches} add="une branche" onChange={(branches) => set({ ...n, branches })} /></div>
          </div>
        )} />
    ),
    "6_examens": list("6_examens", "un examen"),
    "7_traitement": (
      <>
        {sub("7_traitement.elements")}
        <Block title="Posologies" hint="Une carte par dose. Les marques algériennes sont calculées depuis la nomenclature, jamais saisies.">
          <Posologies items={S["7_traitement"].posologies} onChange={(v) => edit((d) => void (d.sections["7_traitement"].posologies = v))} />
        </Block>
        {sub("7_traitement.contre_indications", S["7_traitement"].contre_indications)}
      </>
    ),
    "8_ne_pas_faire": list("8_ne_pas_faire"),
    "9_orientation": list("9_orientation", "une orientation"),
    "10_surveillance": list("10_surveillance"),
    "11_suivi": <>{sub("11_suivi.elements")}{sub("11_suivi.conseils_patient")}</>,
    "12_ordonnance": list("12_ordonnance"),
    "13_definitions": list("13_definitions", "une définition"),
  };

  const setSource = (i: number, patch: Partial<SourceMeta>) => edit((d) => void (d.meta.sources[i] = { ...d.meta.sources[i], ...patch }));

  return (
    <EditorCtx.Provider value={{ sources: m.sources, posologies: S["7_traitement"].posologies, me: staff?.name || session?.user.email || "" }}>
    <FindingsCtx.Provider value={notes}>
    <ShowCtx.Provider value={setShown}>
    <div className="grid h-[calc(100dvh-3rem)] grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-h-0 overflow-auto px-5 pb-10">
        <div className="flex flex-col gap-5">
          <div className="sticky top-0 z-10 -mx-5 flex flex-wrap items-center gap-3 border-b border-line bg-bg/95 px-5 py-3 backdrop-blur">
            <Link href="/protocoles" className="text-sm text-accentink hover:underline">‹ Protocoles</Link>
            <h1 className="min-w-0 flex-1 basis-48 truncate text-lg font-semibold tracking-tight">{m.title || "Sans titre"}</h1>
            {!fresh && <Tag>v{version}</Tag>}
            <Tag tone={wasPublished ? "accent" : "neutral"}>{fresh ? "nouvelle" : wasPublished ? "publiée" : m.status === "review" ? "en relecture" : "brouillon"}</Tag>
            {validation && <Tag tone={validation.failures.length ? "urgent" : "accent"}>{validation.failures.length ? `${validation.failures.length} bloquant(s)` : "publiable"}</Tag>}
            {saved && <span className="text-xs text-accent">{saved}</span>}
            {dirty && <span className="text-xs text-caution">Modifications non enregistrées</span>}
            <Button className="h-8 px-2.5 text-xs" onClick={() => setPaste(paste === null ? "" : null)}>Coller un JSON</Button>
            <Button className="h-8 px-2.5 text-xs" disabled={checking} title="Cherche chaque citation sur sa page du PDF de la source, et chaque nombre de la ligne dans sa citation" onClick={checkQuotes}>
              {checking ? <Spinner /> : "Vérifier les citations"}
            </Button>
            <Button className="h-8" variant="primary" disabled={saving || !dirty} onClick={save}>{saving ? <Spinner /> : "Enregistrer"}</Button>
          </div>
          {error && <ErrorNote>{error}</ErrorNote>}
          {wasPublished && <p className="text-sm text-soft">Cette fiche est publiée. L&apos;enregistrer crée une nouvelle version à relire : l&apos;application garde la version publiée jusqu&apos;à la nouvelle publication.</p>}
          {paste !== null && pasteBox}
          {fresh && (
            <div className="flex items-end gap-2 rounded-lg border border-caution/30 bg-cautionbg px-3 py-2">
              <Text label="Identifiant de la fiche (dans l'adresse de l'application)" className="w-72" value={newId} onChange={setNewId} placeholder="hta-adulte" />
              <p className="pb-2 text-sm text-caution">Pas encore enregistrée : Enregistrer crée la fiche en brouillon.</p>
            </div>
          )}

          <Section folded title="Identité et sources" count={0} notes={notes.get("meta.siblings")}>
            <div className="flex flex-wrap gap-2">
              <Text label="Titre" className="min-w-64 flex-1" value={m.title} onChange={(v) => edit((d) => void (d.meta.title = v))} />
              <label className="flex flex-col gap-1">
                <Label>Modèle</Label>
                <select className={inputCls} value={m.template} onChange={(e) => edit((d) => void (d.meta.template = e.target.value as "urgence" | "pathologie"))}>
                  <option value="urgence">urgence</option>
                  <option value="pathologie">pathologie</option>
                </select>
              </label>
              <Text label="Spécialité" className="w-56" value={m.specialite} onChange={(v) => edit((d) => void (d.meta.specialite = v))} />
              <Text label="Thème (topic)" className="w-40" value={m.topic_id} onChange={(v) => edit((d) => void (d.meta.topic_id = v))} />
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <Label>Public</Label>
              {(["MG", "urgences"] as const).map((a) => (
                <label key={a} className="flex items-center gap-1.5 text-soft">
                  <input type="checkbox" checked={m.audience.includes(a)} onChange={(e) => edit((d) => void (d.meta.audience = e.target.checked ? [...d.meta.audience, a] : d.meta.audience.filter((x) => x !== a)))} />
                  {a}
                </label>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <ListText label="Motifs de consultation" value={m.motifs} onChange={(v) => edit((d) => void (d.meta.motifs = v))} />
              <ListText label="Synonymes (recherche)" value={m.synonymes} onChange={(v) => edit((d) => void (d.meta.synonymes = v))} />
              <ListText label="Fiches liées (ids)" value={m.siblings} onChange={(v) => edit((d) => void (d.meta.siblings = v))} />
              <ListText label="Exclu pour ce public" value={m.excluded_by_audience} onChange={(v) => edit((d) => void (d.meta.excluded_by_audience = v))} />
            </div>
            <Block title="Sources">
              <List items={m.sources} add="une source" onChange={(v) => edit((d) => void (d.meta.sources = v))}
                blank={(): SourceMeta => ({ source_id: "", type: "full_guideline", title: "", citation: "", licence: "" })}
                render={(s, _set, i) => (
                  <div className="my-1 grid grid-cols-1 gap-2 rounded-lg bg-panel/60 p-2 md:grid-cols-2">
                    <Text label="Identifiant (cité par les lignes)" mono value={s.source_id} onChange={(v) => setSource(i, { source_id: v })} />
                    <label className="flex flex-col gap-1">
                      <Label>Type</Label>
                      <select className={inputCls} value={s.type} onChange={(e) => setSource(i, { type: e.target.value as SourceMeta["type"] })}>
                        {[["full_guideline", "recommandation complète"], ["synthesis", "synthèse"], ["update_only", "mise à jour"], ["product_info", "RCP / notice"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </label>
                    <Text label="Titre du document" value={s.title} onChange={(v) => setSource(i, { title: v })} />
                    <Text label="Citation (qui l'a réellement écrit)" value={s.citation} onChange={(v) => setSource(i, { citation: v })} />
                    <Text label="Licence" value={s.licence} onChange={(v) => setSource(i, { licence: v })} />
                    <Text label="Lien (Source originale)" value={s.url} onChange={(v) => setSource(i, { url: v || null })} />
                    <Text label="Langue" value={s.language} onChange={(v) => setSource(i, { language: v || undefined })} />
                    <Text label="Décalage de page (imprimée moins PDF)" value={s.page_offset?.toString()} onChange={(v) => setSource(i, { page_offset: v ? Number(v) : undefined })} />
                    <label className="flex flex-col gap-1 md:col-span-2">
                      <Label>PDF de la source (fichiers du thème dans Collecte)</Label>
                      <select className={inputCls} value={s.pdf_path ?? ""} onChange={(e) => setSource(i, { pdf_path: e.target.value || null })}>
                        <option value="">{topicFiles.length ? "Aucun" : "Aucun PDF gardé pour ce thème dans Collecte"}</option>
                        {topicFiles.map((x) => <option key={x.path!} value={x.path!}>{(() => { try { return decodeURIComponent(x.title); } catch { return x.title; } })()}</option>)}
                      </select>
                    </label>
                    <Text label="Année de la version utilisée" value={s.year?.toString()} onChange={(v) => setSource(i, { year: v ? Number(v) : undefined })} />
                    <Text label="DOI (ou lien) de la version utilisée : suivi par la veille" value={s.doi} onChange={(v) => setSource(i, { doi: v || null })} />
                  </div>
                )} />
            </Block>
          </Section>

          {SECTION_KEYS.map((key, i) => (
            <Section key={key} title={`${i + 1}. ${TITLE[key]}`} count={count(key)} state={S[key].state} notes={sectionNotes(key)}
              onState={(v) => edit((d) => void (d.sections[key].state = v))}>
              {body[key]}
            </Section>
          ))}
        </div>
      </div>
      <div className="hidden min-h-0 border-l border-line bg-surface lg:flex">
        <SourcePane shown={shown} sources={m.sources} />
      </div>
    </div>
    </ShowCtx.Provider>
    </FindingsCtx.Provider>
    </EditorCtx.Provider>
  );
}
