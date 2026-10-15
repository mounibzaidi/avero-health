import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { t } from "@/strings/fr";
import { CaretDownIcon, CaretRightIcon, PillIcon, WarningIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Body, SURFACE_STYLE } from "@/ui/ui";

import type { DoseView } from "./model";
import { CARD, Row, Rows, Segments, type Open } from "./parts";

const FIELD: Record<string, string> = {
  dose: t("p_dose_missing"),
  route: t("p_route"),
  administration: t("p_administration"),
  frequency_or_duration: t("p_duration"),
  duree_frequence: t("p_duration"),
};

/** An infusion switch: lines of one variant_group, one shown at a time (Q22). */
function Variant({ lines, open }: { lines: DoseView["variants"][number]["lines"]; open: Open }) {
  const [shown, setShown] = useState(0);
  const line = lines[Math.min(shown, lines.length - 1)];
  return (
    <View className="gap-1">
      {lines.length > 1 ? <Segments dense={lines.length > 3} labels={lines.map((l) => l.condition ?? l.id)} value={shown} onChange={setShown} /> : null}
      <Row line={{ ...line, type: "info" }} open={open} first className="text-[14px] font-semibold leading-[20px] text-ink" />
    </View>
  );
}

/** One dose, closed: drug and role, the dose, the duration and the red limits. "Détails" opens the rest;
 * the brands registered in Algeria are one line; what the source lacks is an amber icon. */
