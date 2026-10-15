import type { BlockId, Fiche } from "@medguides/schema";
import { breakpoint, size } from "@medguides/ui-tokens";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { t } from "@/strings/fr";
import { BookOpenIcon, CaretLeftIcon, CaretRightIcon, CheckIcon, StethoscopeIcon, WarningIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Logo } from "@/ui/Logo";
import { SearchField } from "@/ui/SearchField";
import { CONTROL_STYLE, Heading } from "@/ui/ui";

import brandsMeta from "../../../../content/shared/dz_brands.meta.json";
import { BLOCK_ICON, BLOCK_LABEL, BlockBody, CHIP_LABEL, ShareAdvice } from "./blocks";
import { blocks, sub, type Cited } from "./model";
import { StepCard } from "./parts";
import { SourceCard } from "./SourceCard";
import { SourceSheet } from "./SourceSheet";
import { StarButton } from "./StarButton";

const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
/** What a jump leaves above a block: the bar of chips and a little air (phone), a little air (wide). */
const BAR = 60;
const AIR_WIDE = 16;

/** A fiche (ProtocolV4 shell). Phone: header, sticky jump bar, the blocks of the display map, footer.
 * Wide (from 1100 px): sidebar 264 (logo, search, "Sur cette page"), content 860, source column 340. */
