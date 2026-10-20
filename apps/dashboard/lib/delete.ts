import type { SupabaseClient } from "@supabase/supabase-js";

import { api } from "@/lib/api";

/**
 * A fiche deleted from the dashboard: the whole fiche (its subject, so every version, its block checks and its PDF
 * links, and the PDFs stored with it, fiches/<id>/), or only its drafts (the unpublished versions, the published one
 * stays live). Asks first; true once deleted.
 */
export async function deleteFiche(supabase: SupabaseClient, id: string, title: string, what: "fiche" | "drafts", live: boolean): Promise<boolean> {
  const own = what === "fiche" ? ((await supabase.storage.from("sources").list(`fiches/${id}`, { limit: 1000 })).data ?? []) : [];
  const pdfCount = own.filter((x) => x.name.endsWith(".pdf")).length;
  const ask = what === "drafts"
    ? `Delete the draft of "${title}"? The published version stays live.`
    : `Delete "${title}" and all its versions${pdfCount ? `, and the ${pdfCount} PDF${pdfCount === 1 ? "" : "s"} stored with it` : ""}?${live ? "\n\nIt is published: it will disappear from the app." : ""}`;
  if (!window.confirm(ask)) return false;
  const r = what === "drafts"
    ? await supabase.from("fiche_versions").delete().eq("subject_id", id).is("published_at", null).select("version")
    : await supabase.from("subjects").delete().eq("id", id).select("id");
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.length) throw new Error("Nothing was deleted: administrator rights required.");
  if (own.length) {
    const gone = await supabase.storage.from("sources").remove(own.map((x) => `fiches/${id}/${x.name}`));
    if (gone.error) throw new Error(`The fiche is deleted, its PDFs not: ${gone.error.message}`);
  }
  return true;
}

/** A stored source deleted (its PDF and record, or a link-only reference), and unlinked from the fiche sources. */
export async function deleteStored(path: string, title: string): Promise<boolean> {
  if (!window.confirm(`Delete "${title}" from storage? Fiches using it will lose this PDF.`)) return false;
  await api(`/crawl/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  return true;
}

/** A stored PDF renamed: the name kept in its record (<path>.json) beside it; the file itself is not touched. */
export async function renameStored(supabase: SupabaseClient, path: string, name: string): Promise<void> {
  const bucket = supabase.storage.from("sources");
  const rec = await bucket.download(`${path}.json`);
  const record = rec.data ? (JSON.parse(await rec.data.text()) as Record<string, unknown>) : {};
  const up = await bucket.upload(`${path}.json`, new Blob([JSON.stringify({ ...record, title: name })], { type: "application/json" }), { upsert: true });
  if (up.error) throw new Error(`Not renamed: ${up.error.message}`);
}
