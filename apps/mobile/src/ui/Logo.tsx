import { fixed } from "@medguides/ui-tokens";
import { Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";

/** The mark: a teal square holding three steps. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect width={64} height={64} rx={16} fill={fixed.logoSquare} />
      <Rect x={17} y={18} width={30} height={7} rx={3.5} fill="#FFFFFF" />
      <Rect x={17} y={28.5} width={22} height={7} rx={3.5} fill="#FFFFFF" />
      <Rect x={17} y={39} width={14} height={7} rx={3.5} fill="#FFFFFF" />
    </Svg>
  );
}

export function Logo({ size = 28, textSize = 16 }: { size?: number; textSize?: number }) {
  return (
    <View className="flex-row items-center gap-[9px]" accessibilityRole="header" accessibilityLabel="MedGuides">
      <LogoMark size={size} />
      <Text className="font-semibold text-ink" style={{ fontSize: textSize, letterSpacing: -textSize * 0.01 }}>
        MedGuides
      </Text>
    </View>
  );
}
