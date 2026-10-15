import { Pressable, View } from "react-native";

import type { Entry } from "@/lib/library";
import { t } from "@/strings/fr";
import { CaretRightIcon, IconTile } from "@/ui/Icons";
import { useColors } from "@/ui/theme";
import { Body, joinMeta, Muted } from "@/ui/ui";

import { StarButton } from "../fiche/StarButton";

export const CARD = "overflow-hidden rounded-xl border border-edge/[0.06] bg-surface";
export const subtitle = (e: Entry) => joinMeta([e.fiche.meta.specialite, e.fiche.meta.template === "urgence" ? t("urgences") : null]);

/** One protocol in a list: specialty tile, title, subtitle; a star or a caret at the end. */
export function ProtocolRow({ entry, first, star, onPress }: { entry: Entry; first: boolean; star?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} className={`flex-row items-center gap-3 p-[14px] hover:bg-bg/70 active:bg-bg ${first ? "" : "border-t border-line"}`}>
      <IconTile category={entry.fiche.meta.template === "urgence" ? "Urgences" : entry.fiche.meta.specialite} />
      <View className="min-w-0 flex-1 gap-[3px]">
        <Body className="text-[14px] font-medium">{entry.fiche.meta.title}</Body>
        <Muted className="text-[12px]">{subtitle(entry)}</Muted>
      </View>
      {star ? (
        <View className="-my-[6px] -me-[8px]">
          <StarButton id={entry.id} />
        </View>
      ) : (
        <CaretRightIcon size={16} color={c.muted} />
      )}
    </Pressable>
  );
}
