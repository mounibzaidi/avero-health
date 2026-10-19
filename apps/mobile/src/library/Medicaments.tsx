import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";

import { groupSubstances, searchSubstances, substanceName, useMedicaments, type Liste, type Substance } from "@/lib/medicaments";
import { t } from "@/strings/fr";
import { CaretRightIcon } from "@/ui/Icons";
import { SearchField } from "@/ui/SearchField";
import { useColors } from "@/ui/theme";
import { Body, Heading, joinMeta, Muted, Skeleton, SURFACE_STYLE } from "@/ui/ui";

const STRENGTHS_SHOWN = 4;

export const LISTE_LABEL: Record<Liste, string> = { "LISTE I": t("liste_1"), "LISTE II": t("liste_2"), STUPEFIANT: t("liste_stup") };

/** The prescription list as a small tag: stupéfiant in red, Liste I and II neutral. */
export function ListeTag({ liste }: { liste: Liste }) {
  const stup = liste === "STUPEFIANT";
  return (
    <View className={`rounded-full px-2 py-[2px] ${stup ? "bg-flagbg" : "bg-panel"}`}>
      <Text className={`text-[11px] font-semibold ${stup ? "text-flag" : "text-soft"}`}>{LISTE_LABEL[liste]}</Text>
    </View>
  );
}

/** One substance: its DCI, the number of brands and the strengths registered, the brands that matched a search. */
function SubstanceRow({ s, brands, onPress }: { s: Substance; brands: string[]; onPress: () => void }) {
  const c = useColors();
  const count = new Set(s.products.map((p) => p.brand)).size;
  const strengths = [...new Set(s.products.map((p) => p.dosage).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const shown = strengths.slice(0, STRENGTHS_SHOWN).join(", ") + (strengths.length > STRENGTHS_SHOWN ? "…" : "");
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={SURFACE_STYLE}
      className="flex-row items-center gap-3 rounded-xl border border-edge/[0.06] bg-surface px-4 py-3 active:opacity-70">
      <View className="min-w-0 flex-1 gap-[3px]">
        <View className="flex-row flex-wrap items-center gap-2">
          <Body className="text-[15px] font-semibold leading-[20px]">{substanceName(s.key)}</Body>
          {s.liste ? <ListeTag liste={s.liste} /> : null}
          {s.hospitalOnly ? <Text className="text-[12px] text-caution">{t("meds_hospital_only")}</Text> : null}
        </View>
        <Muted className="text-[12.5px] leading-[17px]">{joinMeta([count === 1 ? t("meds_brand_one") : t("meds_brands", { n: count }), shown])}</Muted>
        {brands.length ? <Body className="text-[12.5px] leading-[17px] text-soft">{t("meds_via", { b: brands.slice(0, 3).join(", ") })}</Body> : null}
      </View>
      <CaretRightIcon size={16} color={c.muted} />
    </Pressable>
  );
}

/** Médicaments: the national nomenclature by DCI, as drug references list it; a brand search leads to its DCI. */
export function MedicamentsScreen() {
  const router = useRouter();
  const { data, loading } = useMedicaments();
  const [query, setQuery] = useState("");
  const all = useMemo(() => groupSubstances(data?.products ?? []), [data]);
  const found = useMemo(() => searchSubstances(all, query), [all, query]);
  const count = found.length === all.length ? t("meds_count", { n: all.length, p: data?.products.length ?? 0 }) : t("meds_count_of", { n: found.length, total: all.length });
  return (
    <FlatList
      className="flex-1"
      contentContainerClassName="mx-auto w-full max-w-[760px] gap-2 px-5 pb-10 pt-5"
      data={found}
      keyExtractor={({ s }) => s.key}
      renderItem={({ item }) => <SubstanceRow s={item.s} brands={item.brands} onPress={() => router.push(`/medicament/${encodeURIComponent(item.s.key)}`)} />}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      initialNumToRender={20}
      ListHeaderComponent={
        <View className="gap-3 pb-2">
          <Heading className="text-[28px] leading-[34px]" style={{ letterSpacing: -0.56 }}>{t("meds_title")}</Heading>
          <SearchField value={query} onChange={setQuery} placeholder={t("meds_search")} />
          {loading ? <Skeleton className="h-4 w-1/3" /> : <Muted className="px-1 text-[13px]">{count}</Muted>}
        </View>
      }
      ListEmptyComponent={loading ? null : <Muted className="px-1 py-2 text-[14px] leading-[20px]">{t("meds_empty")}</Muted>}
      ListFooterComponent={<Muted className="px-1 pt-3 text-[12px] leading-[17px]">{t("dz_source")}</Muted>}
    />
  );
}
