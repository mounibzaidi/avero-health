"use client";

import { evidenceLines, forStorage, fromLegacy, isLegacy, validateStructure, type Protocol } from "@avero/schema";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { Button, Card, ErrorNote, inputCls, Spinner } from "@/components/ui";
import { api, apiForm } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { deleteStored } from "@/lib/delete";
import { createClient } from "@/lib/supabase/client";

type Pdf = { path: string; title: string };
/** One PDF in the list: a file chosen here (uploaded on opening) or one already stored. */
type Entry = { key: string; name: string; file?: File; path?: string };

const title = (t: string) => { try { return decodeURIComponent(t); } catch { return t; } };

/** The JSON as a v1.1 fiche (the older fiche-protocole format converted), or why not. */
function parse(text: string): { protocol: Protocol | null; error: string | null } {
  if (!text.trim()) return { protocol: null, error: null };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { protocol: null, error: `Unreadable JSON: ${(e as Error).message}` };
  }
  const { protocol, issues } = validateStructure(isLegacy(raw) ? fromLegacy(raw) : raw);
  return protocol ? { protocol, error: null } : { protocol: null, error: `This JSON is not a v1.1 fiche: ${issues.slice(0, 5).map((i) => i.message).join(" ; ")}` };
}

/**
 * New fiche: paste its JSON, add its PDFs (one list: each PDF says which source it is), and it opens beside the PDF
 * to be checked block by block. Saved as a draft version at once (a fiche already there gets a new version). The
 * fiche's own stored PDFs that no source uses are deleted on opening: nothing is left behind.
 */
export default function NewFichePage() {
  return <Suspense><NewFiche /></Suspense>;
}

