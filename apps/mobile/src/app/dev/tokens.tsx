import { vars } from "nativewind";
import { ScrollView, Text, View } from "react-native";

import { COLOR_NAMES, cssVars, hex, radius, shadow, type ColorName, type ThemeName } from "@medguides/ui-tokens";

/** Token test screen (step 2): every token in light and dark, side by side. Dev only; sample text is fake. */

const SCALE: { name: string; className: string; style?: object }[] = [
  { name: "caption-xs 10.5 · 700", className: "text-[10.5px] font-bold uppercase", style: { letterSpacing: 0.6 } },
  { name: "caption 11/16 · 500", className: "text-[11px] leading-[16px] font-medium" },
  { name: "small 12/17 · 700", className: "text-[12px] leading-[17px] font-bold" },
  { name: "meta 13/19 · 400", className: "text-[13px] leading-[19px] text-soft" },
  { name: "body 14/20 · 400", className: "text-[14px] leading-[20px]" },
  { name: "body-strong 14.5/20 · 600", className: "text-[14.5px] leading-[20px] font-semibold" },
  { name: "card-title 15/20 · 700", className: "text-[15px] leading-[20px] font-bold" },
  { name: "section 17/22 · 600", className: "text-[17px] leading-[22px] font-semibold" },
  { name: "title-phone 24/29 · 700", className: "text-[24px] leading-[29px] font-bold", style: { letterSpacing: -0.5 } },
  { name: "title-wide 34/41 · 700", className: "text-[34px] leading-[41px] font-bold", style: { letterSpacing: -0.85 } },
];

const WEIGHTS = [
  { w: 400, className: "font-normal" },
  { w: 500, className: "font-medium" },
  { w: 600, className: "font-semibold" },
  { w: 700, className: "font-bold" },
];

const RADII = ["DEFAULT", "md", "lg", "xl", "card", "pill"] as const;

function Heading({ children }: { children: string }) {
  return <Text className="mb-3 mt-7 text-[17px] font-semibold leading-[22px] text-ink">{children}</Text>;
}

function Panel({ theme }: { theme: ThemeName }) {
  const h = hex(theme);
  return (
    <View style={vars(cssVars(theme))} className="min-w-[340px] flex-1 bg-bg px-5 py-6">
      <Text className="text-[24px] font-bold leading-[29px] text-ink" style={{ letterSpacing: -0.5 }}>
        {theme === "light" ? "Clair" : "Sombre"}
      </Text>

      <Heading>Couleurs</Heading>
      <View className="flex-row flex-wrap gap-2">
        {(Object.keys(COLOR_NAMES) as ColorName[]).map((name) => (
          <View key={name} className="w-[100px] overflow-hidden rounded-lg border border-edge/[0.08] bg-surface">
            <View className="h-10" style={{ backgroundColor: h[name] }} />
            <View className="px-2 py-1.5">
              <Text className="text-[12px] font-semibold text-ink">{name}</Text>
              <Text className="font-mono text-[11px] text-muted">
                {h[name]}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <Heading>Typographie</Heading>
      <View className="gap-3 rounded-card border border-edge/[0.06] bg-surface px-[18px] py-4" style={{ boxShadow: shadow.surface }}>
        {SCALE.map((s) => (
          <View key={s.name}>
            <Text className="text-[11px] text-muted">{s.name}</Text>
            <Text className={`text-ink ${s.className}`} style={s.style}>
              Ligne de test A
            </Text>
          </View>
        ))}
        <View>
          <Text className="text-[11px] text-muted">dose 17/23 · 700 · mono</Text>
          <Text className="font-mono text-[17px] font-bold leading-[23px] text-ink">
            000 test / 0 h
          </Text>
        </View>
      </View>

      <Heading>Graisses (Inter)</Heading>
      <View className="flex-row flex-wrap gap-4">
        {WEIGHTS.map(({ w, className }) => (
          <Text key={w} className={`text-[15px] text-ink ${className}`}>
            Inter {w}
          </Text>
        ))}
      </View>

      <Heading>Textes et fonds</Heading>
      <View className="gap-2">
        <Text className="text-[14px] text-ink">ink : Ligne de test A</Text>
        <Text className="text-[14px] text-soft">soft : Ligne de test A</Text>
        <Text className="text-[14px] text-muted">muted : Ligne de test A</Text>
        <Text className="text-[14px] font-semibold text-accent">accent : Ligne de test A</Text>
        <View className="self-start rounded-full bg-tint px-3 py-1">
          <Text className="text-[12px] font-semibold text-accentink">tint · accentink</Text>
        </View>
        <View className="rounded-card bg-flagbg px-[18px] py-3">
          <Text className="text-[14px] font-semibold text-flag">flag sur flagbg : Ligne de test B</Text>
        </View>
        <View className="rounded-card bg-cautionbg px-[18px] py-3">
          <Text className="text-[14px] font-semibold text-caution">caution sur cautionbg : Ligne de test C</Text>
        </View>
        <View className="btn-primary h-10 self-start justify-center rounded-button bg-btn px-4">
          <Text className="text-[14px] font-semibold text-btnink">Bouton principal</Text>
        </View>
      </View>

      <Heading>Rayons</Heading>
      <View className="flex-row flex-wrap gap-3">
        {RADII.map((r) => (
          <View key={r} className="h-16 w-20 items-center justify-center border border-line bg-panel" style={{ borderRadius: radius[r] }}>
            <Text className="text-[11px] text-soft">
              {r} {radius[r]}
            </Text>
          </View>
        ))}
      </View>

      <Heading>Ombres</Heading>
      <View className="gap-3">
        <View className="rounded-card border border-edge/[0.06] bg-surface px-[18px] py-4" style={{ boxShadow: shadow.surface }}>
          <Text className="text-[14px] text-ink">surface</Text>
        </View>
        <View className="rounded-action bg-surface px-[18px] py-3" style={{ boxShadow: shadow.control }}>
          <Text className="text-[14px] text-ink">control</Text>
        </View>
      </View>
    </View>
  );
}

export default function TokensScreen() {
  return (
    <ScrollView className="bg-[#0F1211]" contentContainerClassName="flex-row flex-wrap">
      <Panel theme="light" />
      <Panel theme="dark" />
    </ScrollView>
  );
}
