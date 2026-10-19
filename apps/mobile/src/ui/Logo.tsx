import { Image, Text, View } from "react-native";

const MARK = require("../../assets/logo-mark.png");
const RATIO = 304 / 212; // the image's width over its height

/** The Avero mark, from the brand board (the A and its leaf, transparent); `size` is its height. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return <Image source={MARK} style={{ height: size, width: Math.round(size * RATIO) }} resizeMode="contain" accessibilityIgnoresInvertColors />;
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
