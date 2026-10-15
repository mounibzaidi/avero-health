import AsyncStorage from "@react-native-async-storage/async-storage";
import { vars } from "nativewind";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform, View } from "react-native";

import { cssVars, defaultTheme, hex, type ThemeName } from "@medguides/ui-tokens";

export type { ThemeName };

const KEY = "medguides.theme";
const TOKENS = { light: vars(cssVars("light")), dark: vars(cssVars("dark")) };
const HEX = { light: hex("light"), dark: hex("dark") };

type ThemeCtx = { theme: ThemeName; setTheme: (t: ThemeName) => void };
const Ctx = createContext<ThemeCtx>({ theme: defaultTheme, setTheme: () => {} });
export const useTheme = () => useContext(Ctx);

/** Plain colour values for SVG strokes, icons and placeholders (they cannot read the CSS variables). */
export const useColors = () => HEX[useTheme().theme];
export const usePlaceholderColor = () => useColors().muted;

/** Light is the default; dark is a choice stored on the device. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(defaultTheme);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => (v === "light" || v === "dark") && setThemeState(v))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (Platform.OS === "web" && typeof document !== "undefined") document.body.style.backgroundColor = HEX[theme].bg;
  }, [theme]);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    AsyncStorage.setItem(KEY, t).catch(() => {});
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return (
    <Ctx.Provider value={value}>
      <View style={[{ flex: 1 }, TOKENS[theme]]} className="bg-bg">
        {children}
      </View>
    </Ctx.Provider>
  );
}
