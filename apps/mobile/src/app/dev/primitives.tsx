import { Pressable, ScrollView, Text, View } from "react-native";

import * as I from "@/ui/Icons";
import { useColors, useTheme } from "@/ui/theme";
import { Body, CONTROL_STYLE, Heading, joinMeta, Muted, Skeleton, SURFACE_STYLE } from "@/ui/ui";

/** Primitives gallery (step 3). Dev only; sample text is fake. */

const ICONS = Object.entries(I).filter(([name]) => name.endsWith("Icon")) as [string, I.Icon][];
const CATEGORIES = ["Urgences", "Chronique", "Aigu", "Pédiatrie", "Femme", "Autre"];

function ThemeSwitch() {
  const { theme, setTheme } = useTheme();
  return (
    <View className="flex-row self-start rounded-full bg-panel p-1">
      {(["light", "dark"] as const).map((t) => (
        <Pressable
          key={t}
          accessibilityRole="button"
          accessibilityState={{ selected: theme === t }}
          onPress={() => setTheme(t)}
          style={theme === t ? CONTROL_STYLE : undefined}
          className={`min-h-9 justify-center rounded-full px-4 ${theme === t ? "bg-surface" : ""}`}
        >
          <Text className={`text-[13px] font-semibold ${theme === t ? "text-ink" : "text-soft"}`}>{t === "light" ? "Clair" : "Sombre"}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3">
      <Heading className="text-[17px] leading-[22px]">{title}</Heading>
      {children}
    </View>
  );
}

export default function PrimitivesScreen() {
  const c = useColors();
  return (
    <ScrollView className="flex-1 bg-bg" contentContainerClassName="mx-auto w-full max-w-[720px] gap-7 px-5 py-8">
      <View className="gap-3">
        <Heading className="text-[24px] font-bold leading-[29px]" style={{ letterSpacing: -0.5 }}>
          Primitives
        </Heading>
        <ThemeSwitch />
      </View>

      <Block title="Texte">
        <View style={SURFACE_STYLE} className="gap-2 rounded-card border border-edge/[0.06] bg-surface px-[18px] py-4">
          <Heading className="text-[15px] font-bold leading-[20px]">Heading : Ligne de test A</Heading>
          <Body className="text-[14px] leading-[20px]">Body : Ligne de test A</Body>
          <Body className="text-[13px] leading-[19px] text-soft">Body soft : Ligne de test A</Body>
          <Muted className="text-[13px] leading-[19px]">Muted : Ligne de test A</Muted>
          <Muted className="text-[12px]">{joinMeta(["Source de test", null, "p. 1", "v1"])}</Muted>
        </View>
      </Block>

      <Block title="Surfaces">
        <View style={SURFACE_STYLE} className="rounded-card border border-edge/[0.06] bg-surface px-[18px] py-4">
          <Body className="text-[14px]">SURFACE_STYLE · carte</Body>
        </View>
        <View style={CONTROL_STYLE} className="self-start rounded-action bg-surface px-4 py-3">
          <Body className="text-[14px]">CONTROL_STYLE</Body>
        </View>
      </Block>

      <Block title="Chargement">
        <View className="gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </View>
      </Block>

      <Block title="Catégories">
        <View className="flex-row flex-wrap gap-4">
          {CATEGORIES.map((cat) => (
            <View key={cat} className="items-center gap-1">
              <I.IconTile category={cat} />
              <Muted className="text-[11px]">{cat}</Muted>
            </View>
          ))}
        </View>
      </Block>

      <Block title={`Icônes (${ICONS.length})`}>
        <View className="flex-row flex-wrap gap-2">
          {ICONS.map(([name, Glyph]) => (
            <View key={name} className="w-[104px] items-center gap-1 rounded-lg bg-panel py-3">
              <Glyph size={18} color={c.accent} weight="bold" />
              <Muted className="text-[10.5px]">{name.replace(/Icon$/, "")}</Muted>
            </View>
          ))}
        </View>
      </Block>
    </ScrollView>
  );
}
