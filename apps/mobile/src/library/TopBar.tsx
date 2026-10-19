import { useRouter } from "expo-router";
import { Pressable, Text, useWindowDimensions, View } from "react-native";

import { breakpoint } from "@avero/ui-tokens";

import { t } from "@/strings/fr";
import { PillIcon, StarIcon, UserIcon } from "@/ui/Icons";
import { Logo } from "@/ui/Logo";
import { useColors } from "@/ui/theme";
import { CONTROL_STYLE } from "@/ui/ui";

/** Library top bar: the brand on the left; on wide screens (no tab bar) Favoris; the account on the right. */
export function TopBar() {
  const router = useRouter();
  const c = useColors();
  const { width } = useWindowDimensions();
  return (
    <View className="z-20 h-[74px] w-full flex-row items-center justify-between px-5 md:px-8">
      <Pressable accessibilityRole="link" onPress={() => router.push("/")}>
        <Logo />
      </Pressable>
      <View className="flex-1" />
      {width >= breakpoint.library ? (
        <Pressable accessibilityRole="link" onPress={() => router.push("/medicaments")} className="h-[34px] flex-row items-center gap-[6px] rounded-full px-3 hover:bg-surface">
          <PillIcon size={16} color={c.soft} />
          <Text className="text-[13px] font-medium text-soft">{t("meds_title")}</Text>
        </Pressable>
      ) : null}
      {width >= breakpoint.library ? (
        <Pressable accessibilityRole="link" onPress={() => router.push("/favoris")} className="me-3 h-[34px] flex-row items-center gap-[6px] rounded-full px-3 hover:bg-surface">
          <StarIcon size={16} color={c.soft} />
          <Text className="text-[13px] font-medium text-soft">{t("tab_favorites")}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="link" accessibilityLabel={t("account")} onPress={() => router.push("/profil")} style={CONTROL_STYLE}
        className="h-[34px] w-[34px] items-center justify-center rounded-full border border-edge/[0.08] bg-surface hover:border-edge/20">
        <UserIcon size={16} color={c.soft} />
      </Pressable>
    </View>
  );
}
