"use client";

import { fromLegacy, type Medication } from "@medguides/schema";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BrandPicker } from "@/components/editor/BrandPicker";
import { Button, Card, ErrorNote, inputCls, PageHeader, Spinner, Tag } from "@/components/ui";
import { api, apiBlob } from "@/lib/api";
import { IMPORT_KEY } from "@/lib/fiche-import";
import { createClient } from "@/lib/supabase/client";

/** A line of a fiche-protocole fiche (element) and a dose, as generated. */
interface Line { id: string; text: string; type: string; condition: string | null; source: { source_id: string; page: number | null; quote: string }; grade: string | null; missing: string[] }
interface Dose {
  drug_dci: string; dose: string; dose_max: string | null; route: string; frequency_or_duration: string; condition: string | null;
  source: { page: number | null; quote: string }; missing: string[]; algerie: { brands: string[]; statut: string | null }; note: string | null;
}
type Fiche = { meta: Record<string, unknown> & { title: string; status: string; quote_check: string; excluded_by_audience: string[] }; sections: Record<string, Record<string, unknown>> };
interface LineMeta { element_id: string; section: string; quote_status: "pdf" | "parsed" | "failed" | null; from_figure: boolean; retries: number; model: string | null; dropped: boolean; dropped_line: Line | null; reason: string | null }
interface Draft {
  id: string; topic_id: string; content: Fiche | null; status: string; stage: string; stage_detail: string | null; error: string | null;
  licence_scope: "internal" | "publish"; page_offset: number | null; offset_detected: boolean; form: { title: string; licence_text?: string };
  lines: LineMeta[]; dropped: LineMeta[]; models: string[];
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
const RUNNING = new Set(["uploaded", "ingesting", "routing", "generating", "checking"]);
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

function at(obj: unknown, path: (string | number)[]): unknown[] {
  return path.reduce<unknown>((o, k) => (o as Record<string | number, unknown>)[k], obj) as unknown[];
}

function Badges({ meta, missing }: { meta?: LineMeta; missing: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {meta?.quote_status === "pdf" && <Tag tone="accent">PDF</Tag>}
      {meta?.quote_status === "parsed" && <Tag tone="caution">Parsé</Tag>}
      {meta?.from_figure && <span className="rounded-md bg-[#efe6fb] px-1.5 py-0.5 text-[11px] font-semibold text-[#6b3fa0]">Figure</span>}
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
  const [model, setModel] = useState("claude-haiku-5-5");
  const [batch, setBatch] = useState(false);
  const [reviewer, setReviewer] = useState("");
  const [shown, setShown] = useState<{ page: number | null; quote: string } | null>(null);
  const [image, setImage] = useState<string | null>(null);

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
    if (!d || !RUNNING.has(d.stage)) return;
    const t = setInterval(() => void load(), 3000);
    return () => clearInterval(t);
  }, [d, load]);
  useEffect(() => {
    if (!shown?.page) return;
    let url: string | null = null;
    apiBlob(`/fichegen/drafts/${id}/page/${shown.page}`).then((u) => { url = u; setImage(u); }, () => setImage(null));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [shown, id]);

  const metas = useMemo(() => new Map((d?.lines ?? []).map((l) => [l.element_id, l])), [d]);
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

  return (
    <div className="grid h-[calc(100dvh-3rem)] grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="min-h-0 overflow-auto px-5 pb-16">
        <div className="flex flex-col gap-4 py-4">
          <Link href="/generation" className="self-start text-sm text-accentink hover:underline">‹ Génération</Link>
          <PageHeader title={d.form?.title ?? d.topic_id} subtitle={`${d.topic_id} · ${d.status}${f ? ` · citations ${f.meta.quote_check}` : ""}`} />
          {error && <ErrorNote>{error}</ErrorNote>}
          {d.error && <ErrorNote>{d.error}</ErrorNote>}

          <Card className="flex flex-col gap-2 p-4 text-sm">
            <p><span className="font-medium">Étape : </span>{d.stage}{d.stage_detail ? ` · ${d.stage_detail}` : ""}{RUNNING.has(d.stage) && <Spinner className="ms-2 inline" />}</p>
            {d.stage === "needs_offset" && (
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">Décalage : page imprimée moins page du PDF (ex. 2134 si la page 1 du PDF est la page 2135)</span>
                  <input className={`${inputCls} w-40`} value={offset} onChange={(e) => setOffset(e.target.value)} />
                </label>
                <Button disabled={busy || !/^-?\d+$/.test(offset.trim())} onClick={() => run(api(`/fichegen/drafts/${id}/offset`, { method: "POST", body: JSON.stringify({ offset: Number(offset) }) }))}>Valider</Button>
              </div>
            )}
            {["ready", "done", "error"].includes(d.stage) && d.page_offset !== null && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted">Décalage des pages : {d.page_offset}{d.offset_detected ? " (détecté)" : " (saisi)"}</span>
                <select className={inputCls} value={model} onChange={(e) => setModel(e.target.value)}>
                  {d.models.map((m) => <option key={m} value={m}>{m}{m.includes("haiku") ? " (le moins cher)" : ""}</option>)}
                </select>
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={batch} onChange={(e) => setBatch(e.target.checked)} /> en lot (−50 %, plus lent)</label>
                <Button variant="primary" disabled={busy} onClick={() => run(api(`/fichegen/drafts/${id}/generate`, { method: "POST", body: JSON.stringify({ model, batch }) }))}>
                  {d.content ? "Regénérer" : "Générer"}
                </Button>
              </div>
            )}
            <p className="text-xs text-muted">
              Coût : {d.cost.cost_usd.toFixed(4)} $ ({d.cost.calls} appel(s) ; {Object.entries(d.cost.by_model).map(([m, c]) => `${m} ${c.toFixed(4)} $`).join(", ") || "aucun"}) ·
              jetons : {d.cost.input_tokens} entrée, {d.cost.output_tokens} sortie, {d.cost.cache_read_tokens} lus en cache
            </p>
            <p className="text-xs text-muted">Licence : {d.form?.licence_text || "non renseignée"} · {d.licence_scope === "internal" ? "usage interne seulement" : "publication autorisée"}</p>
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
                      <div key={line.id} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-panel/60">
                        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setShown({ page: line.source.page, quote: line.source.quote })}>
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
                          <div className="min-w-0 flex-1 cursor-pointer text-sm" onClick={() => setShown({ page: x.source.page, quote: x.source.quote })}>
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

