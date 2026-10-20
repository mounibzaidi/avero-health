import { SECTION_TITLE, URGENCY_LABEL, type Protocol } from "@avero/schema";
import { breakpoint, size } from "@avero/ui-tokens";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { t } from "@/strings/fr";
import {
  BookOpenIcon, CaretLeftIcon, CheckIcon, ClipboardTextIcon, HospitalIcon, type Icon, PillIcon, QuotesIcon, StethoscopeIcon, UsersThreeIcon, WarningIcon,
} from "@/ui/Icons";
import { Logo } from "@/ui/Logo";
import { SearchField } from "@/ui/SearchField";
import { useColors } from "@/ui/theme";
import { Body, CONTROL_STYLE, Heading } from "@/ui/ui";

import { Medications } from "./Medications";
import { Card, Cites, CiteProvider, ItemCard, ItemRows, RoseCard, SourcesCtx } from "./parts";
import { Pathway } from "./Pathway";
import { StarButton } from "./StarButton";

type SectionId = "red_box" | "assess" | "treat" | "advise" | "refer_follow" | "sources";

const ICON: Record<SectionId, Icon> = {
  red_box: WarningIcon, assess: StethoscopeIcon, treat: PillIcon, advise: UsersThreeIcon, refer_follow: HospitalIcon, sources: BookOpenIcon,
};

/** Screen order of the doc: red box first; "pathologie" puts Conseiller before Traiter. */
const ORDER: Record<Protocol["meta"]["template"], SectionId[]> = {
  urgence: ["red_box", "assess", "treat", "advise", "refer_follow", "sources"],
  pathologie: ["red_box", "assess", "advise", "treat", "refer_follow", "sources"],
};

const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
/** What a jump leaves above a section: the bar of chips and a little air (phone), a little air (wide). */
const BAR = 60;
const AIR_WIDE = 16;

/** Sections with something to show. Empty means not applicable: hidden. */
function visible(f: Protocol): SectionId[] {
  const has: Record<SectionId, boolean> = {
    red_box: f.red_box.signs.length + f.red_box.actions.length > 0,
    assess: f.assess.symptoms.length + f.assess.ask.length + f.assess.examine.length + f.assess.tests.length + f.assess.diagnosis.length + f.assess.pathway.nodes.length > 0,
    treat: f.treat.medications.length + f.treat.actions.length + f.treat.do_not.length > 0,
    advise: f.advise.length > 0,
    refer_follow: f.refer_follow.refer.length + f.refer_follow.follow_up.length > 0,
    sources: f.sources.length > 0,
  };
  return ORDER[f.meta.template].filter((s) => has[s]);
}

/** The red box: when to call the SAMU or send to urgences, and what to do meanwhile. Red border, never folded. */
function RedBox({ f }: { f: Protocol }) {
  const c = useColors();
  return (
    <View className="rounded-card border-2 border-flag bg-surface px-[18px] pb-[6px] pt-4">
      <View className="flex-row items-center gap-2 pb-[2px]">
        <WarningIcon size={19} color={c.warn} weight="fill" />
        <Text className="min-w-0 flex-1 text-[15.5px] font-bold leading-[21px] text-flag">{t("f_red_signs")}</Text>
      </View>
      <ItemRows items={f.red_box.signs} rule="border-flag/15" />
      {f.red_box.actions.length ? (
        <>
          <Text className="border-t border-flag/15 pt-3 text-[13px] font-bold uppercase text-flag" style={{ letterSpacing: 0.4 }}>{t("f_meanwhile")}</Text>
          <ItemRows items={f.red_box.actions} rule="border-flag/15" />
        </>
      ) : null}
    </View>
  );
}

function ReferFollow({ f }: { f: Protocol }) {
  const { refer, follow_up } = f.refer_follow;
  return (
    <>
      {refer.length ? (
        <Card title={t("f_refer")}>
          {refer.map((r, i) => (
            <View key={r.id} className={`gap-[3px] py-3 ${i ? "border-t border-line" : ""}`}>
              <Body className="text-[13px] leading-[18px] text-soft">{t("f_if", { c: r.criteria })}</Body>
              <Body className="text-[14.5px] leading-[21px]">
                <Text className="font-bold">{t("f_refer_line", { u: r.urgency ? URGENCY_LABEL[r.urgency] : "" })}</Text>
                {r.destination ? ` : ${r.destination}` : ""}
                <Cites evidence={r.evidence} strength={r.strength} />
              </Body>
            </View>
          ))}
        </Card>
      ) : null}
      {follow_up.length ? (
        <Card title={t("f_follow")}>
          <View className="flex-row border-b border-line pb-2 pt-1">
            <Text className="w-[30%] pe-3 text-[12px] font-bold uppercase text-muted">{t("f_when")}</Text>
            <Text className="flex-1 text-[12px] font-bold uppercase text-muted">{t("f_what")}</Text>
          </View>
          {follow_up.map((x, i) => (
            <View key={x.id} className={`flex-row py-3 ${i ? "border-t border-line" : ""}`}>
              <Body className="w-[30%] pe-3 text-[14px] font-semibold leading-[20px]">{x.when}</Body>
              <View className="min-w-0 flex-1 gap-[3px]">
                <Body className="text-[14px] leading-[20px]">{x.what}<Cites evidence={x.evidence} strength={null} /></Body>
              </View>
            </View>
          ))}
        </Card>
      ) : null}
    </>
  );
}

