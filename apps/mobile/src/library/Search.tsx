import { breakpoint } from "@avero/ui-tokens";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { entries, searchFiches, searchLines, useLibrary, type Entry } from "@/lib/library";
import { useRecent } from "@/lib/stored";
import { t } from "@/strings/fr";
import { SearchField } from "@/ui/SearchField";
import { Body, joinMeta, Muted, Skeleton, SURFACE_STYLE } from "@/ui/ui";

import { CARD, ProtocolRow } from "./ProtocolRow";

/** A group label above a card: 13 px medium, secondary grey, indented 4 px. */
const GroupLabel = ({ children }: { children: ReactNode }) => <Text className="ps-1 text-[13px] font-medium text-soft">{children}</Text>;

function Loading() {
  return (
    <View className={CARD}>
      {[0, 1, 2].map((i) => (
        <View key={i} className={`flex-row items-center gap-3 p-[14px] ${i ? "border-t border-line" : ""}`}>
          <Skeleton className="h-8 w-8 rounded-[9px]" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-[12px] w-[55%]" />
            <Skeleton className="h-[10px] w-[30%]" />
          </View>
        </View>
      ))}
    </View>
  );
}

function Results({ all, query, wide }: { all: Entry[]; query: string; wide: boolean }) {
  const router = useRouter();
  const fiches = useMemo(() => searchFiches(all, query), [all, query]);
  const lines = useMemo(() => searchLines(all, query), [all, query]);
  if (!fiches.length && !lines.length)
    return (
      <View className="gap-1 px-1 py-2">
        <Body className="text-[15px] font-medium">{t("no_results")}</Body>
        <Muted className="text-[13px]">{t("no_results_hint")}</Muted>
      </View>
    );
  return (
    <View className={wide ? "flex-row items-start gap-5" : "gap-[22px]"}>
      {fiches.length > 0 && (
        <View className={`gap-2 ${wide ? "flex-1" : ""}`}>
          <GroupLabel>{t("guidelines_n", { n: fiches.length })}</GroupLabel>
          <View className={CARD} style={SURFACE_STYLE}>
            {fiches.map((e, i) => (
              <ProtocolRow key={e.id} entry={e} first={i === 0} onPress={() => router.push(`/fiche/${e.id}`)} />
            ))}
          </View>
        </View>
      )}
      {lines.length > 0 && (
        <View className={`gap-2 ${wide ? "flex-1" : ""}`}>
          <GroupLabel>{t("jump_to")}</GroupLabel>
          <View className={CARD} style={SURFACE_STYLE}>
            {lines.map((h, i) => (
              <Pressable key={`${h.entry.id}-${h.line.id}`} accessibilityRole="link" onPress={() => router.push(`/fiche/${h.entry.id}`)}
                className={`gap-[6px] px-[14px] py-[13px] hover:bg-bg/70 active:bg-bg ${i ? "border-t border-line" : ""}`}>
                <Muted className="text-[12px]" numberOfLines={1}>{joinMeta([h.entry.fiche.meta.title])}</Muted>
                <Body className="text-[14px] leading-[20px]" numberOfLines={3}>{h.line.text}</Body>
              </Pressable>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

/** Recherche: the search field, focused on open. Results filter as one types; an empty field shows one
 * specialty (?cat=), every fiche (?all=1), or the fiches opened recently. */
export function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string; cat?: string; all?: string }>();
  const wide = useWindowDimensions().width >= breakpoint.library;
  const { data, loading, syncing, refetch } = useLibrary();
  const { ids: recentIds } = useRecent();
  const [query, setQuery] = useState(params.q ?? "");
  const all = entries(data);
  const recent = recentIds.map((id) => all.find((e) => e.id === id)).filter((e): e is Entry => !!e);
  const cat = params.cat ? all.filter((e) => e.fiche.meta.specialite === params.cat) : null;
  const list = cat ?? (params.all || !recent.length ? all : recent);
  const label = cat ? `${params.cat} · ${cat.length}` : params.all || !recent.length ? t("all_protocols_n", { n: all.length }) : t("recent_short");

  return (
    <ScrollView className="flex-1" keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => refetch()} />}>
      <View className="mx-auto w-full max-w-[760px] gap-[22px] px-5 pb-10 pt-2">
        <View className="gap-2">
          <SearchField value={query} onChange={setQuery} autoFocus={!params.cat && !params.all} />
          {data?.offline ? <Muted className="ps-1 text-[13px] text-caution">{t("fiches_offline")}</Muted> : null}
        </View>
        {query.trim() ? (
          <Results all={all} query={query} wide={wide} />
        ) : loading ? (
          <Loading />
        ) : all.length === 0 ? (
          <View className="gap-1 px-1 py-2">
            <Body className="text-[15px] font-medium">{t("no_fiches")}</Body>
            <Muted className="text-[13px] leading-[19px]">{t("no_fiches_hint")}</Muted>
          </View>
        ) : (
          <View className="gap-2">
            <GroupLabel>{label}</GroupLabel>
            <View className={CARD} style={SURFACE_STYLE}>
              {list.map((e, i) => (
                <ProtocolRow key={e.id} entry={e} first={i === 0} onPress={() => router.push(`/fiche/${e.id}`)} />
              ))}
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
