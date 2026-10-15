import { DISPLAY, type Element } from "@medguides/schema";
import { useState, type ReactNode } from "react";
import { Pressable, Share, Text, View } from "react-native";

import { t } from "@/strings/fr";
import { ArrowRightIcon, CaretDownIcon, CaretRightIcon, CaretUpIcon, ExportIcon, WarningIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Body, CONTROL_STYLE, SURFACE_STYLE } from "@/ui/ui";

import type { Cited } from "./model";

/** Card anatomy, from ProtocolV4.tsx (radius 18, 6% hairline, surface shadow). */
export const CARD = "rounded-card border border-edge/[0.06] bg-surface";

export type Open = (c: Cited) => void;

/** A list cut to its first items: what to show, and the "Voir plus (N)" that opens the rest (display rule, D1). */
export function useCap<T>(items: T[], cap: number = DISPLAY.listCap): [T[], ReactNode] {
  const [all, setAll] = useState(false);
  const more = items.length - cap;
  if (all || more <= 0) return [items, null];
  return [
    items.slice(0, cap),
    <Pressable key="more" accessibilityRole="button" onPress={() => setAll(true)} className="min-h-11 justify-center self-start active:opacity-60">
      <Text className="text-[13px] font-semibold text-accent">{t("see_more_n", { n: more })}</Text>
    </Pressable>,
  ];
}

/** A line: touching it shows its page, the source's own words and the source. A condition is said under it, in grey. */
export function Row({ line, open, first, rule = "border-line", className = "text-[14px] leading-[20px] text-ink", children }: {
  line: Element; open: Open; first?: boolean; rule?: string; className?: string; children?: ReactNode;
}) {
  return (
    <Pressable accessibilityHint={t("tap_line_hint")} onPress={() => open(line)} className={`gap-[5px] py-3 active:opacity-70 ${first ? "" : `border-t ${rule}`}`}>
      <Body className={className}>{line.text}</Body>
      {line.condition && line.type === "conditional" ? <Body className="text-[13px] leading-[19px] text-soft">{line.condition}</Body> : null}
      {children}
    </Pressable>
  );
}

/** Lines one under the other: four, then "Voir plus (N)". */
export function Rows({ lines, open, className, rule, all }: { lines: Element[]; open: Open; className?: string; rule?: string; all?: boolean }) {
  const [shown, more] = useCap(lines, all ? Infinity : undefined);
  return (
    <View>
      {shown.map((l, i) => (
        <Row key={l.id} line={l} open={open} first={i === 0} className={className} rule={rule} />
      ))}
      {more}
    </View>
  );
}

