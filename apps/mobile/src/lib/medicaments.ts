import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";

import { supabase } from "./supabase";

/**
 * The registered products of the national nomenclature (Supabase table "nomenclature", public read), kept on the
 * device: the copy shows at once and offline; it is refreshed when it is a week old. Everything shown comes from
 * the register as it is: nothing is added or guessed.
 */
export type Liste = "LISTE I" | "LISTE II" | "STUPEFIANT";
export type Kind = "RE" | "GE" | "BIO";
export type Product = {
  brand: string; dci: string; form: string; dosage: string; pack: string; hospital: boolean; code: string | null;
  liste: Liste | null; kind: Kind | null; lab: string; country: string; local: boolean | null;
};
type Stored = { products: Product[]; version: string | null; at: string };

const KEY = "avero.medicaments.v2"; // v2: prescription list, generic/reference, manufacturer, made in Algeria
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
      .select("nom_marque,dci_brut,forme,dosage,conditionnement,officine,code,liste,type,laboratoire,pays,fabrique_local,version")
      .eq("statut", "enregistre")
      .order("nom_marque")
      .range(from, from + 999);
    if (error) {
      if (cached) return cached; // offline: the copy on the device
      throw error;
    }
    for (const r of data ?? []) {
      version = r.version;
      products.push({
        brand: r.nom_marque, dci: r.dci_brut, form: r.forme ?? "", dosage: r.dosage ?? "", pack: r.conditionnement ?? "", hospital: !r.officine, code: r.code,
        liste: r.liste ?? null, kind: r.type ?? null, lab: r.laboratoire ?? "", country: r.pays ?? "", local: r.fabrique_local ?? null,
      });
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

export const fold = (s: string) => s.toUpperCase().normalize("NFKD").replace(/\p{M}/gu, "").replace(/\s+/g, " ").trim();

// ─── Products grouped by active substance, as drug references list them (DCI first, brands under it) ─────────

/** The active substance of one component, as the register itself names it: "AMLODIPINE BESILATE (AMLODIPINE)",
 * "AMLODIPINE BESILATE EXPRIME EN AMLODIPINE" and "AMLODIPINE SOUS FORME BESYLATE" are all AMLODIPINE. A salt in
 * brackets ("(SOUS FORME TRIHYDRATEE)") is not a substance. Any other spelling is kept as written. */
function component(raw: string): string {
  const p = fold(raw.replace(/\*/g, "")).replace(/\s*\(SOUS FORME\b[^()]*\)\s*$/, "");
  const paren = /\(([^()]+)\)\s*$/.exec(p);
  if (paren && !/\d/.test(paren[1])) return paren[1].trim();
  const expressed = /\bEXPE?RIM\w*\s+EN\s+(.+)$/.exec(p); // the register also writes "EXPERIME"
  if (expressed) return expressed[1].trim();
  const salt = /^(.+?)\s+SOUS FORME\b/.exec(p);
  return salt ? salt[1].trim() : p;
}

/** The substance a product belongs to: its components joined by " / " (a combination is its own substance). */
export const substanceKey = (dci: string) => dci.split("/").map((x) => x.trim()).filter(Boolean).map(component).join(" / ");

/** Salt and hydrate words the register writes after a substance ("METFORMINE CHLORHYDRATE", "ENOXAPARINE SODIQUE"). */
const SALT = /^(CHLORHYDRATE|HYDROCHLORIDE|DICHLORHYDRATE|SODIQUE|CALCIQUE|POTASSIQUE|MAGNESIQUE|SULFATE|EMBONATE|BESILATE|BESYLATE|MALEATE|TARTRATE|FUMARATE|MESILATE|MESYLATE|ACETATE|CITRATE|PHOSPHATE|SUCCINATE|BROMHYDRATE|(MONO|DI|TRI|SESQUI|HEPTA)?HYDRATEE?)( |$)/;

/**
 * The registered products of a fiche's INN: the same substance, alone (not in a combination), written as is or with a
 * salt ("metformine" = METFORMINE CHLORHYDRATE). A word in brackets is tried as the name too ("trinitrine
 * (nitroglycérine)"). Nothing looser: "insuline humaine" must not bring the rapid and isophane insulins.
 */
export function productsForInn(products: Product[], inn: string): Product[] {
  const names = [inn.replace(/\([^()]*\)/g, " "), ...[...inn.matchAll(/\(([^()]+)\)/g)].map((m) => m[1])].map(fold).filter(Boolean);
  const same = (key: string) => names.some((n) => key === n || (key.startsWith(`${n} `) && SALT.test(key.slice(n.length + 1))));
  return products.filter((p) => !p.dci.includes("/") && same(substanceKey(p.dci)));
}

export type Substance = { key: string; products: Product[]; liste: Liste | null; hospitalOnly: boolean };

const LISTE_RANK: Record<Liste, number> = { STUPEFIANT: 3, "LISTE I": 2, "LISTE II": 1 };

/** Every substance of the register, alphabetical, each with its products by brand and its strictest prescription
 * list (the products of one substance may differ). */
export function groupSubstances(products: Product[]): Substance[] {
  const by = new Map<string, Product[]>();
  for (const p of products) {
    const k = substanceKey(p.dci);
    by.set(k, [...(by.get(k) ?? []), p]);
  }
  return [...by].map(([key, list]) => ({
    key,
    products: list.sort((a, b) => a.brand.localeCompare(b.brand, "fr") || a.dosage.localeCompare(b.dosage, "fr", { numeric: true })),
    liste: list.reduce<Liste | null>((m, p) => (p.liste && (!m || LISTE_RANK[p.liste] > LISTE_RANK[m]) ? p.liste : m), null),
    hospitalOnly: list.every((p) => p.hospital),
  })).sort((a, b) => a.key.localeCompare(b.key, "fr"));
}

/** Substances matching every word typed, in their name, their register spellings or a brand; with the brands that
 * matched when the substance's own name did not (so a brand search shows why its DCI came up). */
export function searchSubstances(all: Substance[], query: string): { s: Substance; brands: string[] }[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return all.map((s) => ({ s, brands: [] }));
  const out: { s: Substance; brands: string[] }[] = [];
  for (const s of all) {
    const name = fold(s.key);
    if (words.every((w) => name.includes(w))) {
      out.push({ s, brands: [] });
      continue;
    }
    const brands = [...new Set(s.products.filter((p) => words.every((w) => fold(`${p.brand} ${p.dci} ${p.form} ${p.dosage}`).includes(w))).map((p) => p.brand))];
    if (brands.length) out.push({ s, brands });
  }
  return out;
}

/** "Amlodipine", "Amoxicilline / acide clavulanique": the register writes substances in capitals. */
export const substanceName = (key: string) => key.toLowerCase().replace(/^./, (c) => c.toUpperCase());
