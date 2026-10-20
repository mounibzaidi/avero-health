import { useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { View } from "react-native";

import { FicheScreen } from "@/fiche/FicheScreen";
import { useLibrary } from "@/lib/library";
import { useRecent } from "@/lib/stored";
import { t } from "@/strings/fr";
import { Muted } from "@/ui/ui";

export default function FicheRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, loading } = useLibrary();
  const { add } = useRecent();
  const fiche = id ? data?.fiches[id]?.content : undefined;
  useEffect(() => {
    if (fiche && id) add(id);
  }, [fiche, id, add]);
  if (!fiche)
    return (
      <View className="flex-1 items-center justify-center bg-bg px-5">
        <Muted className="text-[14px]">{loading ? t("loading") : t("fiche_missing")}</Muted>
      </View>
    );
  return <FicheScreen key={id} id={id!} fiche={fiche} />;
}
