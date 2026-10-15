import { useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";

import { searchProducts, useMedicaments, type Product } from "@/lib/medicaments";
import { t } from "@/strings/fr";
import { SearchField } from "@/ui/SearchField";
import { Body, Heading, joinMeta, Muted, Skeleton, SURFACE_STYLE } from "@/ui/ui";

import brandsMeta from "../../../../content/shared/dz_brands.meta.json";

/** One product: the brand name, its DCI as the list writes it, then form, strength and pack. A product not sold
 * in officine says "(usage hospitalier)". */
function ProductRow({ p }: { p: Product }) {
  return (
    <View className="gap-[2px] rounded-xl border border-edge/[0.06] bg-surface px-4 py-3" style={SURFACE_STYLE}>
      <Body className="text-[15px] font-semibold leading-[20px]">
        {p.brand}
        {p.hospital ? <Text className="text-[13px] font-normal text-muted">{` (${t("dz_hospital")})`}</Text> : null}
      </Body>
      <Body className="text-[13px] leading-[18px] text-soft">{p.dci}</Body>
      <Muted className="text-[12px] leading-[17px]">{joinMeta([p.form, p.dosage, p.pack])}</Muted>
    </View>
  );
}

/** Médicaments: every registered product of the national nomenclature, filtered as the doctor types. */
export function MedicamentsScreen() {
  const { data, loading } = useMedicaments();
  const [query, setQuery] = useState("");
  const all = useMemo(() => data?.products ?? [], [data]);
  const found = useMemo(() => searchProducts(all, query), [all, query]);
  const count = found.length === all.length ? t("meds_count", { n: found.length }) : t("meds_count_of", { n: found.length, total: all.length });
  return (
    <FlatList
      className="flex-1"
      contentContainerClassName="mx-auto w-full max-w-[760px] gap-2 px-5 pb-10 pt-5"
      data={found}
      keyExtractor={(p, i) => `${p.code}|${p.brand}|${p.dosage}|${i}`}
      renderItem={({ item }) => <ProductRow p={item} />}
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
      ListFooterComponent={<Muted className="px-1 pt-3 text-[12px] leading-[17px]">{t("dz_source", { source: brandsMeta.source })}</Muted>}
    />
  );
}
