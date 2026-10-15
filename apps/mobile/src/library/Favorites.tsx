import { useRouter } from "expo-router";
import { ScrollView, View } from "react-native";

import { entries, useLibrary, type Entry } from "@/lib/library";
import { useFavorites } from "@/lib/stored";
import { t } from "@/strings/fr";
import { Body, Heading, Muted, SURFACE_STYLE } from "@/ui/ui";

import { CARD, ProtocolRow } from "./ProtocolRow";

/** Favoris: the starred fiches. They are part of the library kept on the device, so they open offline. */
export function FavoritesScreen() {
  const router = useRouter();
  const { data } = useLibrary();
  const { ids } = useFavorites();
  const all = entries(data);
  const fiches = ids.map((id) => all.find((e) => e.id === id)).filter((e): e is Entry => !!e).sort((a, b) => a.fiche.meta.title.localeCompare(b.fiche.meta.title, "fr"));
  return (
    <ScrollView className="flex-1">
      <View className="mx-auto w-full max-w-[760px] gap-[18px] px-5 pb-10 pt-5">
        <View className="gap-1">
          <Heading className="text-[28px] leading-[34px]" style={{ letterSpacing: -0.56 }}>{t("tab_favorites")}</Heading>
          {fiches.length > 0 ? <Muted className="text-[13px]">{t("favorites_offline")}</Muted> : null}
        </View>
        {fiches.length === 0 ? (
          <View className="gap-1 px-1 py-2">
            <Body className="text-[15px] font-medium">{t("favorites_empty")}</Body>
            <Muted className="text-[13px] leading-[19px]">{t("favorites_empty_hint")}</Muted>
          </View>
        ) : (
          <View className={CARD} style={SURFACE_STYLE}>
            {fiches.map((e, i) => (
              <ProtocolRow key={e.id} entry={e} first={i === 0} star onPress={() => router.push(`/fiche/${e.id}`)} />
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}