function Sources({ f }: { f: Protocol }) {
  return (
    <Card>
      {f.sources.map((s, i) => (
        <View key={s.id} className={`gap-1 py-3 ${i ? "border-t border-line" : ""}`}>
          <Text className="text-[13px] font-bold text-ink">{s.organisation}</Text>
          <Body className="text-[13.5px] leading-[19px]">{s.title}</Body>
          <Text className="text-[12px] leading-[17px] text-soft">{s.citation}</Text>
          {s.url ? (
            <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(s.url!)} className="min-h-9 justify-center self-start active:opacity-60">
              <Text className="text-[13px] font-semibold text-accent">{t("f_open_source")}</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </Card>
  );
}

function SectionBody({ id, f }: { id: SectionId; f: Protocol }) {
  switch (id) {
    case "red_box":
      return <RedBox f={f} />;
    case "assess":
      return (
        <>
          <ItemCard title={t("f_symptoms")} items={f.assess.symptoms} />
          <ItemCard title={t("f_ask")} items={f.assess.ask} />
          <ItemCard title={t("f_examine")} items={f.assess.examine} />
          <ItemCard title={t("f_diagnosis")} items={f.assess.diagnosis} />
          <ItemCard title={t("f_tests")} items={f.assess.tests} />
          <Pathway pathway={f.assess.pathway} />
        </>
      );
    case "treat":
      return (
        <>
          <Medications items={f.treat.medications} />
          <ItemCard title={t("f_other_actions")} items={f.treat.actions} />
          <RoseCard title={t("f_do_not")} items={f.treat.do_not} />
        </>
      );
    case "advise":
      return <Card><ItemRows items={f.advise} /></Card>;
    case "refer_follow":
      return <ReferFollow f={f} />;
    case "sources":
      return <Sources f={f} />;
  }
}

/** A fiche of Protocol v1.1, one screen for both templates. Phone: header, sticky jump bar, the sections, footer.
 * Wide (from 1100 px): sidebar 264 (logo, search, "Sur cette page"), then the content. */
export function FicheScreen({ id, fiche: f }: { id: string; fiche: Protocol }) {
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.ficheWide;
  const [q, setQ] = useState("");
  const ids = visible(f);
  const [active, setActive] = useState<SectionId | null>(null);
  const scroll = useRef<ScrollView>(null);
  const bodyY = useRef(0);
  const sectionY = useRef<Partial<Record<SectionId, number>>>({});
  const chips = useRef<ScrollView>(null);
  const chipX = useRef<Partial<Record<SectionId, number>>>({});

  const urgent = f.meta.template === "urgence";
  const ok = f.meta.status === "published" && f.review.clinical_approval && !!f.review.reviewer;
  const current = active && ids.includes(active) ? active : ids[0];
  const label = (s: SectionId) => (s === "red_box" ? t("f_red_chip") : SECTION_TITLE[s]);

  const offset = wide ? AIR_WIDE : BAR;
  const jump = (s: SectionId) => {
    setActive(s);
    setTimeout(() => scroll.current?.scrollTo({ y: Math.max(0, bodyY.current + (sectionY.current[s] ?? 0) - offset), animated: true }), 0);
  };
  const track = (y: number) => {
    let cur = ids[0];
    for (const s of ids) if (bodyY.current + (sectionY.current[s] ?? Infinity) <= y + offset + 24) cur = s;
    if (cur !== current) setActive(cur);
  };
  useEffect(() => {
    if (current) chips.current?.scrollTo({ x: Math.max(0, (chipX.current[current] ?? 0) - 20), animated: true });
  }, [current]);

  const column = wide ? "" : "mx-auto w-full max-w-[720px] px-5";

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
        {f.scope.population ? (
          <View className="flex-row items-center gap-[6px]">
            <ClipboardTextIcon size={15} color={c.soft} />
            <Text className="text-[13px] text-soft">{f.scope.population}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  const chipBar = wide ? (
    <View />
  ) : (
    <View className="border-b border-line bg-bg">
      <ScrollView ref={chips} horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" className="mx-auto w-full max-w-[720px] grow-0" contentContainerClassName="gap-2 px-5 py-2">
        {ids.map((s) => {
          const on = s === current;
          const Glyph = ICON[s];
          return (
            <Pressable key={s} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => jump(s)} onLayout={(e) => (chipX.current[s] = e.nativeEvent.layout.x)}
              className={`min-h-10 flex-row items-center gap-[6px] rounded-full px-3 active:opacity-70 ${on ? "bg-tint" : "border border-line bg-surface"}`}>
              <Glyph size={14} color={s === "red_box" ? c.warn : on ? c.accentink : c.soft} />
              <Text className={`text-[13px] ${on ? "font-semibold text-accentink" : "font-medium text-soft"}`}>{label(s)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const section = (s: SectionId, body: ReactNode) => {
    const Glyph = ICON[s];
    return (
      <View key={s} className="gap-3" onLayout={(e) => (sectionY.current[s] = e.nativeEvent.layout.y)}>
        {s !== "red_box" ? (
          <View className="flex-row items-center gap-2">
            <Glyph size={18} color={c.accent} />
            <Heading className="text-[17px] font-semibold leading-[22px]">{SECTION_TITLE[s]}</Heading>
          </View>
        ) : null}
        {body}
      </View>
    );
  };

  const page = (
    <View className={`gap-7 pt-4 ${column}`} onLayout={(e) => (bodyY.current = e.nativeEvent.layout.y)}>
      {ids.map((s) => section(s, <SectionBody id={s} f={f} />))}
      <View className="gap-[6px]">
        {ok ? (
          <View className="flex-row items-start gap-2">
            <View className="pt-[3px]">
              <CheckIcon size={14} color={c.accent} weight="bold" />
            </View>
            <Text className="min-w-0 flex-1 text-[13px] leading-[19px] text-soft">
              {`${t("p_verified_by", { name: f.review.reviewer!, date: f.review.reviewed_at ? dateFr(f.review.reviewed_at) : "" })} · v${f.meta.version}`}
            </Text>
          </View>
        ) : (
          <View className="flex-row items-center gap-1 self-start rounded-full border border-caution/25 bg-cautionbg px-2 py-[3px]">
            <WarningIcon size={11} color={c.caution} weight="fill" />
            <Text className="text-[11px] font-semibold text-caution">{t("p_review_pending", { v: f.meta.version })}</Text>
          </View>
        )}
        {f.treat.medications.some((m) => m.local_availability.brands.length) ? <Text className="text-[11px] leading-[16px] text-soft">{t("dz_source")}</Text> : null}
        <View className="flex-row items-center gap-1">
          <QuotesIcon size={11} color={c.soft} />
          <Text className="text-[11px] font-medium text-soft">{t("not_clinical_judgement")}</Text>
        </View>
      </View>
    </View>
  );

  const scroller = (
    <ScrollView ref={scroll} className="flex-1" stickyHeaderIndices={[1]} onScroll={(e) => track(e.nativeEvent.contentOffset.y)} scrollEventThrottle={64}
      contentContainerStyle={
        wide
          ? { maxWidth: size.contentMaxWide, paddingStart: 56, paddingEnd: 40, paddingTop: 36, paddingBottom: 40 }
          : { paddingTop: insets.top, paddingBottom: 28 + insets.bottom }
      }>
      {head}
      {chipBar}
      {page}
    </ScrollView>
  );

  return (
    <SourcesCtx.Provider value={f.sources}>
      <CiteProvider>
      {wide ? (
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
            {ids.map((s) => {
              const on = s === current;
              const Glyph = ICON[s];
              return (
                <Pressable key={s} accessibilityRole="link" accessibilityState={{ selected: on }} onPress={() => jump(s)} style={on ? CONTROL_STYLE : undefined}
                  className={`flex-row items-center gap-2 rounded-lg border px-[10px] py-2 ${on ? "border-edge/[0.07] bg-surface" : "border-transparent hover:bg-surface/60"}`}>
                  <Glyph size={15} color={s === "red_box" ? c.warn : on ? c.accent : c.soft} />
                  <Text className={`text-[14px] ${on ? "font-medium text-ink" : "text-soft"}`} numberOfLines={1}>{label(s)}</Text>
                </Pressable>
              );
            })}
          </View>
          {scroller}
        </View>
      ) : (
        <View className="flex-1 bg-bg">{scroller}</View>
      )}
      </CiteProvider>
    </SourcesCtx.Provider>
  );
}
