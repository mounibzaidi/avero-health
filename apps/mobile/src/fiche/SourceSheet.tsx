import type { Fiche } from "@medguides/schema";
import { fixed, shadow } from "@medguides/ui-tokens";
import { useEffect } from "react";
import { BackHandler, Linking, Platform, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { t } from "@/strings/fr";
import { FilePdfIcon, XIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Body, joinMeta, Muted } from "@/ui/ui";

import type { Cited } from "./model";

/** Bottom sheet for a tapped line: its page, the source's own words, the source, and the way to the original. */
export function SourceSheet({ fiche, cited, onClose }: { fiche: Fiche; cited: Cited; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const ref = cited.source;
  const src = fiche.meta.sources.find((s) => s.source_id === ref?.source_id) ?? fiche.meta.sources[0];
  const link = src?.url ? (ref && /\.pdf($|[?#])/i.test(src.url) ? `${src.url.split("#")[0]}#page=${ref.page}` : src.url) : null;

  // Android back closes the sheet (no BackHandler on the web).
  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => (onClose(), true));
    return () => sub.remove();
  }, [onClose]);

  return (
    <Pressable accessibilityLabel={t("close_sheet")} onPress={onClose} className="absolute inset-0 z-20 items-center justify-end" style={{ backgroundColor: fixed.scrim }}>
      <Pressable accessibilityViewIsModal onPress={() => {}} className="w-full max-w-[440px] gap-4 rounded-t-[20px] bg-surface px-5 pt-[10px]"
        style={{ paddingBottom: 28 + insets.bottom, boxShadow: shadow.sheet }}>
        <View className="h-1 w-9 self-center rounded-sm bg-edge/[0.15]" />
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1 gap-[2px]">
            {ref ? <Text className="text-[12px] font-semibold text-accentink">{t("source_page", { p: ref.page_end ? `${ref.page}-${ref.page_end}` : ref.page })}</Text> : null}
            {cited.origin === "local_adaptation" ? <Text className="text-[12px] font-semibold text-caution">{t("local_adaptation", { name: cited.reviewer ?? "" })}</Text> : null}
            {src ? <Body className="text-[15px] font-semibold">{src.citation}</Body> : null}
            {src ? <Body className="text-[13px] leading-[18px] text-soft">{joinMeta([src.title])}</Body> : null}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("close_sheet")} onPress={onClose} className="h-8 w-8 items-center justify-center rounded-full bg-line hover:opacity-80">
            <XIcon size={15} color={c.ink} />
          </Pressable>
        </View>
        {ref?.quote ? (
          <View className="border-s-2 border-accent py-[2px] ps-[14px]">
            <Body className="text-[15px] leading-[24px]">« {ref.quote} »</Body>
          </View>
        ) : null}
        {cited.translated ? <Muted className="text-[12px]">{src?.language === "en" ? t("translated_from_en") : t("translated_from_source")}</Muted> : null}
        {link ? (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(link)} className="h-11 flex-row items-center justify-center gap-2 rounded-action bg-tint hover:opacity-85 active:opacity-70">
            <FilePdfIcon size={17} color={c.accentink} />
            <Text className="text-[14px] font-semibold text-accentink">{t("original_source")}</Text>
          </Pressable>
        ) : null}
      </Pressable>
    </Pressable>
  );
}
