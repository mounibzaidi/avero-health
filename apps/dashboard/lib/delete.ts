import type { SupabaseClient } from "@supabase/supabase-js";

import { api } from "@/lib/api";

/**
 * A fiche deleted from the dashboard: the whole fiche (its subject, so every version and its block checks), or only
 * its drafts (the unpublished versions, the published one stays live). Asks first; true once deleted.
 */
export async function deleteFiche(supabase: SupabaseClient, id: string, title: string, what: "fiche" | "drafts", live: boolean): Promise<boolean> {
  const ask = what === "drafts"
    ? `Delete the draft of "${title}"? The published version stays live.`
    : `Delete "${title}" and all its versions?${live ? "\n\nIt is published: it will disappear from the app." : ""}`;
  if (!window.confirm(ask)) return false;
  const r = what === "drafts"
    ? await supabase.from("fiche_versions").delete().eq("subject_id", id).is("published_at", null).select("version")
    : await supabase.from("subjects").delete().eq("id", id).select("id");
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.length) throw new Error("Nothing was deleted: administrator rights required.");
  return true;
}

/** A stored source deleted (its PDF and record, or a link-only reference), and unlinked from the fiche sources. */
export async function deleteStored(path: string, title: string): Promise<boolean> {
  if (!window.confirm(`Delete "${title}" from storage? Fiches using it will lose this PDF.`)) return false;
  await api(`/crawl/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
  return true;
}
