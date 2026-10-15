"use client";

import { Fiche, type ResolvedRef } from "@medguides/schema";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FicheCard, type FicheRow } from "@/components/FicheCard";
import { ButtonLink, Empty, ErrorNote, PageHeader, Spinner } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

type VersionRow = { subject_id: string; version: number; content: unknown; published_at: string | null };

/** Protocoles: every fiche (its latest version), its checks, and the publish gate. */
export default function ProtocolesPage() {
  const supabase = useMemo(() => createClient(), []);
  const { session, staff, isAdmin } = useAuth();
  const [rows, setRows] = useState<FicheRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaced, setReplaced] = useState<Map<string, string>>(new Map());

  const load = useCallback(async () => {
    const rp = await supabase.from("guidelines_replaced").select("ref,title,year,replaced_by_title,replaced_by_year");
    const norm = (x: string) => x.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim();
    setReplaced(new Map(((rp.data ?? []) as { ref: string | null; title: string | null; year: number | null; replaced_by_title: string; replaced_by_year: number | null }[])
      .filter((r) => r.ref).map((r) => [norm(r.ref!), `${r.title ?? "?"} (${r.year ?? "?"}) remplacée par ${r.replaced_by_title} (${r.replaced_by_year ?? "?"})`])));
    const { data, error } = await supabase.from("fiche_versions").select("subject_id,version,content,published_at").order("version", { ascending: false });
    if (error) return setError(error.message);
    const out = new Map<string, FicheRow>();
    const broken: string[] = [];
    for (const v of data as VersionRow[]) {
      const row = out.get(v.subject_id);
      if (row) {
        if (row.published === null && v.published_at) row.published = v.version;
        continue;
      }
      const parsed = Fiche.safeParse(v.content);
      if (!parsed.success) {
        broken.push(`${v.subject_id} v${v.version}`);
        continue;
      }
      out.set(v.subject_id, { id: v.subject_id, latest: { version: v.version, content: parsed.data, publishedAt: v.published_at }, published: v.published_at ? v.version : null });
    }
    setRows([...out.values()].sort((a, b) => a.latest.content.meta.title.localeCompare(b.latest.content.meta.title, "fr")));
    setError(broken.length ? `Versions illisibles (autre schéma) : ${broken.join(", ")}` : null);
  }, [supabase]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first load of the page's data
    void load();
  }, [load]);

  // Refs resolve against the fiches of the library: published, unpublished, or missing.
  const ctx = useMemo(() => {
    const known = new Map<string, ResolvedRef>((rows ?? []).map((r) => [r.id, r.published ? "published" : "unpublished"]));
    return { resolve: (id: string) => known.get(id) };
  }, [rows]);

  const publish = async (row: FicheRow, content: Fiche) => {
    // Server checks first: every quote on its page of the source PDF, every number of the line in its quote.
    const q = await api<{ checked: number; ok: number; results: { ok: boolean }[] }>("/checks/quotes", { method: "POST", body: JSON.stringify({ fiche: content }) });
    if (q.ok < q.checked) throw new Error(`Publication bloquée : ${q.checked - q.ok} citation(s) non vérifiée(s) sur le PDF de la source. Ouvrez la fiche et « Vérifier les citations ».`);
    const now = new Date().toISOString();
    const { error } = await supabase.from("fiche_versions").insert({
      subject_id: row.id, version: row.latest.version + 1, content, created_by: session!.user.id, published_at: now, published_by: session!.user.id,
    });
    if (error) throw new Error(error.message);
    await load();
  };

  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-8">
      <PageHeader title="Tous les protocoles" subtitle={rows ? `${rows.length} fiche(s) · ${rows.filter((r) => r.published).length} publiée(s)` : undefined}
        actions={isAdmin ? <ButtonLink href="/fiche/nouveau">Nouvelle fiche · Coller un JSON</ButtonLink> : undefined} />
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      {!rows ? (
        <div className="flex justify-center py-10 text-muted"><Spinner /></div>
      ) : rows.length === 0 ? (
        <Empty>Aucune fiche pour l&apos;instant.</Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {rows.map((r) => (
            <FicheCard key={r.id} row={r} ctx={ctx} canPublish={isAdmin} defaultReviewer={staff?.name ?? ""} onPublish={(c) => publish(r, c)}
              outdated={r.latest.content.meta.sources.flatMap((s) => { const hit = s.doi ? replaced.get(s.doi.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim()) : undefined; return hit ? [hit] : []; })} />
          ))}
        </div>
      )}
    </div>
  );
}
