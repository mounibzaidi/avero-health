import type { Fiche } from "@medguides/schema";
import { Linking, Pressable, Text, View } from "react-native";

import { t } from "@/strings/fr";
import { CheckCircleIcon, FilePdfIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Body, SURFACE_STYLE } from "@/ui/ui";

import { CARD } from "./parts";

/** The source column of the wide layout: who wrote it, the document, the way to the original. */
export function SourceCard({ fiche }: { fiche: Fiche }) {
  const c = useColors();
  const src = fiche.meta.sources[0];
  const kv = (k: string, v: string) =>
    v.length > 28 ? (
      <View key={k} className="gap-[3px] border-t border-line py-[9px]">
        <Text className="text-[13px] text-muted">{k}</Text>
        <Body className="text-[13px] font-medium leading-[18px]">{v}</Body>
      </View>
    ) : (
      <View key={k} className="flex-row items-start justify-between gap-4 border-t border-line py-[9px]">
        <Text className="text-[13px] text-muted">{k}</Text>
        <Body className="flex-1 text-end text-[13px] font-medium">{v}</Body>
      </View>
    );
  const lang = src?.language && src.language !== "fr" ? (src.language === "en" ? t("lang_en") : src.language) : null;
  return (
    <View className={`${CARD} p-[18px]`} style={SURFACE_STYLE}>
      <Text className="pb-[10px] text-[13px] font-medium text-soft">{t("source_title")}</Text>
      {src ? kv(t("org_label"), src.citation) : null}
      {src ? kv(t("document_label"), src.title) : null}
      {lang ? kv(t("language_label"), lang) : null}
      {src?.licence ? kv(t("license_label"), src.licence) : null}
      {kv(t("version_label"), `v${fiche.meta.version}`)}
      <View className="gap-2 pt-[14px]">
        {src?.url ? (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(src.url!)} className="btn-primary h-[45px] flex-row items-center justify-center gap-[7px] rounded-button bg-btn">
            <FilePdfIcon size={16} color="#FFFFFF" />
            <Text className="text-[14px] font-medium text-btnink">{t("original_source")}</Text>
          </Pressable>
        ) : null}
        <View className="flex-row items-center justify-center gap-[6px] pt-1">
          <CheckCircleIcon size={14} color={c.accent} weight="fill" />
          <Text className="text-[12px] text-soft">{t("available_offline")}</Text>
        </View>
      </View>
    </View>
  );
}
