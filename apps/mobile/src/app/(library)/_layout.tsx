import { breakpoint } from "@avero/ui-tokens";
import { Slot, usePathname } from "expo-router";
import { useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TabBar } from "@/library/TabBar";
import { TopBar } from "@/library/TopBar";

/** The library. Search, favourites and profile sit under a slim top bar; home brings its own header on
 * phones, and a fiche brings its own chrome. Phones keep the tab bar at the bottom of every screen. */
export default function LibraryLayout() {
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const { width } = useWindowDimensions();
  const phone = width < breakpoint.library;
  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: path.startsWith("/fiche/") ? 0 : insets.top }}>
      {!path.startsWith("/fiche/") && !(phone && (path === "/" || path === "/profil")) && <TopBar />}
      <View className="min-h-0 flex-1">
        <Slot />
      </View>
      {phone && <TabBar />}
    </View>
  );
}
