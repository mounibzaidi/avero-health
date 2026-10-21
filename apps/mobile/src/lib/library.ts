import AsyncStorage from "@react-native-async-storage/async-storage";
import { allItems, validateStructure, type Protocol } from "@avero/schema";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";

import SYNONYMS from "../../../../shared/search-synonyms.json";
import { supabase } from "./supabase";

/**
 * The published fiches, available offline. The library is small (tens of fiches, tens of KB each), so
 * it is kept in AsyncStorage: the copy on the device shows at once, then each launch and each return to
 * the app compares the published list with it, downloads the new or changed fiches and drops the ones
 * no longer published. Without a network it keeps showing what it has. A fiche that is not a Protocol
 * v1.1 is left out, never shown half.
 *
 * A fiche is matched on its publication (`rev`: version number and publication time), not on the number
 * alone: a fiche deleted and created again starts its numbers over, and its new version 2 is not the old.
 */

export type Library = { fiches: Record<string, { rev: string; content: Protocol }>; syncedAt: string | null; offline: boolean };
type Published = { subject_id: string; version: number; published_at: string };
const rev = (r: Published) => `${r.version}@${r.published_at}`;

const CACHE_KEY = "avero.library.v1.1"; // v1.1: fiches of Protocol Schema v1.1 only
const EMPTY: Library = { fiches: {}, syncedAt: null, offline: false };

async function readCache(): Promise<Library> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return EMPTY;
    const lib = { ...EMPTY, ...(JSON.parse(raw) as Partial<Library>) };
    // read again through the schema: a copy saved by an older build lacks the fields added since (their defaults
    // fill them), and one that no longer reads is dropped and downloaded again
    const fiches: Library["fiches"] = {};
    for (const [id, f] of Object.entries(lib.fiches ?? {})) {
      const { protocol } = validateStructure(f.content);
      // a copy saved before `rev` has none: it matches nothing and is downloaded again
      if (protocol) fiches[id] = { rev: f.rev ?? "", content: protocol };
    }
    return { ...lib, fiches };
  } catch {
    return EMPTY;
  }
}

async function load(): Promise<Library> {
  const cached = await readCache();
  const index = await supabase.from("published_fiches").select("subject_id,version,published_at");
  if (index.error) return { ...cached, offline: true };

  const live = new Map((index.data as Published[]).map((r) => [r.subject_id, rev(r)]));
  // kept: the fiches still published at the same publication; the others are dropped or downloaded again
  const fiches = Object.fromEntries(Object.entries(cached.fiches).filter(([id, f]) => live.get(id) === f.rev));
  const stale = [...live.keys()].filter((id) => !fiches[id]);
  if (stale.length) {
    const fresh = await supabase.from("published_fiches").select("subject_id,version,published_at,content").in("subject_id", stale);
    if (fresh.error) return { ...cached, offline: true };
    for (const r of fresh.data as (Published & { content: unknown })[]) {
      const { protocol } = validateStructure(r.content);
      if (protocol) fiches[r.subject_id] = { rev: rev(r), content: protocol };
    }
  }
  const lib = { fiches, syncedAt: new Date().toISOString(), offline: false };
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ fiches, syncedAt: lib.syncedAt })).catch(() => {});
  return lib;
}

export function useLibrary() {
  const cache = useQuery({ queryKey: ["library-cache"], queryFn: readCache, staleTime: Infinity });
  const live = useQuery({ queryKey: ["library"], queryFn: () => load().catch(async () => ({ ...(await readCache()), offline: true })), staleTime: Infinity, networkMode: "always" });
  const { refetch } = live;
  // a phone keeps the app open for days: compare again each time it comes back to the front (on the web, the tab)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => s === "active" && refetch({ cancelRefetch: false }));
    return () => sub.remove();
  }, [refetch]);
  return { data: live.data ?? cache.data, loading: !live.data && !cache.data, syncing: live.isFetching, refetch: live.refetch };
}

export type Entry = { id: string; fiche: Protocol };
export const entries = (lib: Library | undefined): Entry[] =>
  Object.entries(lib?.fiches ?? {})
    .map(([id, f]) => ({ id, fiche: f.content }))
    .sort((a, b) => a.fiche.meta.title.localeCompare(b.fiche.meta.title, "fr"));

/** Specialties that hold a fiche, alphabetical. */
export const specialites = (all: Entry[]) => [...new Set(all.map((e) => e.fiche.meta.specialite))].sort((a, b) => a.localeCompare(b, "fr"));

// ─── Search: accents, synonyms and acronyms, typos (ported from the old lib/fiches.ts) ───────

const fold = (s: string) => s.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFKD").replace(/\p{M}/gu, "").replace(/\*\*/g, "");
const tokens = (s: string) => fold(s).split(/[^a-z0-9]+/).filter(Boolean);
/** shared/search-synonyms.json: groups of terms that mean the same thing (AVC, accident vasculaire cérébral, stroke). */
const GROUPS = (SYNONYMS.groups as string[][]).map((g) => g.map((term) => tokens(term)));

/** Edit distance (insert, delete, replace, swap of neighbours), or more than `max` as soon as it is certain. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      row.push(d);
    }
    if (Math.min(...row) > max) return max + 1;
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

/** 2 when the typed word begins the token, 1 within a typo (one from 4 letters, two from 8), 0 otherwise. */
function wordScore(word: string, token: string): number {
  if (token.startsWith(word)) return 2;
  const max = word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0;
  if (!max) return 0;
  return distance(word, token, max) <= max || (token.length > word.length && distance(word, token.slice(0, word.length), max) <= max) ? 1 : 0;
}

/** 0 when a word of the query matches nothing; higher for the title's own words than for synonyms, and for beginnings than for typos. */
function titleScore(title: string, words: string[], given: string[]): number {
  const own = tokens(title);
  const text = ` ${own.join(" ")} `;
  const synonyms = [...GROUPS.filter((g) => g.some((term) => text.includes(` ${term.join(" ")} `))).flat(2), ...given.flatMap(tokens)];
  let total = 0;
  for (const w of words) {
    const best = Math.max(0, ...own.map((tk) => wordScore(w, tk) * 2), ...synonyms.map((tk) => wordScore(w, tk)));
    if (!best) return 0;
    total += best;
  }
  return total;
}

/** Fiches whose title matches (words, synonyms, acronyms, typos), best first. Filters as one types. */
export function searchFiches(all: Entry[], query: string): Entry[] {
  const typed = tokens(query);
  if (!typed.length) return [];
  return all
    .map((e) => ({ e, score: titleScore(e.fiche.meta.title, typed, e.fiche.meta.motifs) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.e.fiche.meta.title.localeCompare(b.e.fiche.meta.title, "fr"))
    .map((x) => x.e);
}

export type LineHit = { entry: Entry; line: { id: string; text: string } };

/** Lines whose text (with its fiche title) holds every word of the query, at least one in the line itself. */
export function searchLines(all: Entry[], query: string, limit = 8): LineHit[] {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  const hits: LineHit[] = [];
  for (const entry of all) {
    const title = fold(entry.fiche.meta.title);
    const lines = [...allItems(entry.fiche), ...entry.fiche.treat.medications.map((m) => ({ id: m.id, text: m.inn }))];
    for (const line of lines) {
      const text = fold(line.text);
      if (words.every((w) => `${title} ${text}`.includes(w)) && words.some((w) => text.includes(w))) {
        hits.push({ entry, line });
        if (hits.length >= limit) return hits;
      }
    }
  }
  return hits;
}
