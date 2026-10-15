import { Pressable } from "react-native";

import { useFavorites } from "@/lib/stored";
import { t } from "@/strings/fr";
import { StarIcon } from "@/ui/Icons";
import { useColors } from "@/ui/theme";

export function StarButton({ id }: { id: string }) {
  const c = useColors();
  const { ids, toggle } = useFavorites();
  const on = ids.includes(id);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={on ? t("favorite_remove") : t("favorite_add")} accessibilityState={{ selected: on }}
      onPress={() => toggle(id)} className="h-11 w-11 items-center justify-center rounded-full active:opacity-60">
      <StarIcon size={20} color={on ? c.accent : c.muted} weight={on ? "fill" : "regular"} />
    </Pressable>
  );
}
