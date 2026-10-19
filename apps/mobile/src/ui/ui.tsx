import { useEffect, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, Text, View, type TextProps } from "react-native";

import { shadow } from "@avero/ui-tokens";

type T = TextProps & { className?: string };

// The web has no native animated module.
const NATIVE_DRIVER = Platform.OS !== "web";

// A caller-supplied text colour or weight replaces the default instead of fighting it in the stylesheet.
const HAS_COLOR = /(^|\s)text-(ink|soft|muted|accent|accentink|onaccent|num|warn|caution|flag)(\s|$)/;
const tone = (className: string, dflt: string) => (HAS_COLOR.test(className) ? className : `${dflt} ${className}`);
const HAS_WEIGHT = /(^|\s)font-(thin|extralight|light|normal|medium|semibold|bold)(\s|$)/;
const weight = (className: string, dflt: string) => (HAS_WEIGHT.test(className) ? className : `${dflt} ${className}`);

/** Titles: Inter semibold with tight tracking. Weight can be overridden per use. */
export const Heading = ({ className = "", style, ...p }: T) => (
  <Text
    {...p}
    style={[{ textWrap: "balance", letterSpacing: -0.4 } as object, style]}
    className={`font-heading ${weight(tone(className, "text-ink"), "font-semibold")}`}
  />
);
export const Body = ({ className = "", ...p }: T) => <Text {...p} className={tone(className, "text-ink")} />;
export const Muted = ({ className = "", ...p }: T) => <Text {...p} className={tone(className, "text-muted")} />;

/** Joins meta parts with " · ", skipping empty ones. */
export const joinMeta = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

/** Raised surface: every white card (always with a 6% `edge` hairline). */
export const SURFACE_STYLE = { boxShadow: shadow.surface } as const;
/** The small lift on controls: segmented "on" pill, active sidebar row, source bar. */
export const CONTROL_STYLE = { boxShadow: shadow.control } as const;

/** True when the OS asks for less motion; looping animations then hold still. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => sub.remove();
  }, []);
  return reduced;
}

/** A slow opacity breath for things that are loading; holds still under reduced motion. */
export function Pulse({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const reduced = useReducedMotion();
  const [o] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) return;
    const run = Animated.sequence([
      Animated.delay(delay),
      Animated.loop(
        Animated.sequence([
          Animated.timing(o, { toValue: 0.35, duration: 700, useNativeDriver: NATIVE_DRIVER }),
          Animated.timing(o, { toValue: 1, duration: 700, useNativeDriver: NATIVE_DRIVER }),
        ]),
      ),
    ]);
    run.start();
    return () => run.stop();
  }, [o, delay, reduced]);
  return (
    <Animated.View style={{ opacity: o }} className={className}>
      {children}
    </Animated.View>
  );
}

/** Placeholder bar in the shape of the content that is loading. */
export const Skeleton = ({ className = "" }: { className?: string }) => (
  <Pulse>
    <View className={`rounded-md bg-line ${className}`} />
  </Pulse>
);

/** One choice among a few (a segmented control). */
export function Segments({ labels, value, onChange, dense }: { labels: string[]; value: number; onChange: (i: number) => void; dense?: boolean }) {
  return (
    <View accessibilityRole="tablist" className="flex-row rounded-full bg-panel p-[3px]">
      {labels.map((label, i) => {
        const on = i === value;
        return (
          <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => onChange(i)}
            style={on ? CONTROL_STYLE : undefined} className={`min-h-10 items-center justify-center rounded-full active:opacity-70 ${dense ? "flex-auto px-[6px]" : "flex-1 px-2"} ${on ? "bg-surface" : ""}`}>
            <Text className={`text-center ${dense ? "text-[12.5px] leading-[15px]" : "text-[13px]"} ${on ? "font-semibold text-ink" : "font-medium text-soft"}`} numberOfLines={2}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
