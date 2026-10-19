import { STRENGTH_LABEL, type Evidence, type Item, type Source, type Strength } from "@avero/schema";
import { createContext, useContext, type ReactNode } from "react";
import { Text, View } from "react-native";

import { t } from "@/strings/fr";
import { WarningIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Body, SURFACE_STYLE } from "@/ui/ui";

/** Card anatomy, from ProtocolV4.tsx (radius 18, 6% hairline, surface shadow). */
export const CARD = "rounded-card border border-edge/[0.06] bg-surface";

/** The fiche's sources, to name a line's source by its short name. */
export const SourcesCtx = createContext<Source[]>([]);

/** The small grey tag under a line: source short name, page, strength. */
export function Tag({ evidence, strength, local }: { evidence: Evidence[]; strength: Strength | null; local?: boolean }) {
  const sources = useContext(SourcesCtx);
  const e = evidence[0];
  const name = e ? sources.find((s) => s.id === e.source_id)?.organisation || e.source_id : null;
  const parts = [
    local ? t("f_local_adaptation") : null,
    name,
    e?.page ? t("f_page", { p: e.page }) : null,
    strength ? STRENGTH_LABEL[strength] : null,
  ].filter(Boolean);
  if (!parts.length) return null;
  return <Text className="text-[11.5px] leading-[16px] text-muted">{parts.join(" · ")}</Text>;
}

/** A line: its condition in grey above, the text, then its tag. */
export function ItemRow({ item, first, rule = "border-line", textClass = "text-ink" }: { item: Item; first?: boolean; rule?: string; textClass?: string }) {
  return (
    <View className={`gap-[3px] py-3 ${first ? "" : `border-t ${rule}`}`}>
      {item.condition ? <Body className="text-[13px] leading-[18px] text-soft">{t("f_if", { c: item.condition })}</Body> : null}
      <Body className={`text-[14.5px] leading-[21px] ${textClass}`}>{item.text}</Body>
      <Tag evidence={item.evidence} strength={item.strength} local={item.origin === "adaptation_locale"} />
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
