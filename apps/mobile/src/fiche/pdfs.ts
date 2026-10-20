import { useQuery } from "@tanstack/react-query";
import { createContext } from "react";

import { supabase } from "@/lib/supabase";

/** The stored PDF of each of a fiche's sources (source id → path in the "sources" bucket), read online. */
export function usePdfPaths(fiche: string) {
  const q = useQuery({
    queryKey: ["pdfs", fiche],
    queryFn: async () => {
      const { data, error } = await supabase.from("source_pdfs").select("source_id,pdf_path").eq("subject_id", fiche);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r: { source_id: string; pdf_path: string }) => [r.source_id, r.pdf_path])) as Record<string, string>;
    },
    staleTime: 5 * 60 * 1000,
  });
  return q.data ?? {};
}

/** A link to read a stored PDF for an hour. */
export async function pdfUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("sources").createSignedUrl(path, 3600);
  if (error || !data) throw error ?? new Error("PDF indisponible");
  return data.signedUrl;
}

/** The open fiche and which of its sources have a PDF, for the citation sheet's "Voir dans le PDF". */
export const PdfCtx = createContext<{ fiche: string; paths: Record<string, string> }>({ fiche: "", paths: {} });
