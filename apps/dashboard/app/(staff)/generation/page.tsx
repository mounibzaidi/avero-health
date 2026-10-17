"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button, Card, Empty, ErrorNote, inputCls, PageHeader, Spinner, Tag } from "@/components/ui";
import { api, apiForm } from "@/lib/api";
import { dateFr } from "@/lib/labels";

/** One draft generated from a guideline PDF (services/api/app/fichegen), as listed. */
interface DraftRow {
  id: string; topic_id: string; form: { title: string; licence_scope: string }; status: string; stage: string;
  stage_detail: string | null; error: string | null; licence_scope: "internal" | "publish"; created_at: string;
}

const STAGE: Record<string, string> = {
  uploaded: "PDF reçu", ingesting: "lecture du PDF", needs_offset: "décalage des pages à saisir", ready: "prêt à générer",
  routing: "répartition des pages", generating: "génération", checking: "vérification des citations", done: "brouillon prêt", error: "erreur",
};

const blank = {
  title: "", topic_id: "", template: "urgence", audience: ["MG", "urgences"], siblings: "",
  source_id: "", source_type: "full_guideline", source_title: "", citation: "", licence_text: "", licence_scope: "internal" as "internal" | "publish",
};

/**
 * Fiche generation from a guideline PDF: the upload form (fiche identity, source, licence) and the drafts. A draft
 * opens in its review screen; nothing is published from here.
 */
export default function GenerationPage() {
  const router = useRouter();
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [form, setForm] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<DraftRow[]>("/fichegen/drafts").then(setRows, (e) => setError((e as Error).message));
  }, []);

  const set = (patch: Partial<typeof blank>) => setForm((f) => ({ ...f, ...patch }));
  const ok = file && form.title.trim() && /^[a-z0-9-]+$/.test(form.topic_id) && form.source_id.trim() && form.source_title.trim() && form.citation.trim();

  const submit = async () => {
    if (!file || !ok) return;
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("form", JSON.stringify({
        title: form.title.trim(), topic_id: form.topic_id, template: form.template, audience: form.audience,
        siblings: form.siblings.split(",").map((s) => s.trim()).filter(Boolean),
        source: { source_id: form.source_id.trim(), type: form.source_type, title: form.source_title.trim(), citation: form.citation.trim() },
        licence_text: form.licence_text.trim(), licence_scope: form.licence_scope,
      }));
      const d = await apiForm<DraftRow>("/fichegen/drafts", body);
      router.push(`/generation/${d.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const field = (label: string, key: keyof typeof blank, hint?: string, mono?: boolean) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">{label}</span>
      <input className={`${inputCls} ${mono ? "font-mono" : ""}`} placeholder={hint} value={form[key] as string} onChange={(e) => set({ [key]: e.target.value })} />
    </label>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-5 px-5 py-8">
      <PageHeader title="Génération de fiches" subtitle="Une recommandation en PDF devient un brouillon de fiche, chaque ligne vérifiée sur le PDF" />
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-sm font-semibold text-ink">Nouvelle fiche depuis un PDF</h2>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted">Recommandation (PDF)</span>
          <input type="file" accept="application/pdf,.pdf" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {field("Titre de la fiche", "title", "Syndrome coronarien aigu : prise en charge initiale")}
          {field("Identifiant (minuscules, tirets)", "topic_id", "sca-accaha-2025", true)}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Modèle</span>
            <select className={inputCls} value={form.template} onChange={(e) => set({ template: e.target.value })}>
              <option value="urgence">urgence</option><option value="pathologie">pathologie</option>
            </select>
          </label>
          {field("Source : identifiant", "source_id", "accaha2025", true)}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted">Source : type</span>
            <select className={inputCls} value={form.source_type} onChange={(e) => set({ source_type: e.target.value })}>
              {["full_guideline", "synthesis", "update_only", "product_info"].map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {field("Fiches liées (séparées par des virgules)", "siblings")}
          <div className="md:col-span-3">{field("Source : titre", "source_title")}</div>
          <div className="md:col-span-3">{field("Citation (qui a réellement écrit le document)", "citation", "Rao SV et al. J Am Coll Cardiol. 2025;85(22):2135-2237")}</div>
          <div className="md:col-span-3">{field("Licence (texte)", "licence_text", "© ACC/AHA : copie et modification interdites sans autorisation")}</div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="text-xs font-medium text-muted">Diffusion :</span>
          {(["internal", "publish"] as const).map((v) => (
            <label key={v} className="flex items-center gap-1.5">
              <input type="radio" checked={form.licence_scope === v} onChange={() => set({ licence_scope: v })} />
              {v === "internal" ? "usage interne seulement" : "publication autorisée"}
            </label>
          ))}
        </div>
        <Button variant="primary" className="self-start" disabled={!ok || busy} onClick={submit}>{busy ? <Spinner /> : "Envoyer le PDF"}</Button>
        <p className="text-xs text-muted">Le PDF est lu (LlamaParse et pdftotext) puis vous choisissez le modèle et lancez la génération ; rien n&apos;est payé avant ce clic, sauf la lecture LlamaParse (une fois par PDF).</p>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-ink">Brouillons</h2>
        {!rows ? <Spinner /> : rows.length === 0 ? <Empty>Aucun brouillon.</Empty> : (
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-0">
                <Link href={`/generation/${r.id}`} className="font-medium text-ink hover:underline">{r.form?.title ?? r.topic_id}</Link>
                <Tag>{r.topic_id}</Tag>
                <Tag tone={r.stage === "error" ? "urgent" : r.stage === "done" ? "accent" : "caution"}>{STAGE[r.stage] ?? r.stage}</Tag>
                <Tag>{r.status}</Tag>
                {r.licence_scope === "internal" && <Tag>usage interne</Tag>}
                <span className="text-xs text-muted">{dateFr(r.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
