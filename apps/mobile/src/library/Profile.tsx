import { ScrollView, View } from "react-native";

import { t } from "@/strings/fr";
import { useTheme } from "@/ui/theme";
import { Heading, Muted, Segments } from "@/ui/ui";

/** Profil: the theme for now. The account joins it with sign-in (step 9). */
export function ProfileScreen() {
  const { theme, setTheme } = useTheme();
  return (
    <ScrollView className="flex-1">
      <View className="mx-auto w-full max-w-[760px] gap-[18px] px-5 pb-10 pt-5">
        <Heading className="text-[28px] leading-[34px]" style={{ letterSpacing: -0.56 }}>{t("tab_profile")}</Heading>
        <View className="gap-2">
          <Muted className="ps-1 text-[13px] font-medium text-soft">{t("appearance")}</Muted>
          <Segments labels={[t("theme_light"), t("theme_dark")]} value={theme === "dark" ? 1 : 0} onChange={(i) => setTheme(i ? "dark" : "light")} />
        </View>
      </View>
    </ScrollView>
  );
}
