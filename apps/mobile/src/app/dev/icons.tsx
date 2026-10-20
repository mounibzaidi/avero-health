import { ScrollView, Text, View } from "react-native";

import { HospitalMedIcon, type MedIcon, MedicinesIcon, SPECIALTY_ICONS, StethoscopeMedIcon } from "@/ui/MedIcons";
import { useColors } from "@/ui/theme";
import { Heading, Muted } from "@/ui/ui";

/** Every medical icon (Health Icons) the app uses, at the sizes it uses them. Dev only. */

const SECTIONS: [string, MedIcon][] = [["Évaluer", StethoscopeMedIcon], ["Traiter", MedicinesIcon], ["Orienter et suivre", HospitalMedIcon]];

function Row({ label, Icon }: { label: string; Icon: MedIcon }) {
  const c = useColors();
  return (
    <View className="flex-row items-center gap-4 border-t border-line py-3">
      <View className="h-[46px] w-[46px] items-center justify-center rounded-full bg-tint"><Icon size={20} color={c.accent} /></View>
      <View className="h-12 w-12 items-center justify-center rounded-[13px] bg-tint"><Icon size={30} color={c.accent} /></View>
      <Icon size={15} color={c.soft} />
      <Text className="min-w-0 flex-1 text-[14px] text-ink">{label}</Text>
    </View>
  );
}

export default function IconsScreen() {
  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="mx-auto w-full max-w-[720px] gap-6 px-5 py-8">
      <View className="gap-1">
        <Heading className="text-[24px]">Icônes médicales</Heading>
        <Muted className="text-[13px]">Health Icons (CC0), contour 24 px. Tuile d&apos;accueil 20 px, grande 30 px, en-tête de fiche 15 px.</Muted>
      </View>
      <View>
        <Text className="pb-2 text-[13px] font-bold uppercase text-muted">Spécialités</Text>
        {SPECIALTY_ICONS.map(([label, Icon]) => <Row key={label} label={label} Icon={Icon} />)}
      </View>
      <View>
        <Text className="pb-2 text-[13px] font-bold uppercase text-muted">Sections de la fiche</Text>
        {SECTIONS.map(([label, Icon]) => <Row key={label} label={label} Icon={Icon} />)}
      </View>
    </ScrollView>
  );
}
