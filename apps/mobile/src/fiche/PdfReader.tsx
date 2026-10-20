import { useEffect } from "react";
import { Linking, Pressable, Text, View } from "react-native";

import { t } from "@/strings/fr";

/** On a phone build pdf.js does not run: the PDF opens in the phone's own viewer, at its first page. The web build
 * draws it in the app (PdfReader.web.tsx). */
export function PdfReader({ url, onPages }: { url: string; page: number; width: number; quote: string; onPages: (n: number) => void }) {
  useEffect(() => onPages(0), [onPages]);
  return (
    <View className="items-start gap-3 p-5">
      <Text className="text-[14px] leading-[20px] text-soft">{t("r_native")}</Text>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(url)} className="min-h-11 justify-center rounded-button bg-btn px-4 active:opacity-80">
        <Text className="text-[14px] font-semibold text-btnink">{t("r_open")}</Text>
      </Pressable>
    </View>
  );
}
