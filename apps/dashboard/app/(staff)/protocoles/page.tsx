"use client";

import { evidenceLines, publicationGate, validateStructure, type Protocol } from "@avero/schema";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ButtonLink, Card, Empty, ErrorNote, PageHeader, Spinner, Tag } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { deleteFiche } from "@/lib/delete";
import { doiKey, TEMPLATE_LABEL, TO_COMPLETE } from "@/lib/labels";
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

  const load = useCallback(() => {
    void (async () => {
      const [rp, fv] = await Promise.all([
        supabase.from("guidelines_replaced").select("ref,title,year,replaced_by_title,replaced_by_year"),
        supabase.from("fiche_versions").select("subject_id,version,content,published_at").order("version", { ascending: false }),
      ]);
      setReplaced(new Map(((rp.data ?? []) as { ref: string | null; title: string | null; year: number | null; replaced_by_title: string; replaced_by_year: number | null }[])
        .filter((r) => r.ref).map((r) => [doiKey(r.ref!), `${r.title ?? "?"} (${r.year ?? "?"}) replaced by ${r.replaced_by_title} (${r.replaced_by_year ?? "?"})`])));
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
      setError(broken.length ? `Unreadable versions (not in the v1.1 format): ${broken.join(", ")}` : null);
    })();
  }, [supabase]);
  useEffect(load, [load]);
  const remove = (r: Row, what: "fiche" | "drafts") =>
    deleteFiche(supabase, r.id, r.content.meta.title || r.id, what, r.published !== null).then((done) => done && load(), (e) => setError((e as Error).message));

  const card = (r: Row) => {
    const m = r.content.meta;
    const outdated = r.content.sources.flatMap((s) => { const hit = s.url ? replaced.get(doiKey(s.url)) : undefined; return hit ? [hit] : []; });
    const sources = r.content.sources.map((s) => s.organisation).filter(Boolean).join(", ");
    const lines = evidenceLines(r.content).length;
    return (
      <Card key={r.id} className="group relative transition-[border-color,box-shadow] hover:border-accent/25 hover:shadow-[0_8px_30px_-12px_rgba(0,0,0,0.18)]">
        <Link href={`/fiche/${r.id}`} className="flex items-center gap-4 p-4 pe-14">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-[15px] font-semibold sm:truncate text-ink group-hover:text-accentink">{m.title || TO_COMPLETE}</h3>
              <Tag tone={m.template === "urgence" ? "urgent" : "neutral"}>{TEMPLATE_LABEL[m.template]}</Tag>
              {r.live ? <Tag tone="accent">live in the app</Tag> : r.published ? <Tag tone="caution">new draft (v{r.published} live)</Tag> : null}
            </div>
            <p className="mt-1 break-words text-xs text-muted sm:truncate">{[m.specialite, sources, `${lines} clinical line${lines === 1 ? "" : "s"}`, `v${r.version}`].filter(Boolean).join(" · ")}</p>
            <p className={`mt-2 flex items-center gap-1.5 text-xs font-medium ${r.open ? "text-caution" : "text-accent"}`}>
              <span className={`size-1.5 rounded-full ${r.open ? "bg-caution" : "bg-accent"}`} />
              {r.open ? `${r.open} issue${r.open > 1 ? "s" : ""} to resolve before publishing` : r.live ? "Passed the publication gate" : "Passes the publication gate, quotes to check"}
            </p>
            {outdated.length > 0 && <p className="mt-2 rounded-lg bg-flagbg px-3 py-2 text-xs font-medium text-flag">Source updated, fiche to review: {outdated.join(" ; ")}</p>}
          </div>
          <span aria-hidden className="text-lg text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accentink">›</span>
        </Link>
        {isAdmin && (
          <details className="absolute right-3 top-3">
            <summary className="grid size-8 cursor-pointer list-none place-items-center rounded-lg text-muted hover:bg-panel hover:text-ink" title="More">⋯</summary>
            <div className="absolute right-0 z-30 mt-1 flex w-48 flex-col rounded-xl border border-edge/15 bg-surface p-1 text-sm shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)]">
              {r.published !== null && !r.live && <button type="button" className="rounded-lg px-3 py-2 text-left text-flag hover:bg-flagbg" onClick={() => void remove(r, "drafts")}>Delete the draft</button>}
              <button type="button" className="rounded-lg px-3 py-2 text-left text-flag hover:bg-flagbg" onClick={() => void remove(r, "fiche")}>Delete the fiche</button>
            </div>
          </details>
        )}
      </Card>
    );
  };
  const groups = rows ? [
    { title: "In the app", rows: rows.filter((r) => r.published !== null) },
    { title: "Drafts", rows: rows.filter((r) => r.published === null) },
  ].filter((g) => g.rows.length) : [];

  return (
    <div className="mx-auto w-full max-w-[1000px] px-5 py-8">
      <PageHeader title="Protocols" subtitle={rows ? `${rows.length} fiche${rows.length === 1 ? "" : "s"} · ${rows.filter((r) => r.published !== null).length} in the app · every line sourced from a guideline page` : undefined}
        actions={isAdmin ? <ButtonLink variant="primary" href="/fiche/nouveau">New fiche</ButtonLink> : undefined} />
      {error && <div className="mb-4"><ErrorNote>{error}</ErrorNote></div>}
      {!rows ? (
        <div className="flex justify-center py-10 text-muted"><Spinner /></div>
      ) : rows.length === 0 ? (
        <Empty>No fiches yet.</Empty>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((g) => (
            <section key={g.title} className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{g.title} <span className="font-normal">({g.rows.length})</span></h2>
              {g.rows.map(card)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