export function Dose({ d, open }: { d: DoseView; open: Open }) {
  const c = useColors();
  const p = d.pos;
  const [detailed, setDetailed] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const cite = () => open({ source: p.source, translated: p.translated });
  const facts = [
    p.route ? `${t("p_route")} : ${p.route}` : null,
    p.administration ? `${t("p_administration")} : ${p.administration}` : null,
    ...(p.titration ? Object.values(p.titration).filter(Boolean).map((v) => `${t("p_titration")} : ${v}`) : []),
  ].filter((x): x is string => !!x);
  const overdose = d.overdose.signes.length + d.overdose.conduite.length > 0;
  const hasDetails = facts.length + d.details.length + d.variants.length > 0 || overdose;
  const brands = p.algerie.brands;
  const names = [...new Set(brands.map((b) => [b.brand, b.dosage, b.hospital ? `(${t("dz_hospital")})` : ""].filter(Boolean).join(" ")))];
  const flags = [...(p.missing.length ? [t("p_missing_fields", { f: p.missing.map((m) => FIELD[m] ?? m).join(", ") })] : []), ...(p.note ? [p.note] : [])];
  const caret = (on: boolean, color: string) => (on ? <CaretDownIcon size={11} color={color} weight="bold" /> : <CaretRightIcon size={11} color={color} weight="bold" />);
  return (
    <View className={`overflow-hidden ${CARD}`} style={SURFACE_STYLE}>
      <View className="flex-row items-center gap-2 bg-tint/60 py-[2px] pe-1 ps-4">
        <PillIcon size={15} color={c.accentink} weight="bold" />
        <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-x-2 gap-y-[2px] py-[6px]">
          <Body className="max-w-full shrink text-[14px] font-semibold leading-[19px] text-accentink">{p.drug_dci}</Body>
          {p.condition ? <Text className="max-w-full shrink text-[10.5px] font-bold uppercase leading-[15px] text-accentink" style={{ letterSpacing: 0.6 }}>{p.condition}</Text> : null}
        </View>
        {flags.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t("p_source_flag")} accessibilityState={{ expanded: flagOpen }} onPress={() => setFlagOpen(!flagOpen)}
            className="h-11 w-11 items-center justify-center active:opacity-60">
            <WarningIcon size={17} color={c.caution} weight="fill" />
          </Pressable>
        ) : (
          <View className="h-11 w-3" />
        )}
      </View>
      <View className="gap-[9px] px-4 pb-[2px] pt-[14px]">
        <Pressable accessibilityHint={t("tap_line_hint")} onPress={cite} className="flex-row flex-wrap items-center gap-x-3 gap-y-1 active:opacity-70">
          <View className="max-w-full shrink rounded-md bg-panel px-[9px] py-[5px]">
            {!p.dose.trim() ? (
              <Text className="text-[14px] font-semibold leading-[20px] text-caution">{t("p_dose_missing")}</Text>
            ) : /\d/.test(p.dose) ? (
              <Body className="font-mono text-[17px] font-bold leading-[23px]">{p.dose}</Body>
            ) : (
              <Body className="text-[14px] font-semibold leading-[20px]">{p.dose}</Body>
            )}
          </View>
          {p.frequency_or_duration ? <Body className="text-[13px] leading-[19px] text-soft">{`${t("p_duration")} : ${p.frequency_or_duration}`}</Body> : null}
        </Pressable>
        {p.dose_max || d.red.length ? (
          <View className="rounded-inner bg-flagbg px-3">
            {p.dose_max ? (
              <Pressable onPress={cite} className="py-3 active:opacity-70">
                <Text className="text-[13px] font-semibold leading-[19px] text-flag">{`${t("p_dose_max")} : ${p.dose_max}`}</Text>
              </Pressable>
            ) : null}
            {d.red.map((l, i) => (
              <Row key={l.id} line={l} open={open} first={!p.dose_max && i === 0} rule="border-flag/10" className="text-[13px] font-semibold leading-[19px] text-flag" />
            ))}
          </View>
        ) : null}
        {flagOpen
          ? flags.map((note, i) => (
              <View key={i} className="rounded-inner bg-cautionbg px-3 py-[9px]">
                <Body className="text-[12.5px] leading-[18px] text-ink">{note}</Body>
              </View>
            ))
          : null}
        {detailed ? (
          <View className="gap-2">
            {facts.map((f) => (
              <Pressable key={f} onPress={cite} className="active:opacity-70">
                <Body className="text-[13px] leading-[19px] text-soft">{f}</Body>
              </Pressable>
            ))}
            {d.details.length ? <Rows lines={d.details} open={open} className="text-[13px] leading-[19px] text-soft" /> : null}
            {d.variants.map((v) => <Variant key={v.group} lines={v.lines} open={open} />)}
            {overdose ? (
              <View className="gap-1 rounded-inner bg-cautionbg px-3 pb-1 pt-[10px]">
                <Text className="text-[12px] font-bold text-caution">{t("p_overdose")}</Text>
                {d.overdose.signes.length > 0 ? <Rows lines={d.overdose.signes} open={open} rule="border-caution/15" className="text-[13px] leading-[19px] text-ink" /> : null}
                {d.overdose.conduite.length > 0 ? (
                  <View className={d.overdose.signes.length ? "border-t border-caution/15 pt-[10px]" : ""}>
                    <Text className="text-[11px] font-bold uppercase text-caution" style={{ letterSpacing: 0.6 }}>{t("p_overdose_do")}</Text>
                    <Rows lines={d.overdose.conduite} open={open} rule="border-caution/15" className="text-[13px] font-medium leading-[19px] text-ink" />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
        {brandsOpen ? <Body className="text-[12px] leading-[17px] text-soft">{names.join("\n")}</Body> : null}
        <View className="flex-row flex-wrap items-center justify-between gap-x-4">
          {hasDetails ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailed }} onPress={() => setDetailed(!detailed)} className="min-h-11 flex-row items-center gap-[6px] active:opacity-60">
              <Text className="text-[13px] font-semibold text-accent">{t("p_details")}</Text>
              {caret(detailed, c.accent)}
            </Pressable>
          ) : (
            <View />
          )}
          {names.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: brandsOpen }} onPress={() => setBrandsOpen(!brandsOpen)} className="min-h-11 flex-row items-center gap-[6px] active:opacity-60">
              <Text className="text-[12px] font-medium text-soft">{names.length > 1 ? t("p_dz_brands_n", { n: names.length }) : t("p_dz_brands_one")}</Text>
              {caret(brandsOpen, c.soft)}
            </Pressable>
          ) : p.algerie.statut ? (
            <Text className="py-3 text-[12px] text-caution">{t("p_dz_brands_none")}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}
