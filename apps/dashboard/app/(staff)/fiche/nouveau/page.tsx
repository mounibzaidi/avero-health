"use client";

import { evidenceLines, forStorage, fromLegacy, isLegacy, validateStructure, type Protocol } from "@avero/schema";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { Button, Card, ErrorNote, inputCls, Spinner } from "@/components/ui";
import { api, apiForm } from "@/lib/api";
import { deleteStored } from "@/lib/delete";
import { useAuth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/client";

type Pdf = { path: string; title: string };
/** A source's PDF: a file to upload, a stored one (already linked, or kept in the Collecte topic), or none (removed). */
type Choice = { file: File } | { path: string } | { none: true };

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
 * New fiche: paste its JSON, give each source its PDF, and it opens beside the PDF to be checked block by block. Saved
 * as a draft version at once (a fiche already there gets a new version).
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
  const [choice, setChoice] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { protocol, error: parseError } = useMemo(() => parse(text), [text]);
  const fid = protocol?.meta.id ?? null;
  const sourceIds = useMemo(() => protocol?.sources.map((s) => s.id) ?? [], [protocol]);

  // the PDFs on offer: those kept in the Collecte topic and with the fiche, and the ones its sources already have
  useEffect(() => {
    if (!fid) return;
    const files = (p: string) => api<{ files: { path: string | null; title: string }[] }>(p).then((r) => r.files.filter((x): x is Pdf => !!x.path), () => []);
    void Promise.all([files(`/crawl/topics/${encodeURIComponent(topic ?? fid)}`), files(`/crawl/fiches/${encodeURIComponent(fid)}/files`)])
      .then(([a, b]) => setStored([...b, ...a.filter((x) => !b.some((y) => y.path === x.path))]));
  }, [fid, topic]);
  // the PDFs this fiche's sources already have (a fiche imported again): links are per fiche, never another fiche's
  useEffect(() => {
    if (!fid || !sourceIds.length) return;
    void supabase.from("source_pdfs").select("source_id,pdf_path").eq("subject_id", fid).in("source_id", sourceIds)
      .then(({ data }) => setLinked(Object.fromEntries((data ?? []).map((r: { source_id: string; pdf_path: string }) => [r.source_id, r.pdf_path]))));
  }, [supabase, fid, sourceIds]);

  const pdfOf = (sid: string): { file: File } | { path: string } | null => {
    const c = choice[sid] ?? (linked[sid] ? { path: linked[sid] } : stored.length === 1 && sourceIds.length === 1 ? { path: stored[0].path } : null);
    return c && !("none" in c) ? c : null;
  };
  // a PDF is not required: one can be given later, in the editor's Sources
  const ready = !!protocol;
  const remove = (sid: string) => setChoice({ ...choice, [sid]: { none: true } });
  /** A PDF stored with this fiche deleted from storage, and dropped from what the sources picked. */
  const deleteFile = (path: string) => void deleteStored(path, title(path.split("/").pop() ?? "")).then((done) => {
    if (!done) return;
    setStored((cur) => cur.filter((x) => x.path !== path));
    setLinked((cur) => Object.fromEntries(Object.entries(cur).filter(([, p]) => p !== path)));
    setChoice((cur) => Object.fromEntries(Object.entries(cur).map(([k, c]) => [k, "path" in c && c.path === path ? { none: true as const } : c])));
  }, (e) => setError((e as Error).message));

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
      for (const sid of sourceIds) {
        const c = pdfOf(sid);
        if (!c) {
          // removed here: an earlier link of this source is undone
          if (linked[sid]) {
            const r = await supabase.from("source_pdfs").delete().eq("subject_id", id).eq("source_id", sid);
            if (r.error) throw new Error(r.error.message);
          }
          continue;
        }
        let path = "path" in c ? c.path : null;
        if ("file" in c) {
          const form = new FormData();
          form.append("file", c.file);
          path = (await apiForm<{ path: string }>(`/crawl/fiches/${encodeURIComponent(id)}/upload`, form)).path;
        }
        if (path !== linked[sid]) {
          const r = await supabase.from("source_pdfs").upsert({ subject_id: id, source_id: sid, pdf_path: path, updated_at: new Date().toISOString(), updated_by: session.user.id });
          if (r.error) throw new Error(r.error.message);
        }
      }
      const v = await supabase.from("fiche_versions").insert({ subject_id: id, version, content: forStorage(content), created_by: session.user.id });
      if (v.error) throw new Error(v.error.message);
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

      <Card className={`flex flex-col gap-3 p-5 ${protocol ? "" : "opacity-50"}`}>
        <h2 className="text-sm font-semibold text-ink"><span className="me-2 text-muted">2</span>The PDF {sourceIds.length > 1 ? "of each source" : "of the guideline"}</h2>
        {!protocol ? <p className="text-xs text-muted">Paste the JSON first.</p> : !sourceIds.length ? (
          <p className="text-xs text-caution">This fiche has no source: add one in the JSON (“sources”).</p>
        ) : protocol.sources.map((s) => {
          const c = pdfOf(s.id);
          return (
            <div key={s.id} className="flex flex-col gap-1.5 rounded-lg bg-panel/60 p-3">
              <p className="text-sm text-ink"><b className="font-semibold">{s.organisation || s.id}</b> <span className="text-soft">{s.title}</span></p>
              <div className="flex flex-wrap items-center gap-2">
                {(stored.length > 0 || linked[s.id]) && (
                  <select className={`${inputCls} h-9 min-w-0 flex-1 text-sm`} value={c && "path" in c ? c.path : ""}
                    onChange={(e) => setChoice({ ...choice, [s.id]: { path: e.target.value } })}>
                    <option value="" disabled>{c && "file" in c ? "File chosen alongside" : "Pick a stored PDF"}</option>
                    {linked[s.id] && !stored.some((x) => x.path === linked[s.id]) && <option value={linked[s.id]}>{title(linked[s.id].split("/").pop() ?? "")} (already linked)</option>}
                    {stored.map((x) => <option key={x.path} value={x.path}>{title(x.title)}</option>)}
                  </select>
                )}
                <label className="inline-flex h-9 cursor-pointer items-center rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-panel">
                  {c && "file" in c ? c.file.name : "Upload a PDF"}
                  <input type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setChoice({ ...choice, [s.id]: { file: f } }); }} />
                </label>
                {c && (
                  <button type="button" className="h-9 rounded-lg px-2 text-sm font-medium text-flag hover:bg-flagbg" onClick={() => remove(s.id)}>Remove</button>
                )}
              </div>
              {!c && <p className="text-xs text-muted">No PDF for this source: you can add it later in the editor (Sources).</p>}
              {c && "path" in c && c.path.startsWith(`fiches/${fid}/`) && (
                <button type="button" className="self-start text-xs text-flag hover:underline" onClick={() => deleteFile(c.path)}>Delete this PDF from storage</button>
              )}
            </div>
          );
        })}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}
      <Button variant="primary" className="h-10 self-end px-5" disabled={!ready || busy} onClick={() => void open()}>
        {busy ? <Spinner /> : "Open for checking ›"}
      </Button>
    </div>
  );
}