          {d.dropped.length > 0 && (
            <Card className="flex flex-col gap-1 p-4">
              <h2 className="text-sm font-semibold text-ink">Écartées ({d.dropped.length})</h2>
              {d.dropped.map((x) => (
                <div key={x.element_id} className="cursor-pointer rounded-lg px-2 py-1 text-sm hover:bg-panel/60"
                  onClick={() => x.dropped_line && setShown({ page: x.dropped_line.source.page, quote: x.dropped_line.source.quote })}>
                  <span className="text-ink">{x.dropped_line?.text ?? (x.dropped_line as unknown as Dose | null)?.drug_dci}</span>
                  <span className="text-xs text-muted"> · {SECTION_LABEL[x.section] ?? x.section} · {x.reason}</span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      <aside className="flex min-h-0 flex-col gap-3 overflow-auto border-l border-line bg-surface p-4">
        <div className="flex flex-col gap-2">
          {dirty && <Button variant="primary" disabled={busy} onClick={() => run(api(`/fichegen/drafts/${id}/content`, { method: "PUT", body: JSON.stringify({ content: f }) }).then(() => setDirty(false)))}>Enregistrer les modifications</Button>}
          <input className={inputCls} placeholder="Nom du relecteur" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !f || dirty || !reviewer.trim()} onClick={() => run(api(`/fichegen/drafts/${id}/approve`, { method: "POST", body: JSON.stringify({ status: "review", reviewer }) }))}>Marquer relu</Button>
            <Button variant="primary" disabled={busy || !f || blocked.length > 0} title={blocked.length ? `Bloqué : ${blocked.join(", ")}` : "Publier"}
              onClick={() => run(api(`/fichegen/drafts/${id}/approve`, { method: "POST", body: JSON.stringify({ status: "published", reviewer }) }))}>Publier</Button>
            {f && ["review", "published"].includes(d.status) && <Button onClick={openInEditor}>Ouvrir en v1.1 dans l&apos;éditeur</Button>}
          </div>
          {blocked.length > 0 && <p className="text-xs text-caution">Publication bloquée : {blocked.join(", ")}.</p>}
          {f && f.meta.excluded_by_audience.length > 0 && <p className="text-xs text-muted">Hors champ pour ce public : {f.meta.excluded_by_audience.join(" · ")}</p>}
        </div>
        {shown && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-soft">Citation, page {shown.page}</p>
            <blockquote className="rounded-lg bg-panel/60 p-2 text-sm italic text-ink">{shown.quote}</blockquote>
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob URL of the page image, nothing to optimise */}
            {image ? <img src={image} alt={`Page ${shown.page}`} className="w-full rounded-lg border border-line" /> : <Spinner />}
          </div>
        )}
      </aside>
    </div>
  );
}
