import { breakpoint } from "@avero/ui-tokens";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { entries, specialites, useLibrary, type Entry } from "@/lib/library";
import { useFavorites, useRecent } from "@/lib/stored";
import { t } from "@/strings/fr";
import { ArrowRightIcon, MagnifyingGlassIcon, UserIcon } from "@/ui/Icons";
import { SpecialtyIcon } from "@/ui/MedIcons";
import { LogoMark } from "@/ui/Logo";
import { useColors } from "@/ui/theme";
import { Skeleton, SURFACE_STYLE } from "@/ui/ui";

import { specialty, subtitle } from "./ProtocolRow";

/** Home, laid out like a contents page: the count and review date over a large title, the search, the fiche read
 * last, then the specialties and the protocols as indexes on thin rules (large icon or number, name, count). */

const LABEL = "text-[11px] font-semibold uppercase text-muted";

/** A section heading over a dark rule, with an optional link on the right. */
function Section({ title, link, onPress, children }: { title: string; link?: string; onPress?: () => void; children: ReactNode }) {
  return (
    <View>
      <View className="flex-row items-baseline justify-between border-b border-ink pb-3">
        <Text className="text-[13px] font-semibold uppercase text-ink" style={{ letterSpacing: 1.2 }}>{title}</Text>
        {link ? (
          <Pressable accessibilityRole="link" hitSlop={10} onPress={onPress} className="active:opacity-60">
            <Text className="text-[13px] font-medium text-accent">{link}</Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

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
  // two columns of index rows on a wide screen
  const col = wide ? "w-[47%]" : "w-full";

  return (
    <ScrollView className="flex-1" refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => refetch()} />}>
      <View className={`mx-auto w-full ${wide ? "max-w-[1000px] gap-[64px] px-10 pb-20 pt-16" : "max-w-[560px] gap-[44px] px-5 pb-12 pt-3"}`}>
        <View className="gap-[22px]">
          {!wide && (
            <View className="flex-row items-center justify-between">
              <View accessibilityRole="header" accessibilityLabel="Avero" className="flex-row items-center gap-[7px]">
                <LogoMark size={15} />
                <Text className="text-[16px] font-extrabold uppercase text-accent" style={{ letterSpacing: 2.2 }}>Avero</Text>
              </View>
              <Pressable accessibilityRole="link" accessibilityLabel={t("account")} onPress={() => router.navigate("/profil")} hitSlop={8} className="h-10 w-10 items-end justify-center active:opacity-60">
                <UserIcon size={20} color={c.soft} />
              </Pressable>
            </View>
          )}

          <View className={`gap-3 ${wide ? "max-w-[720px]" : "pt-8"}`}>
            {data?.offline ? <Text className="text-[12px] text-caution">{t("fiches_offline")}</Text>
              : stats ? <Text className={LABEL} style={{ letterSpacing: 1 }}>{stats}</Text> : null}
            <Text accessibilityRole="header" className={`font-bold text-ink ${wide ? "text-[64px] leading-[66px]" : "text-[44px] leading-[46px]"}`} style={{ letterSpacing: wide ? -2.4 : -1.6 }}>
              {t("h_title")}
            </Text>
            <Text className={`text-soft ${wide ? "text-[19px] leading-[28px]" : "text-[16px] leading-[24px]"}`}>{t("h_lead")}</Text>
          </View>

          <Pressable accessibilityRole="search" onPress={() => router.navigate("/recherche")} style={SURFACE_STYLE}
            className={`flex-row items-center gap-3 rounded-full border border-edge/[0.08] bg-surface px-5 hover:border-accent/30 active:opacity-80 ${wide ? "h-[54px] max-w-[560px]" : "h-[50px]"}`}>
            <MagnifyingGlassIcon size={18} color={c.muted} />
            <Text className="min-w-0 flex-1 text-[15px] text-muted" numberOfLines={1}>{t("h_search")}</Text>
          </Pressable>
        </View>

        {resume && (
          <Pressable accessibilityRole="link" onPress={() => open(resume)} className="flex-row items-center gap-4 border-l-2 border-accent py-1 ps-4 active:opacity-60">
            <View className="min-w-0 flex-1 gap-1">
              <Text className={LABEL} style={{ letterSpacing: 1 }}>{t("h_resume")}</Text>
              <Text className="text-[17px] font-semibold leading-[22px] text-ink" numberOfLines={2}>{resume.fiche.meta.title}</Text>
            </View>
            <ArrowRightIcon size={18} color={c.accent} />
          </Pressable>
        )}

        {loading ? (
          <View className="gap-3">
            <Skeleton className="h-[12px] w-[30%]" />
            <Skeleton className="h-[200px] w-full" />
          </View>
        ) : all.length === 0 ? (
          <View className="gap-1">
            <Text className="text-[14px] font-medium text-ink">{t("no_fiches")}</Text>
            <Text className="text-[13px] leading-[19px] text-soft">{t("no_fiches_hint")}</Text>
          </View>
        ) : (
          <>
            <Section title={t("h_specialties")} link={t("h_see_all")} onPress={() => router.navigate("/recherche?all=1")}>
              <View className="flex-row flex-wrap justify-between">
                {specialties.map((s) => {
                  const n = all.filter((e) => e.fiche.meta.specialite === s).length;
                  return (
                    <Pressable key={s} accessibilityRole="link" onPress={() => router.navigate(`/recherche?cat=${encodeURIComponent(s)}`)}
                      className={`${col} flex-row items-center gap-5 border-b border-line py-5 hover:opacity-70 active:opacity-60`}>
                      <SpecialtyIcon name={s} size={wide ? 40 : 36} color={c.accent} />
                      <Text className={`min-w-0 flex-1 font-semibold text-ink ${wide ? "text-[22px] leading-[27px]" : "text-[20px] leading-[25px]"}`} style={{ letterSpacing: -0.4 }} numberOfLines={2}>
                        {specialty(s)}
                      </Text>
                      <Text className={`tabular-nums text-muted ${wide ? "text-[26px]" : "text-[22px]"}`}>{String(n).padStart(2, "0")}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </Section>

            <Section title={t("h_protocols")} link={all.length > protocols.length ? t("h_see_all") : undefined} onPress={() => router.navigate("/recherche?all=1")}>
              <View className="flex-row flex-wrap justify-between">
                {protocols.map((e, i) => (
                  <Pressable key={e.id} accessibilityRole="link" onPress={() => open(e)}
                    className={`${col} flex-row items-start gap-5 border-b border-line py-5 hover:opacity-70 active:opacity-60`}>
                    <Text className="w-7 pt-[3px] text-[13px] font-semibold tabular-nums text-accent">{String(i + 1).padStart(2, "0")}</Text>
                    <View className="min-w-0 flex-1 gap-1">
                      <Text className="text-[17px] font-semibold leading-[23px] text-ink" style={{ letterSpacing: -0.2 }} numberOfLines={3}>{e.fiche.meta.title}</Text>
                      <Text className="text-[13px] text-muted">{subtitle(e)}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </Section>
          </>
        )}
      </View>
    </ScrollView>
  );
}
