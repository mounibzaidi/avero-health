import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "./supabase";

/**
 * The registered products of the national nomenclature (Supabase table "nomenclature", public read), kept on the
 * device: the copy shows at once and offline; it is refreshed when it is a week old.
 */
export type Product = { brand: string; dci: string; form: string; dosage: string; pack: string; hospital: boolean; code: string | null };
type Stored = { products: Product[]; version: string | null; at: string };

const KEY = "avero.medicaments.v1";
const WEEK = 7 * 24 * 3600 * 1000;

async function readCache(): Promise<Stored | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

async function fetchAll(): Promise<Stored> {
  const cached = await readCache();
  if (cached && Date.now() - new Date(cached.at).getTime() < WEEK) return cached;
  const products: Product[] = [];
  let version: string | null = null;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("nomenclature")
      .select("nom_marque,dci_brut,forme,dosage,conditionnement,officine,code,version")
      .eq("statut", "enregistre")
      .order("nom_marque")
      .range(from, from + 999);
    if (error) {
      if (cached) return cached; // offline: the copy on the device
      throw error;
    }
    for (const r of data ?? []) {
      version = r.version;
      products.push({ brand: r.nom_marque, dci: r.dci_brut, form: r.forme ?? "", dosage: r.dosage ?? "", pack: r.conditionnement ?? "", hospital: !r.officine, code: r.code });
    }
    if (!data || data.length < 1000) break;
  }
  const stored = { products, version, at: new Date().toISOString() };
  await AsyncStorage.setItem(KEY, JSON.stringify(stored)).catch(() => {});
  return stored;
}

export function useMedicaments() {
  const q = useQuery({ queryKey: ["medicaments"], queryFn: fetchAll, staleTime: Infinity, networkMode: "always" });
  return { data: q.data, loading: q.isLoading, error: q.error };
}

const fold = (s: string) => s.toUpperCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();

/** Products whose brand, DCI, form, strength or pack holds every word typed (as the old app's search). */
export function searchProducts(products: Product[], query: string): Product[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return products;
  return products.filter((p) => {
    const hay = fold(`${p.brand} ${p.dci} ${p.form} ${p.dosage} ${p.pack}`);
    return words.every((w) => hay.includes(w));
  });
}
