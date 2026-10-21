import { AVAILABILITY_LABEL, PHASE_LABEL, PRESCRIBER_LABEL, type Medication } from "@avero/schema";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { productsForInn, useMedicaments } from "@/lib/medicaments";
import { t } from "@/strings/fr";
import { Body, SURFACE_STYLE } from "@/ui/ui";

import { CARD, Cites } from "./parts";

/**
 * The fiche names the INN only; the products are the register's, on request (from the copy on the device), whatever
 * brands the fiche picked. The picked ones are listed only when the register has nothing under that INN. A status set
 * for Algeria other than registered (withdrawn, not renewed, no presentation) is shown as it is; none set, no line.
 */
function Brands({ m }: { m: Medication }) {
  const [open, setOpen] = useState(false);
  const { data } = useMedicaments();
  const { brands, status } = m.local_availability;
  const products = useMemo(() => (data ? productsForInn(data.products, m.inn) : []), [data, m.inn]);
  const warn = status && status !== "enregistre" ? <Text className="text-[12.5px] leading-[18px] text-caution">{t("f_dz", { s: AVAILABILITY_LABEL[status] })}</Text> : null;
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

/** Doses in French: 1.2 = "1,2", no trailing zeros. */
const NUM = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 });
const blank = (s: string | null) => !s || !s.trim();
/** First letter up, the rest as stored ("acide tranexamique" -> "Acide tranexamique"). */
const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "10 mg/kg orale, 2 fois par jour, 7 jours" from the fields that are given; null when none is. The app shows no
 * gap: what the sources do not give is left out (the editor marks it to complete). */
function doseText(m: Medication): string | null {
  const dose = m.dose != null ? `${NUM.format(m.dose)}${blank(m.dose_unit) ? "" : ` ${m.dose_unit!.trim()}`}${m.dose_basis === "par_kg" ? "/kg" : ""}` : null;
  const first = [dose, blank(m.route) ? null : m.route!.trim()].filter(Boolean).join(" ");
  const parts = [first, m.frequency, m.duration].filter((x): x is string => !blank(x)).map((x) => x.trim());
  return parts.length ? parts.join(", ") : null;
}

function MedicationRow({ m, first }: { m: Medication; first: boolean }) {
  const dose = doseText(m);
  const hosp = m.prescriber === "hopital";
  return (
    <View className={`gap-[5px] py-3 ${first ? "" : "border-t border-line"}`}>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text className="text-[15px] font-bold text-ink">{sentence(m.inn)}</Text>
        {m.phase ? <Text className="text-[12.5px] text-soft">{PHASE_LABEL[m.phase]}</Text> : null}
        {m.prescriber ? (
          <View className={`rounded-full px-2 py-[2px] ${hosp ? "bg-cautionbg" : "bg-tint"}`}>
            <Text className={`text-[11px] font-semibold ${hosp ? "text-caution" : "text-accentink"}`}>{PRESCRIBER_LABEL[m.prescriber]}</Text>
          </View>
        ) : null}
      </View>
      {m.condition ? <Body className="text-[13px] leading-[18px] text-soft">{t("f_place", { c: m.condition })}</Body> : null}
      {dose ? <Body className="text-[14.5px] font-medium leading-[21px]">{dose}<Cites evidence={m.evidence} strength={m.strength} /></Body> : null}
      {!blank(m.max_dose) ? <Body className="text-[13px] leading-[18px] text-soft">{t("f_max_dose", { d: m.max_dose!.trim() })}</Body> : null}
      {m.adjustments.filter((a) => !blank(a)).map((a, i) => <Body key={`a${i}`} className="text-[13px] leading-[18px] text-soft">{a}</Body>)}
      {m.contraindications.some((c) => !blank(c)) ? (
        <Body className="text-[13px] leading-[18px] text-flag">{t("f_contra", { c: m.contraindications.filter((c) => !blank(c)).join(" ; ") })}</Body>
      ) : null}
      <Brands m={m} />
      {dose ? null : <Body className="text-[11.5px] leading-[16px]"><Cites evidence={m.evidence} strength={m.strength} /></Body>}
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
