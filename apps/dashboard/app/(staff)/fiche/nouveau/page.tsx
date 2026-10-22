"use client";

import { evidenceLines, forStorage, fromLegacy, isLegacy, validateStructure, type Protocol } from "@avero/schema";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { Button, Card, ErrorNote, inputCls, Spinner } from "@/components/ui";
import { api, apiForm } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EditableName } from "@/components/EditableName";
import { deleteStored, renameStored } from "@/lib/delete";
import { matchSources, pdfText } from "@/lib/pdfMatch";
import { createClient } from "@/lib/supabase/client";
import { mayBe, unlinkedPdfs } from "@/lib/unlinked";

type Pdf = { path: string; title: string };
/** One PDF in the list: a file chosen here (uploaded on opening) or one already stored; `found`: stored, used by no
 * fiche, and recognised as a source still without a PDF. */
type Entry = { key: string; name: string; file?: File; path?: string; found?: true };

const title = (t: string) => { try { return decodeURIComponent(t); } catch { return t; } };
/** A source as the PDF list names it: the guideline's title after its body's short name ("HAS: Prise en charge…"). */
function sourceLabel(s: Protocol["sources"][number]): string {
  const org = s.organisation.trim();
  const short = /\(([\p{Lu}][\p{L}0-9&/-]{1,9})\)/u.exec(org)?.[1] ?? (org.length <= 14 ? org : "");
  return [short, s.title.trim() || s.id].filter(Boolean).join(": ");
}

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
 * New fiche: paste its JSON, add its PDFs (each recognised as one of the JSON's sources from what its first pages
 * say), and it opens beside the PDF to be checked block by block. Saved as a draft version at once (a fiche already there gets a new version). The
 * fiche's own stored PDFs that no source uses are deleted on opening: nothing is left behind. A source still without a
 * PDF gets one already in storage that no fiche uses (left under a former fiche id, or from Collecte) when it surely
 * is that source: it is linked, not uploaded again.
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
  const [spare, setSpare] = useState<Pdf[]>([]); // stored, used by no fiche
  const [skipped, setSkipped] = useState<string[]>([]); // found PDFs set aside by hand
  const [linked, setLinked] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Entry[]>([]);
  const [names, setNames] = useState<Record<string, string>>({}); // stored PDF path → new name, saved on opening
  const nextKey = useRef(0);
  const [manual, setManual] = useState<Record<string, string | null>>({}); // entry key → source id, set by hand
  const [texts, setTexts] = useState<Record<string, string>>({}); // entry key → its first pages ("" if unreadable)
  const reading = useRef(new Set<string>());
  const [changing, setChanging] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { protocol, error: parseError } = useMemo(() => parse(text), [text]);
  const fid = protocol?.meta.id ?? null;
  const sources = useMemo(() => protocol?.sources ?? [], [protocol]);
  const sourceIds = useMemo(() => sources.map((s) => s.id), [sources]);
  // the fiche this JSON's id already names: the JSON becomes its new draft version
  const [existing, setExisting] = useState<{ id: string; title: string; live: boolean } | null>(null);
  useEffect(() => {
    if (!fid) return;
    void Promise.all([
      supabase.from("subjects").select("title").eq("id", fid).maybeSingle(),
      supabase.from("fiche_versions").select("version").eq("subject_id", fid).not("published_at", "is", null).limit(1),
    ]).then(([s, v]) => setExisting(s.data ? { id: fid, title: (s.data as { title: string }).title, live: !!v.data?.length } : null));
  }, [supabase, fid]);
  const replacing = existing && existing.id === fid ? existing : null;

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

  useEffect(() => {
    if (!fid) return;
    void unlinkedPdfs(supabase).then(setSpare, () => setSpare([]));
  }, [supabase, fid]);

  const own: Entry[] = useMemo(() => [...uploads, ...stored.map((x) => ({ key: x.path, name: title(x.title), path: x.path }))], [uploads, stored]);
  // the unused stored PDFs worth reading: named like one of the sources (a 15 MB guideline of another topic is not read)
  const candidates: Entry[] = useMemo(
    () => spare.filter((x) => !stored.some((y) => y.path === x.path) && !skipped.includes(x.path) && sources.some((s) => mayBe(x.title, s)))
      .map((x) => ({ key: x.path, name: title(x.title), path: x.path, found: true as const })),
    [spare, stored, skipped, sources],
  );
  // each PDF read once (its first pages), to recognise which source it is
  useEffect(() => {
    for (const e of [...own, ...candidates]) {
      if (reading.current.has(e.key)) continue;
      reading.current.add(e.key);
      const src = e.file ? Promise.resolve(e.file) : supabase.storage.from("sources").createSignedUrl(e.path!, 600).then(({ data }) => data?.signedUrl ?? "");
      void src.then((x) => (x ? pdfText(x) : "")).catch(() => "").then((t) => setTexts((cur) => ({ ...cur, [e.key]: t })));
    }
  }, [own, candidates, supabase]);
  const ownKeys = useMemo(() => new Set(own.map((e) => e.key)), [own]);
  const matches = useMemo(() => matchSources(Object.fromEntries(Object.entries(texts).filter(([k, t]) => t && ownKeys.has(k))), sources), [texts, sources, ownKeys]);

  /** Each PDF's source, one PDF per source: set by hand, else recognised from its content, else linked before. */
  const { assigned, why } = useMemo(() => {
    const entries = own;
    const assigned: Record<string, string | null> = {};
    const why: Record<string, "manual" | "sure" | "guess" | "linked" | "only" | "found"> = {};
    const claimed = new Set<string>();
    const give = (key: string, sid: string | null | undefined, reason: (typeof why)[string]) => {
      if (key in assigned || sid === undefined || (sid && claimed.has(sid))) return;
      assigned[key] = sid;
      why[key] = reason;
      if (sid) claimed.add(sid);
    };
    for (const e of entries) if (e.key in manual) give(e.key, manual[e.key], "manual");
    for (const e of entries) if (matches[e.key]) give(e.key, matches[e.key].source, matches[e.key].sure ? "sure" : "guess");
    // an old link only for a PDF not recognised as something else (a copy of a source already given stays unused)
    for (const e of entries) if (!matches[e.key]?.sure) give(e.key, sourceIds.find((sid) => e.path && linked[sid] === e.path), "linked");
    if (sourceIds.length === 1 && entries.length === 1) give(entries[0].key, sourceIds[0], "only");
    // then the sources still without a PDF: a stored one no fiche uses, only when it surely is that source
    const free = sources.filter((s) => !claimed.has(s.id));
    const found = matchSources(Object.fromEntries(candidates.filter((e) => texts[e.key]).map((e) => [e.key, texts[e.key]])), free);
    for (const [key, m] of Object.entries(found)) if (m.sure) give(key, m.source, "found");
    return { assigned, why };
  }, [own, candidates, texts, sources, manual, matches, sourceIds, linked]);
  const entries: Entry[] = useMemo(() => [...own, ...candidates.filter((e) => assigned[e.key])], [own, candidates, assigned]);
  const sourceOf = (e: Entry): string | null => assigned[e.key] ?? null;
  const used = new Set(entries.map(sourceOf).filter(Boolean));
  /** A source given by hand: taken from any other PDF set to it by hand. */
  const setSource = (key: string, sid: string | null) => {
    setManual((m) => ({ ...Object.fromEntries(Object.entries(m).filter(([, v]) => !sid || v !== sid)), [key]: sid }));
    setChanging(null);
  };
  const add = (files: File[]) => setUploads([...uploads, ...files.map((file) => ({ key: `upload-${nextKey.current++}`, name: file.name, file }))]);
  /** A PDF renamed: a file chosen here before it is uploaded (it is stored under that name), a stored one in its
   * record when the fiche is opened (a found PDF is listed from elsewhere: renaming it at once would not show). */
  const rename = (e: Entry, name: string) => {
    if (e.file) {
      const file = new File([e.file], /\.pdf$/i.test(name) ? name : `${name}.pdf`, { type: e.file.type });
      return setUploads(uploads.map((u) => (u.key === e.key ? { ...u, name: file.name, file } : u)));
    }
    setNames({ ...names, [e.path!]: name });
  };
  const nameOf = (e: Entry) => (e.path && names[e.path]) || e.name;
  /** Out of the list: a file chosen here is dropped; a stored one is deleted from storage (asked first). */
  const remove = (e: Entry) => {
    if (e.file) return setUploads(uploads.filter((u) => u.key !== e.key));
    void deleteStored(e.path!, nameOf(e)).then((done) => {
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
        if (e.path && names[e.path]) await renameStored(supabase, e.path, names[e.path]);
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
        {protocol && replacing && (
          <p className="text-xs text-soft">Replaces the fiche “{replacing.title}”: saved as its new draft version.{replacing.live ? " The published version stays in the app until you publish this one." : ""}</p>
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
              <li key={e.key} className="flex flex-col gap-1 border-t border-line py-2 first:border-t-0">
                <div className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1"><EditableName name={nameOf(e)} onSave={(n) => rename(e, n)} className="text-sm font-medium text-ink"
                    editing={renaming === e.key} onEditing={(on) => setRenaming(on ? e.key : null)} /></div>
                  <button type="button" className="shrink-0 text-xs font-medium text-accentink hover:underline" onClick={() => setRenaming(e.key)}>Rename</button>
                  {e.found ? (
                    <button type="button" className="shrink-0 text-xs font-medium text-accentink hover:underline" onClick={() => setSkipped([...skipped, e.path!])}>Not this one</button>
                  ) : (
                    <>
                      <button type="button" className="shrink-0 text-xs font-medium text-accentink hover:underline" onClick={() => setChanging(changing === e.key ? null : e.key)}>Change source</button>
                      <button type="button" className="shrink-0 text-xs font-medium text-flag hover:underline" onClick={() => remove(e)}>{e.file ? "Remove" : "Delete"}</button>
                    </>
                  )}
                </div>
                {changing === e.key ? (
                  <select autoFocus className={`${inputCls} h-8 text-xs`} value={sourceOf(e) ?? ""} onChange={(ev) => setSource(e.key, ev.target.value || null)}>
                    <option value="">Not used{e.path?.startsWith(`fiches/${fid}/`) ? " (deleted on opening)" : ""}</option>
                    {sources.map((s) => <option key={s.id} value={s.id}>{sourceLabel(s)}</option>)}
                  </select>
                ) : (() => {
                  const s = sources.find((x) => x.id === sourceOf(e));
                  const reason = why[e.key];
                  if (!(e.key in texts) && !s) return <p className="text-xs text-muted">Reading the PDF…</p>;
                  if (!s) return <p className="text-xs text-caution">Not recognised as one of the JSON&apos;s sources: use “Change source” to say which{e.path?.startsWith(`fiches/${fid}/`) ? ", or it is deleted on opening" : ""}.</p>;
                  return (
                    <p className={`text-xs ${reason === "guess" ? "text-caution" : "text-soft"}`}>
                      {reason === "guess" ? "Probably " : "→ "}<b className="font-semibold">{sourceLabel(s)}</b>
                      {reason === "guess" ? ": check it" : reason === "manual" ? " (set by you)" : reason === "linked" ? " (linked before)" : reason === "found" ? ` (already stored, used by no fiche: ${e.path})` : ""}
                    </p>
                  );
                })()}
              </li>
            ))}
          </ul>
        )}
        {protocol && entries.length > 0 && missing.length > 0 && (
          <p className="text-xs text-muted">No PDF yet for: {missing.map(sourceLabel).join(" ; ")}. You can add {missing.length > 1 ? "them" : "it"} later in the editor.</p>
        )}
        {ownUnused.length > 0 && <p className="text-xs text-caution">{ownUnused.length} stored PDF{ownUnused.length > 1 ? "s" : ""} not used: deleted when you open the fiche.</p>}
      </Card>

      {error && <ErrorNote>{error}</ErrorNote>}
      <Button variant="primary" className="h-10 self-end px-5" disabled={!protocol || busy} onClick={() => void open()}>
        {busy ? <Spinner /> : replacing ? "Open the new version ›" : "Open for checking ›"}
      </Button>
    </div>
  );
}
