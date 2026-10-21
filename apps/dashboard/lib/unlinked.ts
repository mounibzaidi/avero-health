import type { SupabaseClient } from "@supabase/supabase-js";

import { words } from "./pdfMatch";

/**
 * The PDFs in storage that no fiche's source uses: left behind when a fiche changed id, or stored from a Collecte
 * topic and never linked. The import offers them again for a source that has no PDF, so nothing is uploaded twice.
 */
export async function unlinkedPdfs(supabase: SupabaseClient): Promise<{ path: string; title: string }[]> {
  const bucket = supabase.storage.from("sources");
  const files: string[] = [];
  // folders are entries without an id: <topic>/ and fiches/<fiche id>/, two levels at most
  const walk = async (prefix: string, depth: number) => {
    const { data } = await bucket.list(prefix, { limit: 1000 });
    for (const o of data ?? []) {
      const path = prefix ? `${prefix}/${o.name}` : o.name;
      if (o.id === null) {
        if (depth < 2) await walk(path, depth + 1);
      } else if (o.name.toLowerCase().endsWith(".pdf")) files.push(path);
    }
  };
  await walk("", 0);
  const { data } = await supabase.from("source_pdfs").select("pdf_path");
  const used = new Set((data ?? []).map((r: { pdf_path: string }) => r.pdf_path));
  // stored as "<12 hex>-<file name>"
  return files.filter((p) => !used.has(p)).map((path) => ({ path, title: path.split("/").pop()!.replace(/^[0-9a-f]{12}-/, "") }));
}

/** Words every guideline title has: they say nothing of which one a file is. */
const COMMON = new Set(["management", "guideline", "patients", "evaluation", "recommendations", "recommandations", "prise", "charge", "pratique", "practice"]);

/** Worth reading (its first pages) as a source's PDF: its file name shares a telling word of five letters or more with it. */
export function mayBe(fileTitle: string, source: { title: string; citation: string; organisation: string }): boolean {
  const want = words(`${source.title} ${source.citation} ${source.organisation}`);
  for (const w of words(fileTitle.replace(/[_.]/g, " "))) if (w.length >= 5 && !COMMON.has(w) && want.has(w)) return true;
  return false;
}
