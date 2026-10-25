import { breakpoint } from "@avero/ui-tokens";
import { useRouter } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { entries, specialites, useLibrary, type Entry } from "@/lib/library";
import { useFavorites, useRecent } from "@/lib/stored";
import { t } from "@/strings/fr";
import { ArrowRightIcon, BookOpenIcon, CaretRightIcon, MagnifyingGlassIcon, UserIcon } from "@/ui/Icons";
import { SpecialtyIcon } from "@/ui/MedIcons";
import { LogoMark } from "@/ui/Logo";
import { useColors } from "@/ui/theme";
import { Skeleton, SURFACE_STYLE } from "@/ui/ui";

import { specialty, subtitle } from "./ProtocolRow";

/** Home: a title, the search bar, how many protocols and when they were last reviewed, the specialties as
 * cards with a large icon, the fiche read last, then the protocols as a numbered list. */

const LABEL = "text-[11px] font-semibold uppercase text-muted";

export function HomeScreen() {
  const router = useRouter();
  const c = useColors();
  const wide = useWindowDimensions().width >= breakpoint.library;
  const { data, loading, syncing, refetch } = useLibrary();
  const { ids: recentIds } = useRecent();
  const { ids: favoriteIds } = useFavorites();

  const all = entries(data);
  const byId = (id: string) => all.find((e) => e.id === id);
  const resume = recentIds.map(byId).find((e): e is Entry => !!e);
  const specialties = specialites(all);
  // favourites first, then the others in the library's order
  const protocols = [...new Set([...favoriteIds.map(byId), ...all])].filter((e): e is Entry => !!e).slice(0, 8);
  const reviewed = all.map((e) => e.fiche.meta.last_reviewed_at).filter((d): d is string => !!d).sort().at(-1);
  const open = (e: Entry) => router.push(`/fiche/${e.id}`);
  const stats = [
    all.length > 0 && t(all.length === 1 ? "h_protocols_one" : "h_protocols_other", { n: all.length }),
    reviewed && t("h_reviewed", { date: new Date(reviewed).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) }),
  ].filter(Boolean).join(" · ");

  return (
    <ScrollView className="flex-1 bg-bg" refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => refetch()} />}>
      <View className={`mx-auto w-full ${wide ? "max-w-[720px] px-8 pb-20 pt-16" : "max-w-[560px] px-5 pb-12 pt-3"}`}>
        {!wide && (
          <View className="flex-row items-center justify-between">
            <View accessibilityRole="header" accessibilityLabel="Avero" className="flex-row items-center gap-[7px]">
              <LogoMark size={15} />
              <Text className="text-[16px] font-extrabold uppercase text-accent" style={{ letterSpacing: 2.2 }}>Avero</Text>
            </View>
            <Pressable accessibilityRole="link" accessibilityLabel={t("account")} onPress={() => router.navigate("/profil")} hitSlop={8} className="h-10 w-10 items-center justify-center active:opacity-60">
              <UserIcon size={20} color={c.soft} />
            </Pressable>
          </View>
        )}

        <View className={`items-center ${wide ? "gap-[28px]" : "gap-[22px] pt-12"}`}>
          <View className="items-center gap-3">
            <Text accessibilityRole="header" className={`text-center font-bold text-ink ${wide ? "text-[44px] leading-[50px]" : "text-[32px] leading-[38px]"}`} style={{ letterSpacing: wide ? -1.4 : -1 }}>
              {t("h_title")}
            </Text>
            <Text className={`text-center text-soft ${wide ? "text-[17px]" : "text-[15px]"}`}>{t("h_lead")}</Text>
          </View>

          <Pressable accessibilityRole="search" onPress={() => router.navigate("/recherche")} style={SURFACE_STYLE}
            className={`w-full flex-row items-center gap-3 rounded-full border border-edge/[0.08] bg-surface px-5 hover:border-accent/30 active:opacity-80 ${wide ? "h-[52px] max-w-[560px]" : "h-[50px]"}`}>
            <MagnifyingGlassIcon size={18} color={c.muted} />
            <Text className="min-w-0 flex-1 text-[15px] text-muted" numberOfLines={1}>{t("h_search")}</Text>
          </Pressable>

          {data?.offline ? <Text className="text-center text-[12px] text-caution">{t("fiches_offline")}</Text>
            : stats ? <Text className={`text-center ${LABEL}`} style={{ letterSpacing: 0.8 }}>{stats}</Text> : null}
        </View>

        {specialties.length > 0 && (
          <View className={wide ? "mt-14" : "mt-10"}>
            <Text className={`pb-3 ${LABEL}`} style={{ letterSpacing: 0.8 }}>{t("h_specialties")}</Text>
            <View className={`flex-row flex-wrap ${wide ? "gap-4" : "gap-3"}`}>
              {specialties.map((s) => {
                const n = all.filter((e) => e.fiche.meta.specialite === s).length;
                return (
                  <Pressable key={s} accessibilityRole="link" onPress={() => router.navigate(`/recherche?cat=${encodeURIComponent(s)}`)} style={SURFACE_STYLE}
                    className={`flex-1 justify-between rounded-[22px] border border-line bg-surface p-[18px] hover:border-accent/30 active:opacity-80 ${wide ? "h-[168px] min-w-[30%]" : "h-[160px] min-w-[45%]"}`}>
                    <View className="h-[56px] w-[56px] items-center justify-center rounded-[18px] bg-tint">
                      <SpecialtyIcon name={s} size={32} color={c.accent} />
                    </View>
                    <View className="gap-[2px]">
                      <Text className="text-[16px] font-semibold leading-[20px] text-ink" numberOfLines={2}>{specialty(s)}</Text>
                      <Text className="text-[13px] text-muted">{t(n === 1 ? "h_protocols_one" : "h_protocols_other", { n })}</Text>
                    </View>
                  </Pressable>
                );
              })}
              <Pressable accessibilityRole="link" onPress={() => router.navigate("/recherche?all=1")}
                className={`flex-1 justify-between rounded-[22px] bg-accent p-[18px] hover:opacity-95 active:opacity-85 ${wide ? "h-[168px] min-w-[30%]" : "h-[160px] min-w-[45%]"}`}>
                <View className="h-[56px] w-[56px] items-center justify-center rounded-[18px] bg-onaccent/15">
                  <BookOpenIcon size={30} color={c.onaccent} />
                </View>
                <View className="flex-row items-end justify-between gap-2">
                  <View className="min-w-0 flex-1 gap-[2px]">
                    <Text className="text-[16px] font-semibold leading-[20px] text-onaccent" numberOfLines={2}>{t("h_library")}</Text>
                    <Text className="text-[13px] text-onaccent/75">{t(all.length === 1 ? "h_protocols_one" : "h_protocols_other", { n: all.length })}</Text>
                  </View>
                  <ArrowRightIcon size={18} color={c.onaccent} />
                </View>
              </Pressable>
            </View>
          </View>
        )}

        {resume && (
          <Pressable accessibilityRole="link" onPress={() => open(resume)}
            style={SURFACE_STYLE} className="mt-10 flex-row items-center gap-4 rounded-[18px] border border-line bg-surface px-4 py-[14px] hover:border-accent/30 active:opacity-80">
            <View className="min-w-0 flex-1 gap-1">
              <Text className={LABEL} style={{ letterSpacing: 0.8 }}>{t("h_resume")}</Text>
              <Text className="text-[15px] font-medium leading-[20px] text-ink" numberOfLines={2}>{resume.fiche.meta.title}</Text>
            </View>
            <ArrowRightIcon size={16} color={c.ink} />
          </Pressable>
        )}

        <View className="mt-10">
          {loading ? (
            <View className="gap-3">
              <Skeleton className="h-[12px] w-[30%]" />
              <Skeleton className="h-[160px] w-full rounded-[16px]" />
            </View>
          ) : all.length === 0 ? (
            <View className="items-center gap-1">
              <Text className="text-[14px] font-medium text-ink">{t("no_fiches")}</Text>
              <Text className="text-center text-[13px] leading-[19px] text-soft">{t("no_fiches_hint")}</Text>
            </View>
          ) : (
            <View>
              <View className="flex-row items-baseline justify-between pb-3">
                <Text className={LABEL} style={{ letterSpacing: 0.8 }}>{t("h_protocols")}</Text>
                {all.length > protocols.length ? (
                  <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.navigate("/recherche?all=1")} className="active:opacity-60">
                    <Text className="text-[13px] font-medium text-accent">{t("h_see_all")}</Text>
                  </Pressable>
                ) : null}
              </View>
              <View className="overflow-hidden rounded-[18px] border border-line bg-surface" style={SURFACE_STYLE}>
                {protocols.map((e, i) => (
                  <Pressable key={e.id} accessibilityRole="link" onPress={() => open(e)}
                    className={`flex-row items-center gap-4 px-4 py-4 hover:bg-panel/60 active:bg-panel ${i ? "border-t border-line" : ""}`}>
                    <Text className="w-6 text-[12px] font-medium tabular-nums text-muted">{String(i + 1).padStart(2, "0")}</Text>
                    <View className="min-w-0 flex-1 gap-[3px]">
                      <Text className="text-[15px] font-medium leading-[20px] text-ink" numberOfLines={2}>{e.fiche.meta.title}</Text>
                      <Text className="text-[12.5px] text-muted">{subtitle(e)}</Text>
                    </View>
                    <CaretRightIcon size={13} color={c.muted} weight="bold" />
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
