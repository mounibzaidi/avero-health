import { doseLine, PHASE_LABEL, type Medication, type Protocol } from "@avero/schema";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { entries, useLibrary } from "@/lib/library";
import { fold, groupSubstances, substanceName, useMedicaments, type Kind, type Product, type Substance } from "@/lib/medicaments";
import { t } from "@/strings/fr";
import { CaretLeftIcon, CaretRightIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Body, Heading, joinMeta, Muted, Skeleton, SURFACE_STYLE } from "@/ui/ui";

import { ListeTag } from "./Medicaments";

// A DCI as drug references show it: how it is prescribed (list, officine or hospital), then the doses Avero's own
// protocols give for it, each with its source, then every registered presentation in Algeria. No dose is written
// here that is not in a published protocol: without one, the page says so.

const KIND_LABEL: Record<Kind, string> = { RE: t("meds_ref"), GE: t("meds_generic"), BIO: t("meds_bio") };

type Use = { fiche: string; title: string; med: Medication; source: string | null };

/** The medication lines of the published protocols that are this substance: same DCI, or a brand of it. */
function usesOf(s: Substance, fiches: { id: string; fiche: Protocol }[]): Use[] {
  const brands = new Set(s.products.map((p) => fold(p.brand)));
  const out: Use[] = [];
  for (const { id, fiche } of fiches) {
    for (const med of fiche.treat.medications) {
      if (fold(med.inn) !== s.key && !med.local_availability.brands.some((b) => brands.has(fold(b)))) continue;
      const e = med.evidence[0];
      const org = e ? fiche.sources.find((x) => x.id === e.source_id)?.organisation || e.source_id : null;
      out.push({ fiche: id, title: fiche.meta.title, med, source: org ? joinMeta([org, e?.page ? t("f_page", { p: e.page }) : null]) : null });
    }
  }
  return out;
}

const CARD = "rounded-card border border-edge/[0.06] bg-surface px-[18px] py-2";

function UseRow({ u, first, onPress }: { u: Use; first: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} className={`flex-row items-center gap-3 py-3 active:opacity-70 ${first ? "" : "border-t border-line"}`}>
      <View className="min-w-0 flex-1 gap-[3px]">
        <Text className="text-[12.5px] font-semibold text-accentink">{u.title}</Text>
        {u.med.condition ? <Body className="text-[13px] leading-[18px] text-soft">{t("f_if", { c: u.med.condition })}</Body> : null}
        <Body className="text-[14.5px] font-medium leading-[21px]">{doseLine(u.med)}</Body>
        <Muted className="text-[11.5px] leading-[16px]">{joinMeta([u.med.phase ? PHASE_LABEL[u.med.phase] : null, u.source])}</Muted>
      </View>
      <CaretRightIcon size={15} color={c.muted} />
    </Pressable>
  );
}

/** One brand: its presentations (form, strength, pack), whether it is the reference or a generic, who makes it. */
function BrandRow({ brand, items, first }: { brand: string; items: Product[]; first: boolean }) {
  const p = items[0];
  return (
    <View className={`gap-[3px] py-3 ${first ? "" : "border-t border-line"}`}>
      <View className="flex-row flex-wrap items-center gap-2">
        <Body className="text-[15px] font-semibold">{brand}</Body>
        {p.kind ? <Text className={`text-[11.5px] font-semibold ${p.kind === "RE" ? "text-accentink" : "text-soft"}`}>{KIND_LABEL[p.kind]}</Text> : null}
        {items.every((x) => x.hospital) ? <Text className="text-[11.5px] text-caution">{t("meds_hospital_only")}</Text> : null}
      </View>
      {[...new Set(items.map((x) => joinMeta([x.form, x.dosage, x.pack])))].map((line) => <Body key={line} className="text-[13px] leading-[18px] text-soft">{line}</Body>)}
      <Muted className="text-[12px] leading-[17px]">{joinMeta([p.lab, p.local === true ? t("meds_local") : p.local === false ? joinMeta([t("meds_imported"), p.country]) : p.country])}</Muted>
    </View>
  );
}

export function SubstanceScreen({ id }: { id: string }) {
  const router = useRouter();
  const c = useColors();
  const { data, loading } = useMedicaments();
  const lib = useLibrary();
  const s = useMemo(() => groupSubstances(data?.products ?? []).find((x) => x.key === id), [data, id]);
  const uses = useMemo(() => (s ? usesOf(s, entries(lib.data)) : []), [s, lib.data]);
  const brands = useMemo(() => {
    const by = new Map<string, Product[]>();
    for (const p of s?.products ?? []) by.set(p.brand, [...(by.get(p.brand) ?? []), p]);
    // the reference brand first, then the generics and biosimilars, as drug references list them
    return [...by].sort(([, a], [, b]) => Number(b[0].kind === "RE") - Number(a[0].kind === "RE"));
  }, [s]);

  return (
    <ScrollView className="flex-1" contentContainerClassName="mx-auto w-full max-w-[720px] gap-6 px-5 pb-12 pt-2">
      <Pressable accessibilityRole="link" onPress={() => router.push("/medicaments")} className="min-h-11 flex-row items-center gap-[6px] self-start active:opacity-60">
        <CaretLeftIcon size={18} color={c.accent} weight="bold" />
        <Text className="text-[14px] font-semibold text-accent">{t("meds_back")}</Text>
      </Pressable>
      {!s ? (
        loading ? <Skeleton className="h-8 w-2/3" /> : <Muted className="text-[14px]">{t("meds_missing")}</Muted>
      ) : (
        <>
          <View className="gap-2">
            <Heading className="text-[26px] leading-[31px]" style={{ letterSpacing: -0.5 }}>{substanceName(s.key)}</Heading>
            <View className="flex-row flex-wrap items-center gap-2">
              {s.liste ? <ListeTag liste={s.liste} /> : null}
              <Text className={`text-[12.5px] font-medium ${s.hospitalOnly ? "text-caution" : "text-accentink"}`}>{s.hospitalOnly ? t("meds_hospital_only") : t("meds_officine")}</Text>
            </View>
          </View>

          <View className="gap-2">
            <Text className="text-[17px] font-semibold text-ink">{t("meds_in_protocols")}</Text>
            {uses.length ? (
              <View className={CARD} style={SURFACE_STYLE}>
                {uses.map((u, i) => <UseRow key={`${u.fiche}-${u.med.id}`} u={u} first={i === 0} onPress={() => router.push(`/fiche/${u.fiche}`)} />)}
              </View>
            ) : (
              <Muted className="text-[13.5px] leading-[19px]">{t("meds_no_protocol")}</Muted>
            )}
          </View>

          <View className="gap-2">
            <Text className="text-[17px] font-semibold text-ink">{t("meds_presentations")}</Text>
            <View className={CARD} style={SURFACE_STYLE}>
              {brands.map(([b, items], i) => <BrandRow key={b} brand={b} items={items} first={i === 0} />)}
            </View>
            <Muted className="px-1 text-[12px] leading-[17px]">{t("dz_source")}</Muted>
          </View>
        </>
      )}
    </ScrollView>
  );
}
