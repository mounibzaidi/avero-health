import { STRENGTH_LABEL, type Evidence, type Item, type Source, type Strength } from "@avero/schema";
import { cssVars, fixed, shadow, size } from "@avero/ui-tokens";
import { vars } from "nativewind";
import { createContext, useContext, useState, type ReactNode } from "react";
import { Linking, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { t } from "@/strings/fr";
import { WarningIcon } from "@/ui/Icons";
import { useColors, useTheme } from "@/ui/theme";
import { Body, SURFACE_STYLE } from "@/ui/ui";

/** Card anatomy, from ProtocolV4.tsx (radius 18, 6% hairline, surface shadow). */
export const CARD = "rounded-card border border-edge/[0.06] bg-surface";

/** The fiche's sources, to name a line's source by its short name. */
export const SourcesCtx = createContext<Source[]>([]);

/** What a line cites, as the sheet shows it. */
export type Cited = { evidence: Evidence[]; strength: Strength | null; local?: boolean; basis?: string | null };
const CiteCtx = createContext<(c: Cited) => void>(() => {});

/** A source's name on a chip: the acronym in brackets ("Haute Autorité de santé (HAS)"), a short name as it is, or
 * the initials of a long one ("Revue Médicale Suisse" = RMS). */
function shortName(s: Source | undefined, id: string): string {
  const org = s?.organisation?.trim() ?? "";
  const acronym = /\(([\p{Lu}][\p{L}0-9&/-]{1,9})\)/u.exec(org);
  if (acronym) return acronym[1];
  if (org && org.length <= 14) return org;
  const initials = org.split(/[\s-]+/).filter((w) => /^\p{Lu}/u.test(w)).map((w) => w[0]).join("");
  return initials.length > 1 ? initials : org.slice(0, 14) || id;
}

/** Evidence grouped by source, in the order the line cites them. */
function bySource(evidence: Evidence[]): [string, Evidence[]][] {
  const m = new Map<string, Evidence[]>();
  for (const e of evidence) m.set(e.source_id, [...(m.get(e.source_id) ?? []), e]);
  return [...m];
}
const pagesOf = (list: Evidence[]) => [...new Set(list.map((e) => e.page).filter((p): p is number => p != null))];

/**
 * The citation at the end of a line's text, inside its <Text>: one compact chip per source ("HAS p.21"), and one for
 * a local adaptation. A tap opens the sheet with the source, page, strength and the verbatim quotes.
 */
export function Cites({ evidence, strength, local, basis }: Cited) {
  const sources = useContext(SourcesCtx);
  const open = useContext(CiteCtx);
  const groups = bySource(evidence);
  if (!groups.length && !local) return null;
  const onPress = () => open({ evidence, strength, local, basis });
  const chip = (key: string, label: string) => (
    <Text key={key}>
      {" "}
      <Text accessibilityRole="button" onPress={onPress} className="bg-panel text-[11.5px] font-medium text-muted">{` ${label} `}</Text>
    </Text>
  );
  return (
    <>
      {local ? chip("local", t("f_local_adaptation")) : null}
      {groups.map(([id, list]) => {
        const pages = pagesOf(list);
        const name = shortName(sources.find((s) => s.id === id), id);
        return chip(id, pages.length ? `${name} ${t("f_page_short", { p: pages.join(", ") })}` : name);
      })}
    </>
  );
}

/** The sheet of a line's citation: per source, its full name, title, pages, the line's strength, every quote. */
function CiteSheet({ cited, onClose }: { cited: Cited | null; onClose: () => void }) {
  const sources = useContext(SourcesCtx);
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!cited} transparent animationType="fade" onRequestClose={onClose}>
      {/* the sheet renders outside the themed tree on web: it carries the theme's colours itself */}
      <View className="flex-1 justify-end" style={vars(cssVars(theme))}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("f_close")} onPress={onClose} className="absolute inset-0" style={{ backgroundColor: fixed.scrim }} />
        {cited ? (
          <View className="mx-auto w-full rounded-t-sheetTop bg-surface px-5 pt-3"
            style={{ maxWidth: size.sheetMax, maxHeight: "80%", paddingBottom: 12 + insets.bottom, boxShadow: shadow.sheet }}>
            <View className="mb-2 h-1 w-10 self-center rounded-full bg-line" />
            <ScrollView contentContainerClassName="gap-4 pb-2">
              {cited.local ? (
                <View className="gap-1">
                  <Text className="text-[13px] font-bold text-caution">{t("f_local_adaptation")}</Text>
                  {cited.basis ? <Body className="text-[13.5px] leading-[19px]">{cited.basis}</Body> : null}
                </View>
              ) : null}
              {bySource(cited.evidence).map(([id, list]) => {
                const s = sources.find((x) => x.id === id);
                const pages = pagesOf(list);
                return (
                  <View key={id} className="gap-2">
                    <View className="gap-[2px]">
                      <Text className="text-[14px] font-bold text-ink">{s?.organisation || id}</Text>
                      {s?.title ? <Body className="text-[13.5px] leading-[19px] text-soft">{s.title}</Body> : null}
                      <Text className="text-[12.5px] text-muted">
                        {[pages.length ? t("f_page", { p: pages.join(", ") }) : null, cited.strength ? t("f_strength", { s: STRENGTH_LABEL[cited.strength] }) : null].filter(Boolean).join(" · ")}
                      </Text>
                    </View>
                    {list.filter((e) => e.quote.trim()).map((e, i) => (
                      <View key={i} className="border-s-2 border-line ps-3">
                        <Body className="text-[13.5px] italic leading-[20px]">{`« ${e.quote.trim()} »`}</Body>
                        {e.page != null && list.length > 1 ? <Text className="pt-[2px] text-[11.5px] text-muted">{t("f_page", { p: e.page })}</Text> : null}
                      </View>
                    ))}
                    {s?.url ? (
                      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(s.url!)} className="min-h-9 justify-center self-start active:opacity-60">
                        <Text className="text-[13px] font-semibold text-accent">{t("f_open_source")}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
            <Pressable accessibilityRole="button" onPress={onClose} className="mt-2 min-h-11 items-center justify-center rounded-button bg-panel active:opacity-70">
              <Text className="text-[14px] font-semibold text-ink">{t("f_close")}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

/** Lets the lines of a fiche open the citation sheet (one sheet for the screen). */
export function CiteProvider({ children }: { children: ReactNode }) {
  const [cited, setCited] = useState<Cited | null>(null);
  return (
    <CiteCtx.Provider value={setCited}>
      {children}
      <CiteSheet cited={cited} onClose={() => setCited(null)} />
    </CiteCtx.Provider>
  );
}

/** A line: its condition as a small label above, then the text ending with its citation chips. */
export function ItemRow({ item, first, rule = "border-line", textClass = "text-ink" }: { item: Item; first?: boolean; rule?: string; textClass?: string }) {
  return (
    <View className={`gap-[3px] py-3 ${first ? "" : `border-t ${rule}`}`}>
      {item.condition ? <Text className="text-[12px] font-medium leading-[16px] text-muted">{t("f_if", { c: item.condition })}</Text> : null}
      <Body className={`text-[14.5px] leading-[21px] ${textClass}`}>
        {item.text}
        <Cites evidence={item.evidence} strength={item.strength} local={item.origin === "adaptation_locale"} basis={item.basis} />
      </Body>
    </View>
  );
}

export const ItemRows = ({ items, rule, textClass }: { items: Item[]; rule?: string; textClass?: string }) => (
  <View>
    {items.map((it, i) => <ItemRow key={it.id} item={it} first={i === 0} rule={rule} textClass={textClass} />)}
  </View>
);

/** A white card, under its title when it has one. */
export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View className={`${CARD} px-[18px] pb-[6px] ${title ? "pt-4" : "pt-[6px]"}`} style={SURFACE_STYLE}>
      {title ? <Text className="pb-[2px] text-[15px] font-bold text-ink">{title}</Text> : null}
      {children}
    </View>
  );
}

/** Items in a card under a title; nothing when there are none. */
export const ItemCard = ({ title, items }: { title: string; items: Item[] }) =>
  items.length ? <Card title={title}><ItemRows items={items} /></Card> : null;

/** A rose card: what not to do. */
export function RoseCard({ title, items }: { title: string; items: Item[] }) {
  const c = useColors();
  if (!items.length) return null;
  return (
    <View className="rounded-card bg-flagbg px-[18px] pb-[6px] pt-4">
      <View className="flex-row items-center gap-2 pb-[2px]">
        <WarningIcon size={18} color={c.warn} weight="fill" />
        <Text className="min-w-0 flex-1 text-[15px] font-bold text-flag">{title}</Text>
      </View>
      <ItemRows items={items} rule="border-flag/10" />
    </View>
  );
}
