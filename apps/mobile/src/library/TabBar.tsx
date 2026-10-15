import { usePathname, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { t } from "@/strings/fr";
import { HouseIcon, PillIcon, StarIcon, UserIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";

/** The bottom tab bar of the library on phones: Accueil, Médicaments, Favoris, Profil. */
export function TabBar() {
  const router = useRouter();
  const path = usePathname();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const tabs = [
    { href: "/", label: t("tab_home"), Icon: HouseIcon, on: path === "/" },
    { href: "/medicaments", label: t("meds_title"), Icon: PillIcon, on: path === "/medicaments" },
    { href: "/favoris", label: t("tab_favorites"), Icon: StarIcon, on: path === "/favoris" },
    { href: "/profil", label: t("tab_profile"), Icon: UserIcon, on: path === "/profil" },
  ] as const;
  return (
    <View accessibilityRole="tablist" className="flex-row border-t border-edge/[0.06] bg-bg" style={{ paddingBottom: insets.bottom }}>
      {tabs.map(({ href, label, Icon, on }) => (
        <Pressable key={href} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => router.navigate(href)}
          className="min-h-[54px] flex-1 items-center justify-center gap-[3px] active:opacity-60">
          <Icon size={21} color={on ? c.accent : c.muted} weight={on ? "fill" : "regular"} />
          <Text className={`text-[11px] font-medium ${on ? "text-accent" : "text-muted"}`}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}
