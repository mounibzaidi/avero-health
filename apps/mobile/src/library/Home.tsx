import { breakpoint } from "@avero/ui-tokens";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { entries, specialites, useLibrary, type Entry } from "@/lib/library";
import { useRecent } from "@/lib/stored";
import { t } from "@/strings/fr";
import { ArrowRightIcon, MagnifyingGlassIcon, UserIcon } from "@/ui/Icons";
import { SpecialtyIcon } from "@/ui/MedIcons";
import { LogoMark } from "@/ui/Logo";
import { useColors } from "@/ui/theme";
import { Skeleton, SURFACE_STYLE } from "@/ui/ui";

import { specialty, subtitle } from "./ProtocolRow";

/** Home, laid out like a contents page: the last review date over a large title, the search, the fiche read
 * last, the specialties as boxes (large icon, name), then the protocols published last as an index on thin rules. */

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

/** Equal shares of a row, whatever each box holds. The filler of a short last row has the boxes' border and
 * padding, which flex counts outside the shares, so its boxes keep the same widths. */
const EQUAL = { flexGrow: 1, flexShrink: 1, flexBasis: 0 } as const;
/** Specialty boxes per row. */
const PER_ROW = (wide: boolean) => (wide ? 4 : 2);

/** `items` cut into rows of `per`. */
const rows = <T,>(items: T[], per: number) => Array.from({ length: Math.ceil(items.length / per) }, (_, i) => items.slice(i * per, i * per + per));

export function HomeScreen() {
  const router = useRouter();
  const c = useColors();
  const wide = useWindowDimensions().width >= breakpoint.library;
  const { data, loading, syncing, refetch } = useLibrary();
  const { ids: recentIds } = useRecent();

  const all = entries(data);
  const byId = (id: string) => all.find((e) => e.id === id);
  const resume = recentIds.map(byId).find((e): e is Entry => !!e);
  const specialties = specialites(all);
  // the latest published first
  const protocols = [...all].sort((a, b) => (b.published ?? "").localeCompare(a.published ?? "")).slice(0, 8);
  const reviewed = all.map((e) => e.fiche.meta.last_reviewed_at).filter((d): d is string => !!d).sort().at(-1);
  const open = (e: Entry) => router.push(`/fiche/${e.id}`);
  // the last review date, alone over the title
  const stats = reviewed ? new Date(reviewed).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "";
  // two columns of index rows on a wide screen
  const col = wide ? "w-[47%]" : "w-full";

  return (
    <ScrollView className="flex-1" refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => refetch()} />}>
      <View className={`mx-auto w-full ${wide ? "max-w-[1080px] gap-[44px] px-10 pb-16 pt-10" : "max-w-[560px] gap-[44px] px-5 pb-12 pt-3"}`}>
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
            <Text accessibilityRole="header" className={`font-bold text-ink ${wide ? "text-[46px] leading-[50px]" : "text-[44px] leading-[46px]"}`} style={{ letterSpacing: -1.6 }}>
              {t("h_title")}
            </Text>
            <Text className="text-[16px] leading-[24px] text-soft">{t("h_lead")}</Text>
          </View>

          <Pressable accessibilityRole="search" onPress={() => router.navigate("/recherche")} style={SURFACE_STYLE}
            className={`flex-row items-center gap-3 rounded-full border border-edge/[0.08] bg-surface px-5 hover:border-accent/30 active:opacity-80 ${wide ? "h-[48px] max-w-[520px]" : "h-[50px]"}`}>
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
              <View className={`pt-5 ${wide ? "gap-4" : "gap-3"}`}>
                {rows(specialties, PER_ROW(wide)).map((row) => (
                  <View key={row[0]} className={`flex-row ${wide ? "gap-4" : "gap-3"}`}>
                    {row.map((s) => (
                      <Pressable key={s} accessibilityRole="link" onPress={() => router.navigate(`/recherche?cat=${encodeURIComponent(s)}`)}
                        style={EQUAL} className={`min-w-0 justify-between rounded-[20px] border border-line bg-surface hover:border-accent/40 active:opacity-80 ${wide ? "h-[120px] p-4" : "h-[140px] p-4"}`}>
                        <View className="flex-row items-start justify-between">
                          <SpecialtyIcon name={s} size={wide ? 34 : 40} color={c.accent} />
                          <ArrowRightIcon size={18} color={c.muted} />
                        </View>
                        <Text className={`font-semibold text-ink ${wide ? "text-[16px] leading-[21px]" : "text-[15.5px] leading-[20px]"}`} style={{ letterSpacing: -0.4 }} numberOfLines={2}>
                          {specialty(s)}
                        </Text>
                      </Pressable>
                    ))}
                    {wide && Array.from({ length: PER_ROW(wide) - row.length }, (_, k) => <View key={k} style={EQUAL} className="border border-transparent p-4" />)}
                  </View>
                ))}
              </View>
            </Section>

            <Section title={t("h_protocols")} link={all.length > protocols.length ? t("h_see_all") : undefined} onPress={() => router.navigate("/recherche?all=1")}>
              <View className="flex-row flex-wrap justify-between">
                {protocols.map((e, i) => (
                  <Pressable key={e.id} accessibilityRole="link" onPress={() => open(e)}
                    className={`${col} flex-row items-start gap-5 border-b border-line hover:opacity-70 active:opacity-60 ${wide ? "py-4" : "py-5"}`}>
                    <Text className="w-7 pt-[3px] text-[13px] font-semibold tabular-nums text-accent">{String(i + 1).padStart(2, "0")}</Text>
                    <View className="min-w-0 flex-1 gap-1">
                      <Text className={`font-semibold text-ink ${wide ? "text-[15px] leading-[21px]" : "text-[17px] leading-[23px]"}`} style={{ letterSpacing: -0.2 }} numberOfLines={3}>{e.fiche.meta.title}</Text>
                      <Text className="text-[13px] text-muted">{[subtitle(e), e.published && t("h_added", { date: new Date(e.published).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) })].filter(Boolean).join(" · ")}</Text>
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