export function FicheScreen({ id, fiche: f }: { id: string; fiche: Fiche }) {
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.ficheWide;
  const [q, setQ] = useState("");
  const view = useMemo(() => blocks(f), [f]);
  const ids = view.map((b) => b.id);

  const [sheet, setSheet] = useState<Cited | null>(null);
  const open = useCallback((cited: Cited) => setSheet(cited), []);
  const closeSheet = useCallback(() => setSheet(null), []);
  const [folded, setFolded] = useState<BlockId | null>(null); // the collapsed block that is open (one at a time)
  const [active, setActive] = useState<BlockId | null>(null);
  const scroll = useRef<ScrollView>(null);
  const bodyY = useRef(0);
  const blockY = useRef<Partial<Record<BlockId, number>>>({});
  const chips = useRef<ScrollView>(null);
  const chipX = useRef<Partial<Record<BlockId, number>>>({});

  const urgent = f.meta.template === "urgence";
  const ok = f.meta.status === "published" && !!f.meta.reviewer;
  const src = f.meta.sources[0];
  const hasBrands = f.sections["7_traitement"].posologies.some((p) => p.algerie.brands.length);
  const current = active && ids.includes(active) ? active : ids[0];
  const openSource = () => (src?.url ? void Linking.openURL(src.url) : undefined);

  const offset = wide ? AIR_WIDE : BAR;
  const jump = (b: BlockId) => {
    setActive(b);
    if (view.find((x) => x.id === b)?.mode === "collapsed") setFolded(b);
    setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, bodyY.current + (blockY.current[b] ?? 0) - offset), animated: true }), 0);
  };
  // The block at the top of the screen: its chip is the one lit.
  const track = (y: number) => {
    let cur = ids[0];
    for (const b of ids) if (bodyY.current + (blockY.current[b] ?? Infinity) <= y + offset + 24) cur = b;
    if (cur !== current) setActive(cur);
  };
  useEffect(() => {
    if (current) chips.current?.scrollTo({ x: Math.max(0, (chipX.current[current] ?? 0) - 20), animated: true });
  }, [current]);

  const column = wide ? "" : "mx-auto w-full max-w-[720px] px-5";
  const steps = view.find((b) => b.id === "etapes");
  const suivi = view.find((b) => b.id === "suivi");
  const conseils = (suivi && sub(suivi, "conseils_patient")?.lines) ?? [];

  const head = (
    <View className={`gap-3 pb-3 ${wide ? "" : "pt-2"} ${column}`}>
      <View className="flex-row items-center gap-2">
        <Pressable accessibilityRole="link" onPress={() => router.push("/")} className="min-h-11 flex-1 flex-row items-center gap-[6px] active:opacity-60">
          <CaretLeftIcon size={18} color={c.accent} weight="bold" />
          <Text className="text-[14px] font-semibold text-accent">{t("p_back")}</Text>
        </Pressable>
        <View className={`flex-row items-center gap-[5px] rounded-full border px-[10px] py-[4px] ${ok ? "border-accent/25 bg-tint" : "border-caution/25 bg-cautionbg"}`}>
          {ok ? <CheckIcon size={12} color={c.accent} weight="bold" /> : <WarningIcon size={11} color={c.caution} weight="fill" />}
          <Text className={`text-[12px] font-semibold ${ok ? "text-accentink" : "text-caution"}`}>{ok ? t("p_validated") : t("not_reviewed_short")}</Text>
        </View>
        <View className="-me-3">
          <StarButton id={id} />
        </View>
      </View>
      <Heading className="text-[24px] font-bold leading-[29px]" style={{ letterSpacing: -0.5 }}>{f.meta.title}</Heading>
      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-[6px]">
        <View className="flex-row items-center gap-[6px]">
          <StethoscopeIcon size={15} color={urgent ? c.warn : c.soft} />
          <Text className={`text-[13px] ${urgent ? "font-semibold text-flag" : "text-soft"}`}>{urgent ? t("p_urgence") : f.meta.specialite}</Text>
        </View>
        {src ? (
          <Pressable accessibilityRole="link" disabled={!src.url} onPress={openSource} className="min-w-0 shrink flex-row items-center gap-[6px] active:opacity-60">
            <BookOpenIcon size={15} color={c.soft} />
            <Text className="shrink text-[13px] text-soft" numberOfLines={1}>{src.citation}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  // The jump bar: one chip per block shown. It stays at the top while the page scrolls.
  const bar = wide ? (
    <View />
  ) : (
    <View className="border-b border-line bg-bg">
      <ScrollView ref={chips} horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" className="mx-auto w-full max-w-[720px] grow-0" contentContainerClassName="gap-2 px-5 py-2">
        {ids.map((b) => {
          const on = b === current;
          return (
            <Pressable key={b} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => jump(b)} onLayout={(e) => (chipX.current[b] = e.nativeEvent.layout.x)}
              className={`min-h-10 flex-row items-center gap-[6px] rounded-full px-3 active:opacity-70 ${on ? "bg-tint" : "border border-line bg-surface"}`}>
              {BLOCK_ICON[b]({ size: 14, color: on ? c.accentink : c.soft })}
              <Text className={`text-[13px] ${on ? "font-semibold text-accentink" : "font-medium text-soft"}`}>{t(CHIP_LABEL[b] ?? BLOCK_LABEL[b])}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const page = (
    <View className={`gap-7 pt-4 ${column}`} onLayout={(e) => (bodyY.current = e.nativeEvent.layout.y)}>
      {view.map((b) => (
        <View key={b.id} className="gap-3" onLayout={(e) => (blockY.current[b.id] = e.nativeEvent.layout.y)}>
          {b.mode === "collapsed" ? (
            <StepCard on={folded === b.id} onToggle={() => setFolded(folded === b.id ? null : b.id)} title={t(BLOCK_LABEL[b.id])} count={b.notCovered ? undefined : b.count}
              badge={<View className="h-[28px] w-[28px] items-center justify-center rounded-full bg-tint">{BLOCK_ICON[b.id]({ size: 15, color: c.accentink })}</View>}>
              <View className="gap-3 py-3">
                <BlockBody b={b} f={f} open={open} all />
              </View>
            </StepCard>
          ) : (
            <>
              <View className="flex-row items-center gap-2">
                {BLOCK_ICON[b.id]({ size: 18, color: b.id === "a_eviter" ? c.warn : c.accent })}
                <View className="min-w-0 flex-1 flex-row flex-wrap items-baseline gap-x-2">
                  <Heading className={`text-[17px] font-semibold leading-[22px] ${b.id === "a_eviter" ? "text-flag" : ""}`}>{t(BLOCK_LABEL[b.id])}</Heading>
                  {b.id === "etapes" ? <Text className="text-[13px] text-soft">{t(urgent ? "p_etapes_urgence" : "p_etapes_chronique")}</Text> : null}
                </View>
                {b.id === "etapes" && steps ? <Text className="text-[13px] text-soft">{t("p_steps_n", { n: steps.count })}</Text> : null}
              </View>
              <BlockBody b={b} f={f} open={open} />
              {b.id === "suivi" ? <ShareAdvice f={f} lines={conseils} /> : null}
            </>
          )}
        </View>
      ))}
      <View className="gap-[6px]">
        {ok ? (
          <View className="flex-row items-start gap-2">
            <View className="pt-[3px]">
              <CheckIcon size={14} color={c.accent} weight="bold" />
            </View>
            <Text className="min-w-0 flex-1 text-[13px] leading-[19px] text-soft">
              {`${t("p_verified_by", { name: f.meta.reviewer!, date: f.meta.reviewed_at ? dateFr(f.meta.reviewed_at) : "" })} · v${f.meta.version}`}
            </Text>
          </View>
        ) : (
          <View className="flex-row items-center gap-1 self-start rounded-full border border-caution/25 bg-cautionbg px-2 py-[3px]">
            <WarningIcon size={11} color={c.caution} weight="fill" />
            <Text className="text-[11px] font-semibold text-caution">{t("p_review_pending", { v: f.meta.version })}</Text>
          </View>
        )}
        {src?.url && !wide ? (
          <Pressable accessibilityRole="link" onPress={openSource} className="min-h-11 flex-row items-center gap-1 self-start active:opacity-60">
            <Text className="text-[13px] font-semibold text-accent">{t("p_full_guideline")}</Text>
            <CaretRightIcon size={13} color={c.accent} weight="bold" />
          </Pressable>
        ) : null}
        {hasBrands ? <Text className="text-[11px] leading-[16px] text-soft">{t("dz_source", { source: brandsMeta.source })}</Text> : null}
        <Text className="text-[11px] font-medium text-soft">{t("not_clinical_judgement")}</Text>
      </View>
    </View>
  );

  const sheetView = sheet ? <SourceSheet fiche={f} cited={sheet} onClose={closeSheet} /> : null;
  const scroller = (
    <ScrollView ref={scroll} className="flex-1" stickyHeaderIndices={[1]} onScroll={(e) => track(e.nativeEvent.contentOffset.y)} scrollEventThrottle={64}
      contentContainerStyle={
        wide
          ? { maxWidth: size.contentMaxWide, paddingStart: 56, paddingEnd: 40, paddingTop: 36, paddingBottom: 40 }
          : { paddingTop: insets.top, paddingBottom: 28 + insets.bottom }
      }>
      {head}
      {bar}
      {page}
    </ScrollView>
  );

  // Wide screens: the library's sidebar (logo, search, the blocks), the fiche, the source column.
  if (wide) {
    return (
      <View className="flex-1 flex-row bg-bg">
        <View className="w-[264px] border-e border-edge/[0.06] bg-panel px-5 py-[22px]">
          <Pressable accessibilityRole="link" onPress={() => router.push("/")} className="self-start">
            <Logo />
          </Pressable>
          <View className="h-[22px]" />
          <SearchField compact value={q} onChange={setQ} onSubmit={() => q.trim() && router.push(`/?q=${encodeURIComponent(q.trim())}`)} />
          <View className="h-[26px]" />
          <Text className="ps-1 text-[13px] font-medium text-soft">{t("on_this_page")}</Text>
          <View className="h-[6px]" />
          {ids.map((b) => {
            const on = b === current;
            return (
              <Pressable key={b} accessibilityRole="link" accessibilityState={{ selected: on }} onPress={() => jump(b)} style={on ? CONTROL_STYLE : undefined}
                className={`flex-row items-center gap-2 rounded-lg border px-[10px] py-2 ${on ? "border-edge/[0.07] bg-surface" : "border-transparent hover:bg-surface/60"}`}>
                {BLOCK_ICON[b]({ size: 15, color: on ? c.accent : c.soft })}
                <Text className={`text-[14px] ${on ? "font-medium text-ink" : "text-soft"}`} numberOfLines={1}>{t(BLOCK_LABEL[b])}</Text>
              </Pressable>
            );
          })}
        </View>
        {scroller}
        <ScrollView className="w-[340px] grow-0">
          <View className="gap-3 py-9 pe-8">
            <SourceCard fiche={f} />
          </View>
        </ScrollView>
        {sheetView}
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg">
      {scroller}
      {sheetView}
    </View>
  );
}
