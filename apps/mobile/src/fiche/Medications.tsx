import { AVAILABILITY_LABEL, doseLine, PHASE_LABEL, PRESCRIBER_LABEL, TO_COMPLETE, type Medication } from "@avero/schema";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { productsForInn, useMedicaments } from "@/lib/medicaments";
import { t } from "@/strings/fr";
import { Body, SURFACE_STYLE } from "@/ui/ui";

import { CARD, Cites } from "./parts";

/**
 * The fiche names the INN only; the products are the register's, on request (from the copy on the device), whatever
 * brands the fiche picked. The picked ones are listed only when the register has nothing under that INN. The status
 * for Algeria shows when it is not "registered": as it is (withdrawn, not renewed, no presentation), or "[à compléter]"
 * when it was never set.
 */
function Brands({ m }: { m: Medication }) {
  const [open, setOpen] = useState(false);
  const { data } = useMedicaments();
  const { brands, status } = m.local_availability;
  const products = useMemo(() => (data ? productsForInn(data.products, m.inn) : []), [data, m.inn]);
  const warn = status !== "enregistre" ? <Text className="text-[12.5px] leading-[18px] text-caution">{t("f_dz", { s: status ? AVAILABILITY_LABEL[status] : TO_COMPLETE })}</Text> : null;
  const n = products.length || brands.length;
  if (!n) return warn;
  return (
    <View className="gap-1">
      {warn}
      <Pressable accessibilityRole="button" onPress={() => setOpen(!open)} className="min-h-8 justify-center self-start active:opacity-60">
        <Text className="text-[12.5px] font-semibold text-accent">{open ? t("f_see_less") : t("f_dz_list", { n })}</Text>
      </Pressable>
      {open && products.length ? products.map((p, i) => (
        <Text key={`${p.brand}-${p.code ?? i}`} className="text-[12.5px] leading-[18px] text-soft">
          <Text className="font-semibold text-ink">{p.brand}</Text> {[p.form, p.dosage].filter(Boolean).join(" ").toLowerCase()} · {PRESCRIBER_LABEL[p.hospital ? "hopital" : "officine"]}
        </Text>
      )) : null}
      {open && !products.length ? brands.map((b) => <Text key={b} className="text-[12.5px] font-semibold leading-[18px] text-ink">{b}</Text>) : null}
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
        <View className={`rounded-full px-2 py-[2px] ${hosp || !m.prescriber ? "bg-cautionbg" : "bg-tint"}`}>
          <Text className={`text-[11px] font-semibold ${hosp || !m.prescriber ? "text-caution" : "text-accentink"}`}>{m.prescriber ? PRESCRIBER_LABEL[m.prescriber] : TO_COMPLETE}</Text>
        </View>
      </View>
      {m.condition ? <Body className="text-[13px] leading-[18px] text-soft">{t("f_if", { c: m.condition })}</Body> : null}
      <Body className="text-[14.5px] font-medium leading-[21px]">{doseLine(m)}<Cites evidence={m.evidence} strength={m.strength} /></Body>
      {m.max_dose || m.missing.includes("max_dose") ? <Body className="text-[13px] leading-[18px] text-soft">{t("f_max_dose", { d: m.max_dose || TO_COMPLETE })}</Body> : null}
      {m.adjustments.map((a, i) => <Body key={`a${i}`} className="text-[13px] leading-[18px] text-soft">{a}</Body>)}
      {m.contraindications.length || m.missing.includes("contraindications") ? (
        <Body className="text-[13px] leading-[18px] text-flag">{t("f_contra", { c: m.contraindications.join(" ; ") || TO_COMPLETE })}</Body>
      ) : null}
      <Brands m={m} />
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
