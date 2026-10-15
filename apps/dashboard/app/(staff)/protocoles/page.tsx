"use client";

import { publicationGate, TEMPLATE_LABEL, validateStructure, type Protocol } from "@medguides/schema";
import { useEffect, useMemo, useState } from "react";

import { ButtonLink, Card, Empty, ErrorNote, PageHeader, Spinner, Tag } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { doiKey } from "@/lib/labels";
import { createClient } from "@/lib/supabase/client";

type VersionRow = { subject_id: string; version: number; content: unknown; published_at: string | null };
type Row = { id: string; version: number; content: Protocol; live: boolean; published: number | null; open: number };

/** Protocoles: every fiche (its latest version), what is left before publishing, and its replaced sources. */
export default function ProtocolesPage() {
  const supabase = useMemo(() => createClient(), []);
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replaced, setReplaced] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    void (async () => {
      const [rp, fv] = await Promise.all([
        supabase.from("guidelines_replaced").select("ref,title,year,replaced_by_title,replaced_by_year"),
        supabase.from("fiche_versions").select("subject_id,version,content,published_at").order("version", { ascending: false }),
      ]);
      setReplaced(new Map(((rp.data ?? []) as { ref: string | null; title: string | null; year: number | null; replaced_by_title: string; replaced_by_year: number | null }[])
        .filter((r) => r.ref).map((r) => [doiKey(r.ref!), `${r.title ?? "?"} (${r.year ?? "?"}) remplacée par ${r.replaced_by_title} (${r.replaced_by_year ?? "?"})`])));
      if (fv.error) return setError(fv.error.message);
      const versions = fv.data as VersionRow[];
      const pubIds = new Set(versions.filter((v) => v.published_at).map((v) => v.subject_id));
      const out = new Map<string, Row>();
      const broken: string[] = [];
      for (const v of versions) {
        const row = out.get(v.subject_id);
        if (row) {
          if (row.published === null && v.published_at) row.published = v.version;
          continue;
        }
        const { protocol } = validateStructure(v.content);
        if (!protocol) {
          broken.push(`${v.subject_id} v${v.version}`);
          continue;
        }
        // Quotes are checked in the editor; here, what is left apart from them.
        const open = publicationGate(protocol, { published: pubIds, quotes: {} }).filter((i) => i.rule !== "quote").length;
        out.set(v.subject_id, { id: v.subject_id, version: v.version, content: protocol, live: !!v.published_at, published: v.published_at ? v.version : null, open });
      }
      setRows([...out.values()].sort((a, b) => a.content.meta.title.localeCompare(b.content.meta.title, "fr")));
      setError(broken.length ? `Versions illisibles (pas au format v1.1) : ${broken.join(", ")}` : null);
    })();
  }, [supabase]);

  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-8">
      <PageHeader title="Tous les protocoles" subtitle={rows ? `${rows.length} fiche(s) · ${rows.filter((r) => r.published).length} publiée(s)` : undefined}
        actions={isAdmin ? <ButtonLink href="/fiche/nouveau">Nouvelle fiche</ButtonLink> : undefined} />
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      {!rows ? (
        <div className="flex justify-center py-10 text-muted"><Spinner /></div>
      ) : rows.length === 0 ? (
        <Empty>Aucune fiche pour l&apos;instant.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const m = r.content.meta;
            const outdated = r.content.sources.flatMap((s) => { const hit = s.url ? replaced.get(doiKey(s.url)) : undefined; return hit ? [hit] : []; });
            return (
              <Card key={r.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-ink">{m.title || "[à compléter]"}</h2>
                  <Tag tone={m.template === "urgence" ? "urgent" : "neutral"}>{TEMPLATE_LABEL[m.template]}</Tag>
                  <Tag tone={r.live ? "accent" : "neutral"}>{r.live ? "publiée" : r.published ? `brouillon (v${r.published} publiée)` : "brouillon"}</Tag>
                  <Tag>v{r.version}</Tag>
                  <span className="min-w-0 flex-1 text-xs text-muted">{m.specialite} · {r.content.sources.map((s) => s.organisation).filter(Boolean).join(", ")}</span>
                  <ButtonLink className="h-8" href={`/fiche/${r.id}`}>Ouvrir et modifier</ButtonLink>
                </div>
                <p className={`mt-2 text-sm ${r.open ? "text-flag" : "text-accent"}`}>
                  {r.open ? `${r.open} point(s) bloquant(s) avant publication (hors citations)` : "Prête, sous réserve de la vérification des citations"}
                </p>
                {outdated.length > 0 && <p className="mt-2 rounded-lg bg-flagbg px-3 py-2 text-sm font-medium text-flag">Source mise à jour, fiche à revoir : {outdated.join(" ; ")}</p>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
