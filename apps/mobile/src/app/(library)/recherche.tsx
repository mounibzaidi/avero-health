import { useLocalSearchParams } from "expo-router";

import { SearchScreen } from "@/library/Search";

/** Recherche: ?q= a search, ?cat= one specialty, ?all=1 every fiche. */
export default function Search() {
  const { q, cat, all } = useLocalSearchParams<{ q?: string; cat?: string; all?: string }>();
  return <SearchScreen key={`${q ?? ""}|${cat ?? ""}|${all ?? ""}`} />;
}
