import { useLocalSearchParams } from "expo-router";

import { HomeScreen } from "@/library/Home";
import { SearchScreen } from "@/library/Search";

/** Home; ?q= (from the fiche sidebar search) opens a search. */
export default function Home() {
  const { q } = useLocalSearchParams<{ q?: string }>();
  return q ? <SearchScreen key={q} /> : <HomeScreen />;
}
