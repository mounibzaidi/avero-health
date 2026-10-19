import { fixed } from "@avero/ui-tokens";
import { Text, View } from "react-native";
import Svg, { Path, Rect } from "react-native-svg";

/** The mark: a solid white A on the brand green square (same as the dashboard and the icons). */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Rect width={64} height={64} rx={16} fill={fixed.logoSquare} />
      <Path fillRule="evenodd" fill="#FFFFFF" d="M30 13 L34 13 L51 50 L43 50 L39.8 43 L24.2 43 L21 50 L13 50 Z M32 26.5 L36.6 37 L27.4 37 Z" />
    </Svg>
  );
}

export function Logo({ size = 28, textSize = 16 }: { size?: number; textSize?: number }) {
  return (
    <View className="flex-row items-center gap-[9px]" accessibilityRole="header" accessibilityLabel="Avero">
      <LogoMark size={size} />
      <Text className="font-semibold text-ink" style={{ fontSize: textSize, letterSpacing: -textSize * 0.01 }}>
        Avero
      </Text>
    </View>
  );
}
