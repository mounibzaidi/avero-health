import { useId } from "react";
import { Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";

/** The mark: an A without its crossbar (an inverted V) in the brand green, light emerald at the apex to deep green at the feet (same as the
 * dashboard and the icons). */
export function LogoMark({ size = 28 }: { size?: number }) {
  const id = `avero-a${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`; // url(#…) breaks on the ":" or "«" of React ids
  return (
    <Svg width={size} height={size} viewBox="10 10 44 44">
      <Defs>
        <LinearGradient id={id} x1="0" y1="13" x2="0" y2="50" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#3A9473" />
          <Stop offset="1" stopColor="#1E4F3E" />
        </LinearGradient>
      </Defs>
      <Path fillRule="evenodd" fill={`url(#${id})`} d="M30 13 L34 13 L51 50 L43 50 L32 26 L21 50 L13 50 Z" />
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
