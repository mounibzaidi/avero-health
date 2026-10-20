import { breakpoint } from "@avero/ui-tokens";
import { useRouter } from "expo-router";
import { Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { entries, specialites, useLibrary, type Entry } from "@/lib/library";
import { useFavorites, useRecent } from "@/lib/stored";
import { t } from "@/strings/fr";
import { ArrowRightIcon, CaretRightIcon, MagnifyingGlassIcon, UserIcon } from "@/ui/Icons";
import { SpecialtyIcon } from "@/ui/MedIcons";
import { useColors } from "@/ui/theme";
import { Heading, Skeleton } from "@/ui/ui";

import { subtitle } from "./ProtocolRow";

/** Home: the brand and the account, the date and a greeting, the way to the search, the fiche read last
 * on a green card, the specialties as a grid, and quick access. A block with nothing to show is left out.
 * Wide screens: two columns under the top bar. */


function SectionHead({ title, link, onPress }: { title: string; link?: string; onPress?: () => void }) {
  return (
    <View className="flex-row items-end justify-between">
      <Heading className="text-[17px] font-semibold leading-[22px]">{title}</Heading>
      {link ? (
        <Pressable accessibilityRole="link" hitSlop={10} onPress={onPress} className="active:opacity-60">
          <Text className="text-[13px] font-semibold text-accent">{link}</Text>
        </Pressable>
      ) : null}
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
  const quick = [...new Set([...favoriteIds.map(byId), ...recentIds.map(byId), ...all])].filter((e): e is Entry => !!e && e !== resume).slice(0, wide ? 6 : 4);
  const open = (e: Entry) => router.push(`/fiche/${e.id}`);
  const now = new Date();

  const resumeCard = resume && (
    <View className="gap-[10px]">
      <Text className="text-[11px] font-bold uppercase text-accent" style={{ letterSpacing: 1.4 }}>{t("h_resume_label")}</Text>
      <Pressable accessibilityRole="link" onPress={() => open(resume)}
        className={`flex-row items-center gap-3 rounded-card bg-accent hover:opacity-95 active:opacity-90 ${wide ? "px-[24px] py-[22px]" : "px-[18px] py-[16px]"}`}>
        <View className="min-w-0 flex-1 gap-[6px]">
          <Text className="text-[11px] font-bold uppercase text-onaccent/70" style={{ letterSpacing: 1.3 }}>{t("h_recent")}</Text>
          <Text className={`font-semibold text-onaccent ${wide ? "text-[22px] leading-[28px]" : "text-[19px] leading-[24px]"}`} numberOfLines={3}>{resume.fiche.meta.title}</Text>
          <Text className="text-[13px] text-onaccent/85">{subtitle(resume)}</Text>
          <View className="mt-1 self-start rounded-full bg-onaccent/15 px-3 py-[5px]">
            <Text className="text-[12px] font-semibold text-onaccent">{t("h_continue")}</Text>
          </View>
        </View>
        <View className="h-9 w-9 items-center justify-center rounded-full bg-onaccent/15">
          <ArrowRightIcon size={16} color={c.onaccent} weight="bold" />
        </View>
      </Pressable>
    </View>
  );

  const specialtyGrid = (
    <View className="gap-[10px]">
      <SectionHead title={t("h_specialties")} link={t("h_see_all")} onPress={() => router.navigate("/recherche?all=1")} />
      <View className={`flex-row flex-wrap ${wide ? "gap-[12px]" : "gap-[10px]"}`}>
        {specialties.map((s) => {
          const n = all.filter((e) => e.fiche.meta.specialite === s).length;
          return (
            <Pressable key={s} accessibilityRole="link" onPress={() => router.navigate(`/recherche?cat=${encodeURIComponent(s)}`)}
              className={`flex-1 gap-[12px] rounded-[16px] border border-line bg-panel hover:border-accent/40 active:opacity-70 ${wide ? "min-w-[30%] px-[16px] py-[14px]" : "min-w-[46%] px-[14px] py-[12px]"}`}>
              <View className="flex-row items-center justify-between">
                <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-tint">
                  <SpecialtyIcon name={s} size={20} color={c.accent} />
                </View>
                <CaretRightIcon size={14} color={c.muted} weight="bold" />
              </View>
              <View>
                <Text className="text-[14px] font-semibold leading-[19px] text-ink" numberOfLines={2}>{s}</Text>
                <Text className="text-[12px] text-soft">{t(n === 1 ? "h_protocols_one" : "h_protocols_other", { n })}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const quickList = quick.length > 0 && (
    <View className={wide ? "gap-[10px]" : "gap-[6px]"}>
      <SectionHead title={t("h_quick")} link={t("h_library")} onPress={() => router.navigate("/recherche?all=1")} />
      <View className={wide ? "overflow-hidden rounded-[16px] border border-line bg-panel" : ""}>
        {quick.map((e, i) => {
          return (
            <Pressable key={e.id} accessibilityRole="link" onPress={() => open(e)}
              className={`min-h-[56px] flex-row items-center gap-3 py-[10px] active:opacity-70 ${wide ? `px-[16px] hover:bg-bg/70 ${i ? "border-t border-line" : ""}` : "border-b border-line"}`}>
              <View className="h-[30px] w-[30px] items-center justify-center rounded-full bg-tint">
                <SpecialtyIcon name={e.fiche.meta.specialite} size={20} color={c.accent} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[14px] font-semibold leading-[19px] text-ink" numberOfLines={2}>{e.fiche.meta.title}</Text>
                <Text className="text-[12px] text-soft">{subtitle(e)}</Text>
              </View>
              <CaretRightIcon size={14} color={c.muted} weight="bold" />
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <ScrollView className="flex-1" refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => refetch()} />}>
      <View className={`mx-auto w-full ${wide ? "max-w-[1080px] gap-[32px] px-8 pb-14 pt-6" : "max-w-[560px] gap-[20px] px-4 pb-8 pt-3"}`}>
        {!wide && (
          <View className="flex-row items-center justify-between">
            <Text accessibilityRole="header" className="text-[16px] font-extrabold uppercase text-accent" style={{ letterSpacing: 2.2 }}>Avero</Text>
            <Pressable accessibilityRole="link" accessibilityLabel={t("account")} onPress={() => router.navigate("/profil")} className="h-10 w-10 items-center justify-center rounded-full bg-tint active:opacity-70">
              <UserIcon size={17} color={c.accentink} />
            </Pressable>
          </View>
        )}

        <View className="gap-[20px]">
          <View className="gap-1">
            <Text className="text-[12px] uppercase text-soft" style={{ letterSpacing: 0.6 }}>
              {now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
            </Text>
            <Heading className={`font-semibold ${wide ? "text-[34px] leading-[40px]" : "text-[24px] leading-[30px]"}`} style={{ letterSpacing: wide ? -0.8 : -0.4 }}>
              {now.getHours() < 18 ? t("h_greeting_day") : t("h_greeting_evening")}
            </Heading>
            <Text className={`text-soft ${wide ? "text-[16px] leading-[22px]" : "text-[14px] leading-[20px]"}`}>{t("h_question")}</Text>
          </View>
          <Pressable accessibilityRole="search" onPress={() => router.navigate("/recherche")}
            className={`flex-row items-center gap-[10px] rounded-xl border border-line bg-input hover:border-accent/40 active:opacity-70 ${wide ? "h-[54px] max-w-[640px] px-[18px]" : "h-[48px] px-[14px]"}`}>
            <MagnifyingGlassIcon size={17} color={c.soft} />
            <Text className={`text-soft ${wide ? "text-[15px]" : "text-[14px]"}`}>{t("h_search")}</Text>
          </Pressable>
          {data?.offline ? <Text className="-mt-3 text-[12px] text-caution">{t("fiches_offline")}</Text> : null}
        </View>

        {!wide && resumeCard}

        {loading ? (
          <View className={`gap-3 ${wide ? "max-w-[640px]" : ""}`}>
            <Skeleton className="h-[18px] w-[45%]" />
            <Skeleton className="h-[84px] w-full rounded-[16px]" />
          </View>
        ) : all.length === 0 ? (
          <View className="gap-1">
            <Text className="text-[14px] font-medium text-ink">{t("no_fiches")}</Text>
            <Text className="text-[13px] leading-[19px] text-soft">{t("no_fiches_hint")}</Text>
          </View>
        ) : wide ? (
          <View className="flex-row items-start gap-[32px]">
            <View className="min-w-0 flex-[3] gap-[28px]">
              {resumeCard}
              {specialtyGrid}
            </View>
            {quickList ? <View className="min-w-0 flex-[2]">{quickList}</View> : null}
          </View>
        ) : (
          <>
            {specialtyGrid}
            {quickList}
          </>
        )}
      </View>
    </ScrollView>
  );
}
