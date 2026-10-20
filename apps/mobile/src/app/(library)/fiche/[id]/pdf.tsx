import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { pdfUrl, usePdfPaths } from "@/fiche/pdfs";
import { PdfReader } from "@/fiche/PdfReader";
import { useLibrary } from "@/lib/library";
import { t } from "@/strings/fr";
import { CaretLeftIcon, CaretRightIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";

/** A source's PDF inside the app, open at the cited page with the quote marked; pages turn with the arrows. */
export default function PdfRoute() {
  const { id, source, page, q } = useLocalSearchParams<{ id: string; source: string; page?: string; q?: string }>();
  const router = useRouter();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { data } = useLibrary();
  const fiche = id ? data?.fiches[id]?.content : undefined;
  const src = fiche?.sources.find((s) => s.id === source);
  const offset = src?.page_offset ?? 0; // PDF page = printed page + offset
  const paths = usePdfPaths(id ?? "");
  const path = source ? paths[source] : undefined;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [printed, setPrinted] = useState(Number(page) || 1);
  const [count, setCount] = useState(0);
  const onPages = useCallback((n: number) => setCount(n), []);

  useEffect(() => {
    if (!path) return;
    void pdfUrl(path).then(setUrl, () => setFailed(true));
  }, [path]);

  const pdfPage = printed + offset;
  const turn = (d: number) => setPrinted((p) => Math.min(Math.max(1 - offset, p + d), count ? count - offset : p + d));
  const back = () => (router.canGoBack() ? router.back() : router.replace(`/fiche/${id}`));
  const showQuote = Number(page) === printed ? q ?? "" : "";

  return (
    <View className="flex-1 bg-panel" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <Pressable accessibilityRole="button" accessibilityLabel={t("r_back")} onPress={back} className="h-11 w-11 items-center justify-center rounded-full active:opacity-60">
          <CaretLeftIcon size={20} color={c.accent} weight="bold" />
        </Pressable>
        <View className="min-w-0 flex-1">
          <Text className="text-[13px] font-bold text-ink" numberOfLines={1}>{src?.organisation ?? ""}</Text>
          <Text className="text-[12px] text-soft" numberOfLines={1}>{src?.title ?? ""}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("r_prev")} disabled={pdfPage <= 1} onPress={() => turn(-1)}
          className={`h-11 w-11 items-center justify-center rounded-full active:opacity-60 ${pdfPage <= 1 ? "opacity-30" : ""}`}>
          <CaretLeftIcon size={18} color={c.ink} />
        </Pressable>
        <Text className="min-w-12 text-center text-[13px] font-semibold tabular-nums text-ink">{t("f_page", { p: printed })}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={t("r_next")} disabled={!!count && pdfPage >= count} onPress={() => turn(1)}
          className={`h-11 w-11 items-center justify-center rounded-full active:opacity-60 ${count && pdfPage >= count ? "opacity-30" : ""}`}>
          <CaretRightIcon size={18} color={c.ink} />
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 + insets.bottom }}>
        {failed || (paths && source && !path && Object.keys(paths).length > 0) ? (
          <Text className="p-5 text-[14px] text-soft">{t("r_error")}</Text>
        ) : url ? (
          <PdfReader url={url} page={pdfPage} width={Math.min(width - 24, 900)} quote={showQuote} onPages={onPages} />
        ) : (
          <Text className="p-5 text-[14px] text-muted">{t("r_loading")}</Text>
        )}
      </ScrollView>
    </View>
  );
}
