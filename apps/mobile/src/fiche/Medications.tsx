import { AVAILABILITY_LABEL, doseLine, PHASE_LABEL, PRESCRIBER_LABEL, TO_COMPLETE, type Medication } from "@avero/schema";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { t } from "@/strings/fr";
import { Body, SURFACE_STYLE } from "@/ui/ui";

import { CARD, Tag } from "./parts";

const BRANDS_SHOWN = 5;

function Brands({ m }: { m: Medication }) {
  const [all, setAll] = useState(false);
  const { brands, status } = m.local_availability;
  if (!brands.length) {
    return status ? <Text className="text-[12.5px] leading-[18px] text-caution">{t("f_dz", { s: AVAILABILITY_LABEL[status] })}</Text> : null;
  }
  const shown = all ? brands : brands.slice(0, BRANDS_SHOWN);
  return (
    <View className="flex-row flex-wrap items-baseline gap-x-1">
      <Text className="text-[12.5px] leading-[18px] text-soft">
        {t("f_dz_brands")} {shown.join(", ")}
        {status && status !== "enregistre" ? ` (${AVAILABILITY_LABEL[status]})` : ""}
      </Text>
      {brands.length > BRANDS_SHOWN ? (
        <Pressable accessibilityRole="button" onPress={() => setAll(!all)} className="min-h-8 justify-center active:opacity-60">
          <Text className="text-[12.5px] font-semibold text-accent">{all ? t("f_see_less") : t("f_see_all", { n: brands.length })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function MedicationRow({ m, first }: { m: Medication; first: boolean }) {
  const hosp = m.prescriber === "hopital";
  return (
    <View className={`gap-[5px] py-3 ${first ? "" : "border-t border-line"}`}>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-[15px] font-bold capitalize text-ink">{m.inn}</Text>
        {m.phase ? <Text className="text-[12.5px] text-soft">{PHASE_LABEL[m.phase]}</Text> : null}
        {m.prescriber ? (
          <View className={`rounded-full px-2 py-[2px] ${hosp ? "bg-cautionbg" : "bg-tint"}`}>
            <Text className={`text-[11px] font-semibold ${hosp ? "text-caution" : "text-accentink"}`}>{PRESCRIBER_LABEL[m.prescriber]}</Text>
          </View>
        ) : null}
      </View>
      {m.condition ? <Body className="text-[13px] leading-[18px] text-soft">{t("f_if", { c: m.condition })}</Body> : null}
      <Body className="text-[14.5px] font-medium leading-[21px]">{doseLine(m)}</Body>
      {m.max_dose || m.missing.includes("max_dose") ? <Body className="text-[13px] leading-[18px] text-soft">{t("f_max_dose", { d: m.max_dose || TO_COMPLETE })}</Body> : null}
      {m.adjustments.map((a, i) => <Body key={`a${i}`} className="text-[13px] leading-[18px] text-soft">{a}</Body>)}
      {m.contraindications.length || m.missing.includes("contraindications") ? (
        <Body className="text-[13px] leading-[18px] text-flag">{t("f_contra", { c: m.contraindications.join(" ; ") || TO_COMPLETE })}</Body>
      ) : null}
      <Brands m={m} />
      <Tag evidence={m.evidence} strength={m.strength} />
    </View>
  );
}

/** Medications in one card; consecutive ones of the same alternative_group are joined by "ou". */
export function Medications({ items }: { items: Medication[] }) {
  if (!items.length) return null;
  return (
    <View className={`${CARD} px-[18px] pb-[6px] pt-4`} style={SURFACE_STYLE}>
      <Text className="pb-[2px] text-[15px] font-bold text-ink">{t("f_medications")}</Text>
      {items.map((m, i) => {
        const alt = i > 0 && !!m.alternative_group && m.alternative_group === items[i - 1].alternative_group;
        return (
          <View key={m.id}>
            {alt ? <Text className="-mb-1 pt-1 text-[12px] font-bold uppercase text-muted">{t("f_or")}</Text> : null}
            <MedicationRow m={m} first={i === 0 || alt} />
          </View>
        );
      })}
    </View>
  );
}