/** A white card, under its title when it has one. */
export function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <View className={`${CARD} px-[18px] pb-[6px] ${title ? "pt-4" : "pt-[6px]"}`} style={SURFACE_STYLE}>
      {title ? (
        <View className="flex-row items-center justify-between gap-3 pb-[2px]">
          <Text className="min-w-0 flex-1 text-[15px] font-bold text-ink">{title}</Text>
          {aside}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A rose card: what not to do. */
export function RedBox({ title, lines, open }: { title?: string; lines: Element[]; open: Open }) {
  const c = useColors();
  if (!lines.length) return null;
  return (
    <View className={`rounded-card bg-flagbg px-[18px] pb-[6px] ${title ? "pt-4" : "pt-[6px]"}`}>
      {title ? (
        <View className="flex-row items-center gap-2 pb-[2px]">
          <WarningIcon size={18} color={c.warn} weight="fill" />
          <Text className="min-w-0 flex-1 text-[15px] font-bold text-flag">{title}</Text>
        </View>
      ) : null}
      <Rows lines={lines} open={open} rule="border-flag/10" />
    </View>
  );
}

/** The amber card of a block the source does not treat. */
export const NotCovered = () => {
  const c = useColors();
  return (
    <View className="flex-row items-center gap-2 rounded-card bg-cautionbg px-[18px] py-4">
      <WarningIcon size={15} color={c.caution} weight="fill" />
      <Text className="text-[14px] font-semibold text-caution">{t("not_covered_section")}</Text>
    </View>
  );
};

/** One choice among a few: an infusion with or without a syringe pump. */
export function Segments({ labels, value, onChange, dense }: { labels: string[]; value: number; onChange: (i: number) => void; dense?: boolean }) {
  return (
    <View accessibilityRole="tablist" className="flex-row rounded-full bg-panel p-[3px]">
      {labels.map((label, i) => {
        const on = i === value;
        return (
          <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(i)}
            style={on ? CONTROL_STYLE : undefined} className={`min-h-10 items-center justify-center rounded-full active:opacity-70 ${dense ? "flex-auto px-[6px]" : "flex-1 px-2"} ${on ? "bg-surface" : ""}`}>
            <Text className={`text-center ${dense ? "text-[12.5px] leading-[15px]" : "text-[13px]"} ${on ? "font-semibold text-ink" : "font-medium text-soft"}`} numberOfLines={2}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A small heading inside a card: what the lines under it are. */
export const Sub = ({ children, red, caution }: { children: ReactNode; red?: boolean; caution?: boolean }) => {
  const c = useColors();
  return (
    <View className="flex-row items-center gap-[6px]">
      {red ? <WarningIcon size={14} color={c.warn} weight="fill" /> : null}
      <Text className={`text-[12px] font-bold ${red ? "text-flag" : caution ? "text-caution" : "text-soft"}`}>{children}</Text>
    </View>
  );
};

/** Rows that open in place, one at a time, as one card. Amber: what replaces a contraindicated drug. */
export function Openers({ title, items, tone }: { title?: string; items: { key: string; title: string; body: ReactNode }[]; tone?: "caution" }) {
  const c = useColors();
  const [shown, setShown] = useState<number | null>(null);
  const amber = tone === "caution";
  if (!items.length) return null;
  return (
    <View className={`overflow-hidden rounded-card ${amber ? "bg-cautionbg" : "border border-edge/[0.06] bg-surface"}`} style={amber ? undefined : SURFACE_STYLE}>
      {title ? <Text className={`px-[18px] pb-1 pt-4 text-[15px] font-bold ${amber ? "text-caution" : "text-ink"}`}>{title}</Text> : null}
      {items.map((item, i) => {
        const on = shown === i;
        return (
          <View key={item.key} className={i || title ? `border-t ${amber ? "border-caution/15" : "border-line"}` : ""}>
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={() => setShown(on ? null : i)} className="min-h-[52px] flex-row items-center gap-3 px-[18px] py-3 active:opacity-70">
              <Text className={`min-w-0 flex-1 text-[14.5px] leading-[20px] ${amber ? "text-caution" : "text-ink"} ${on ? "font-bold" : "font-medium"}`}>{item.title}</Text>
              {on ? <CaretDownIcon size={15} color={amber ? c.caution : c.accent} weight="bold" /> : <CaretRightIcon size={15} color={amber ? c.caution : c.muted} weight="bold" />}
            </Pressable>
            {on ? <View className="gap-3 px-[18px] pb-3">{item.body}</View> : null}
          </View>
        );
      })}
    </View>
  );
}

/** A sheet to hand over (test request, prescription): a dashed card, and the way to send it. */
export function Paper({ title, lines, foot }: { title: string; lines: string[]; foot?: string }) {
  const c = useColors();
  const send = () => Share.share({ message: [title, "", ...lines.map((l) => `- ${l}`), ...(foot ? ["", foot] : [])].join("\n") }).catch(() => {});
  return (
    <View className="gap-3 rounded-xl border border-dashed border-edge/25 bg-surface p-4">
      <Text className="text-[13px] font-bold uppercase text-soft" style={{ letterSpacing: 0.6 }}>{title}</Text>
      <View className="gap-[6px]">
        {lines.map((l, i) => (
          <Body key={i} className="text-[14px] leading-[20px] text-ink">{l}</Body>
        ))}
      </View>
      {foot ? <Text className="text-[11px] leading-[16px] text-soft">{foot}</Text> : null}
      <Pressable accessibilityRole="button" onPress={send} className="h-11 flex-row items-center justify-center gap-2 self-start rounded-action bg-tint px-4 active:opacity-70">
        <ExportIcon size={16} color={c.accentink} />
        <Text className="text-[14px] font-semibold text-accentink">{t("p_send")}</Text>
      </Pressable>
    </View>
  );
}

export const ActionButton = ({ label, icon, on, onPress }: { label: string; icon: ReactNode; on?: boolean; onPress: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={onPress}
    className="h-11 flex-row items-center justify-center gap-2 self-start rounded-action bg-tint px-4 active:opacity-70">
    {icon}
    <Text className="text-[14px] font-semibold text-accentink">{label}</Text>
  </Pressable>
);

/** "Si … →" decision cards (v2 Branches): the condition in a tinted pill, then what to do. */
export function Branches({ lines, open }: { lines: Element[]; open: Open }) {
  const c = useColors();
  return (
    <View className="gap-2 py-[10px]">
      {lines.map((l) => (
        <Pressable key={l.id} accessibilityHint={t("tap_line_hint")} onPress={() => open(l)} className="gap-[10px] rounded-branch bg-panel p-[14px] active:opacity-70">
          <View className="flex-row items-start gap-2">
            <View className="rounded-full bg-tint px-[8px] py-[2px]">
              <Text className="text-[11px] font-bold text-accentink">{t("if_label")}</Text>
            </View>
            <Body className="min-w-0 flex-1 pt-[1px] text-[13.5px] font-semibold leading-[19px] text-accentink">{l.condition ?? ""}</Body>
          </View>
          <View className="flex-row items-start gap-2 border-t border-line pt-[9px]">
            <View className="w-[30px] items-center pt-[3px]">
              <ArrowRightIcon size={14} color={c.accent} weight="bold" />
            </View>
            <Body className="min-w-0 flex-1 text-[14px] leading-[20px]">{l.text}</Body>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** Conditional lines in a row of "Si …" cards; the others as plain rows. */
export function Lines({ lines, open }: { lines: Element[]; open: Open }) {
  const cond = lines.filter((l) => l.type === "conditional" && l.condition);
  const plain = lines.filter((l) => !cond.includes(l));
  return (
    <View>
      {plain.length ? <Rows lines={plain} open={open} /> : null}
      {cond.length ? <Branches lines={cond} open={open} /> : null}
    </View>
  );
}

/** "Fermer" at the foot of an open step card. */
export function CloseRow({ onPress }: { onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="min-h-11 flex-row items-center justify-center gap-[6px] border-t border-line active:opacity-60">
      <CaretUpIcon size={13} color={c.accent} weight="bold" />
      <Text className="text-[13px] font-semibold text-accent">{t("p_close")}</Text>
    </Pressable>
  );
}

/** A step card (v2 pattern): header row (badge, title, count, caret), opens in place, "Fermer" at the foot. */
export function StepCard({ badge, title, count, on, onToggle, children }: {
  badge: ReactNode; title: string; count?: number; on: boolean; onToggle: () => void; children: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={SURFACE_STYLE} className={`overflow-hidden rounded-card border bg-surface ${on ? "border-accent/25" : "border-edge/[0.06]"}`}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: on }} onPress={onToggle}
        className={`min-h-[60px] flex-row items-center gap-3 px-4 py-3 active:opacity-70 ${on ? "bg-tint/40" : ""}`}>
        {badge}
        <Text className={`min-w-0 flex-1 text-[15.5px] leading-[20px] text-ink ${on ? "font-bold" : "font-semibold"}`}>{title}</Text>
        {count !== undefined ? <Text className="text-[13px] tabular-nums text-soft">{count}</Text> : null}
        {on ? <CaretDownIcon size={16} color={c.accent} weight="bold" /> : <CaretRightIcon size={16} color={c.muted} weight="bold" />}
      </Pressable>
      {on ? (
        <View className="border-t border-line px-4">
          {children}
          <CloseRow onPress={onToggle} />
        </View>
      ) : null}
    </View>
  );
}

/** The number circle of a step card. */
export const StepNumber = ({ n, on }: { n: number; on: boolean }) => (
  <View className={`h-[28px] w-[28px] items-center justify-center rounded-full ${on ? "bg-accent" : "bg-tint"}`}>
    <Text className={`text-[13px] font-bold ${on ? "text-onaccent" : "text-accentink"}`}>{n}</Text>
  </View>
);