function NewFiche() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { session } = useAuth();
  const [text, setText] = useState("");
  const topic = useSearchParams().get("topic");
  const [stored, setStored] = useState<Pdf[]>([]);
  const [linked, setLinked] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Entry[]>([]);
  const nextKey = useRef(0);
  const [assign, setAssign] = useState<Record<string, string | null>>({}); // entry key → source id, set by hand
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { protocol, error: parseError } = useMemo(() => parse(text), [text]);
  const fid = protocol?.meta.id ?? null;
  const sources = useMemo(() => protocol?.sources ?? [], [protocol]);
  const sourceIds = useMemo(() => sources.map((s) => s.id), [sources]);

  // the PDFs already stored: the fiche's own (an earlier import), and a Collecte topic's when the page was opened from it
  useEffect(() => {
    if (!fid) return;
    const files = (p: string) => api<{ files: { path: string | null; title: string }[] }>(p).then((r) => r.files.filter((x): x is Pdf => !!x.path), () => []);
    void Promise.all([topic ? files(`/crawl/topics/${encodeURIComponent(topic)}`) : Promise.resolve([]), files(`/crawl/fiches/${encodeURIComponent(fid)}/files`)])
      .then(([a, b]) => setStored([...b, ...a.filter((x) => !b.some((y) => y.path === x.path))]));
  }, [fid, topic]);
  // the PDFs this fiche's sources already have (a fiche imported again): links are per fiche, never another fiche's
  useEffect(() => {
    if (!fid || !sourceIds.length) return;
    void supabase.from("source_pdfs").select("source_id,pdf_path").eq("subject_id", fid).in("source_id", sourceIds)
      .then(({ data }) => setLinked(Object.fromEntries((data ?? []).map((r: { source_id: string; pdf_path: string }) => [r.source_id, r.pdf_path]))));
  }, [supabase, fid, sourceIds]);

  const entries: Entry[] = [...uploads, ...stored.map((x) => ({ key: x.path, name: title(x.title), path: x.path }))];
  /** The source an entry is for: set by hand, else the source already linked to it, else none. */
  const sourceOf = (e: Entry): string | null =>
    e.key in assign ? assign[e.key] : (sourceIds.find((sid) => e.path && linked[sid] === e.path) ?? null);
  const used = new Set(entries.map(sourceOf).filter(Boolean));
  /** One PDF per source: giving a source to an entry takes it from any other. */
  const setSource = (key: string, sid: string | null) =>
    setAssign(Object.fromEntries([...entries.map((e) => [e.key, sid && sourceOf(e) === sid ? null : sourceOf(e)]), [key, sid]]));
  /** Files chosen here, each given to the next source without a PDF. */
  const add = (files: File[]) => {
    const free = sourceIds.filter((sid) => !used.has(sid));
    const added = files.map((file) => ({ key: `upload-${nextKey.current++}`, name: file.name, file }));
    setUploads([...uploads, ...added]);
    setAssign({ ...Object.fromEntries(entries.map((e) => [e.key, sourceOf(e)])), ...Object.fromEntries(added.map((e) => [e.key, free.shift() ?? null])) });
  };
  /** Out of the list: a file chosen here is dropped; a stored one is deleted from storage (asked first). */
  const remove = (e: Entry) => {
    if (e.file) return setUploads(uploads.filter((u) => u.key !== e.key));
    void deleteStored(e.path!, e.name).then((done) => {
      if (!done) return;
      setStored((cur) => cur.filter((x) => x.path !== e.path));
      setLinked((cur) => Object.fromEntries(Object.entries(cur).filter(([, p]) => p !== e.path)));
    }, (err) => setError((err as Error).message));
  };
  const missing = sources.filter((s) => !used.has(s.id));
  const ownUnused = entries.filter((e) => e.path?.startsWith(`fiches/${fid}/`) && !sourceOf(e));

  const open = async () => {
    if (!protocol || !session) return;
    setBusy(true);
    setError(null);
    try {
      const id = protocol.meta.id;
      // the fiche first: a source's PDF is linked to it
      const content: Protocol = { ...protocol, meta: { ...protocol.meta, status: "draft" } };
      const subject = { title: content.meta.title, template: content.meta.template, specialite: content.meta.specialite || "" };
      const last = await supabase.from("fiche_versions").select("version").eq("subject_id", id).order("version", { ascending: false }).limit(1);
      const version = (last.data?.[0]?.version ?? 0) + 1;
      const s = version === 1 ? await supabase.from("subjects").upsert({ id, ...subject }) : await supabase.from("subjects").update({ ...subject, updated_at: new Date().toISOString() }).eq("id", id);
      if (s.error) throw new Error(s.error.message);
      const kept = new Set<string>();
      for (const sid of sourceIds) {
        const e = entries.find((x) => sourceOf(x) === sid);
        if (!e) {
          // no PDF for this source: an earlier link is undone
          if (linked[sid]) {
            const r = await supabase.from("source_pdfs").delete().eq("subject_id", id).eq("source_id", sid);
            if (r.error) throw new Error(r.error.message);
          }
          continue;
        }
        let path = e.path ?? null;
        if (e.file) {
          const form = new FormData();
          form.append("file", e.file);
          path = (await apiForm<{ path: string }>(`/crawl/fiches/${encodeURIComponent(id)}/upload`, form)).path;
        }
        if (path) kept.add(path);
        if (path !== linked[sid]) {
          const r = await supabase.from("source_pdfs").upsert({ subject_id: id, source_id: sid, pdf_path: path, updated_at: new Date().toISOString(), updated_by: session.user.id });
          if (r.error) throw new Error(r.error.message);
        }
      }
      const v = await supabase.from("fiche_versions").insert({ subject_id: id, version, content: forStorage(content), created_by: session.user.id });
      if (v.error) throw new Error(v.error.message);
      // the fiche's own PDFs no source uses (left from an earlier import, or replaced here) are deleted, not kept
      const unused = stored.filter((x) => x.path.startsWith(`fiches/${id}/`) && !kept.has(x.path)).flatMap((x) => [x.path, `${x.path}.json`]);
      if (unused.length) {
        const gone = await supabase.storage.from("sources").remove(unused);
        if (gone.error) throw new Error(`The fiche is saved; its unused PDFs were not deleted: ${gone.error.message}`);
      }
      router.push(`/fiche/${id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-5 py-8">
      <Link href="/protocoles" className="self-start text-sm text-accentink hover:underline">‹ Protocols</Link>
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-ink">New fiche</h1>
        <p className="mt-1 text-sm text-soft">Paste the JSON and attach the guideline PDF: the fiche opens beside the PDF to check each block, then publish.</p>
      </div>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-sm font-semibold text-ink"><span className="me-2 text-muted">1</span>The fiche JSON</h2>
          <label className="cursor-pointer text-xs font-medium text-accentink hover:underline">
            or pick a .json file
            <input type="file" accept="application/json,.json" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setText(await f.text()); }} />
          </label>
        </div>
        <textarea autoFocus rows={10} spellCheck={false} className={`${inputCls} h-auto py-2 font-mono text-xs`} placeholder='{ "schema_version": "1.1.0", "meta": { … } }'
          value={text} onChange={(e) => setText(e.target.value)} />
        {parseError && <p className="text-xs text-flag">{parseError}</p>}
        {protocol && (
          <p className="text-sm text-accentink">✓ {protocol.meta.title || protocol.meta.id} · {evidenceLines(protocol).length} blocks · {protocol.sources.length} source(s)</p>
        )}
      </Card>

      <Card className={`flex flex-col gap-3 p-5 ${protocol ? "" : "pointer-events-none opacity-50"}`}>
        <div className="flex items-center gap-2">
          <h2 className="flex-1 text-sm font-semibold text-ink"><span className="me-2 text-muted">2</span>The PDFs</h2>
          <label className="cursor-pointer">
            <span className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-panel">Upload PDFs</span>
            <input type="file" multiple accept="application/pdf,.pdf" className="hidden" disabled={!protocol}
              onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ""; if (list.length) add(list); }} />
          </label>
        </div>
        {!protocol ? <p className="text-xs text-muted">Paste the JSON first.</p> : !entries.length ? (
          <p className="text-xs text-muted">No PDF yet. Upload the guideline PDF{sources.length > 1 ? "s (one or several at once)" : ""}, or add {sources.length > 1 ? "them" : "it"} later in the editor.</p>
        ) : (
          <ul className="flex flex-col">
            {entries.map((e) => (
              <li key={e.key} className="flex items-center gap-3 border-t border-line py-2 first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-sm text-ink" title={e.name}>{e.name}</span>
                <select className={`${inputCls} h-8 w-60 shrink-0 text-xs`} value={sourceOf(e) ?? ""} onChange={(ev) => setSource(e.key, ev.target.value || null)}>
                  <option value="">Not used{e.path?.startsWith(`fiches/${fid}/`) ? " (deleted on opening)" : ""}</option>
                  {sources.map((s) => <option key={s.id} value={s.id}>{s.organisation || s.id}</option>)}
                </select>
                <button type="button" className="shrink-0 text-xs font-medium text-flag hover:underline" onClick={() => remove(e)}>{e.file ? "Remove" : "Delete"}</button>
              </li>
            ))}
          </ul>
        )}
        {protocol && entries.length > 0 && missing.length > 0 && (
          <p className="text-xs text-muted">No PDF yet for: {missing.map((s) => s.organisation || s.id).join(", ")}. You can add {missing.length > 1 ? "them" : "it"} later in the editor.</p>
        )}
        {ownUnused.length > 0 && <p className="text-xs text-caution">{ownUnused.length} stored PDF{ownUnused.length > 1 ? "s" : ""} not used: deleted when you open the fiche.</p>}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}
      <Button variant="primary" className="h-10 self-end px-5" disabled={!protocol || busy} onClick={() => void open()}>
        {busy ? <Spinner /> : "Open for checking ›"}
      </Button>
    </div>
  );
}
