export type ThemeName = "light" | "dark";
export type ColorName =
  | "bg" | "panel" | "surface" | "line" | "edge" | "ink" | "soft" | "muted" | "accent" | "accentink" | "tint"
  | "input" | "onaccent" | "num" | "warn" | "flag" | "flagbg" | "caution" | "cautionbg" | "btn" | "btnink";

export declare const COLOR_NAMES: Record<ColorName, string>;
export declare const color: Record<ThemeName, Record<ColorName, string>>;
export declare const defaultTheme: ThemeName;
export declare const fixed: { logoSquare: string; scrim: string };
export declare const font: {
  sans: string;
  weights: number[];
  files: Record<400 | 500 | 600 | 700, string>;
  mono: { web: string; ios: string; default: string };
  letterSpacing: string;
};
export declare const radius: Record<
  "DEFAULT" | "md" | "lg" | "xl" | "2xl" | "card" | "inner" | "button" | "action" | "branch" | "pill" | "sheetTop",
  number
>;
export declare const shadow: Record<"surface" | "control" | "sheet" | "searchFocus" | "btnPrimary", string>;
export declare const size: Record<
  | "touchMin" | "chipMinHeight" | "stepRowMinHeight" | "stepCardHeaderMinHeight" | "tabBarItemMinHeight"
  | "stepNumberCircle" | "iconTile" | "searchField" | "searchFieldCompact" | "button" | "input"
  | "contentMaxPhone" | "contentMaxWide" | "sidebarWide" | "sourceColumnWide" | "sheetMax" | "pageBodyMax",
  number
>;
export declare const breakpoint: Record<"glanceSideBySide" | "library" | "ficheWide", number>;
export declare const motion: { fadeInMs: number; pulseMs: number };
export declare function cssVars(theme: ThemeName): Record<string, string>;
export declare function hex(theme: ThemeName): Record<ColorName, string>;
