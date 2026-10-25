/**
 * Avero design tokens: the single source for the app (NativeWind) and the dashboard (Tailwind 4).
 * Values are copied from the old app (theme.tsx, tailwind.config.js, ui.tsx, global.css) through
 * carryover/design-tokens.json. Do not change a value here without changing the design.
 *
 * Colours are "r g b" triplets so Tailwind can add alpha (`bg-tint/60`).
 */

/** Tailwind name → CSS variable suffix (`--c-<suffix>`). */
const COLOR_NAMES = {
  bg: "bg",
  panel: "panel",
  surface: "surface",
  line: "line",
  edge: "edge",
  ink: "ink",
  soft: "soft",
  muted: "muted",
  accent: "accent",
  accentink: "accentink",
  tint: "tint",
  input: "input",
  onaccent: "onaccent",
  num: "num",
  warn: "warn",
  flag: "flag",
  flagbg: "flag-bg",
  caution: "caution",
  cautionbg: "caution-bg",
  btn: "btn",
  btnink: "btn-ink",
};

const color = {
  light: {
    bg: "251 252 248", // #FBFCF8  page
    panel: "244 246 242", // #F4F6F2  sidebar, tiles, dose chip, segmented track
    surface: "255 255 255", // #FFFFFF  cards
    line: "232 236 231", // #E8ECE7  dividers, card borders
    edge: "23 41 35", // #172923  card and control hairline, used at /6 to /10
    ink: "23 41 35", // #172923  body text
    soft: "67 82 75", // #43524B  secondary text
    muted: "98 112 105", // #627069  tertiary text, placeholder
    accent: "36 92 73", // #245C49  links, icons, active states
    accentink: "31 79 63", // #1F4F3F  text on tint
    tint: "227 238 231", // #E3EEE7  badges, number circles, lit chip
    input: "240 243 239", // #F0F3EF  text fields
    onaccent: "255 255 255",
    num: "36 92 73",
    warn: "155 89 72", // #9B5948  escalation icons
    flag: "140 79 64", // #8C4F40  red flags, do-not, critical limits
    flagbg: "248 241 239", // #F8F1EF  rose card
    caution: "119 90 50", // #775A32  amber text: gaps, review pending
    cautionbg: "247 243 234", // #F7F3EA  amber card
    btn: "36 92 73", // #245C49  primary button
    btnink: "255 255 255",
  },
  dark: {
    bg: "15 18 17", // #0F1211
    panel: "19 22 21", // #131615
    surface: "24 28 26", // #181C1A
    line: "36 41 38", // #242926
    edge: "255 255 255",
    ink: "236 239 236", // #ECEFEC
    soft: "169 177 171", // #A9B1AB
    muted: "134 142 136", // #868E88
    accent: "45 212 191", // #2DD4BF
    accentink: "94 234 212", // #5EEAD4
    tint: "17 46 43", // #112E2B
    input: "18 21 20", // #121514
    onaccent: "4 30 27", // #041E1B
    num: "45 212 191",
    warn: "240 116 116", // #F07474
    flag: "248 140 140", // #F88C8C
    flagbg: "44 27 24", // #2C1B18
    caution: "227 178 92", // #E3B25C
    cautionbg: "43 34 18", // #2B2212
    btn: "13 148 136", // #0D9488
    btnink: "255 255 255",
  },
};

/** Light is the default look. */
const defaultTheme = "light";

/** Values outside the palette, kept as they were. */
const fixed = {
  logoSquare: "#245C49",
  scrim: "rgba(26,28,30,0.32)",
};

const font = {
  sans: "Inter",
  /** Loaded weights. 700 is now bundled (it was synthesised before). */
  weights: [400, 500, 600, 700],
  /** File per weight, in ./fonts. */
  files: {
    400: "Inter_400Regular.ttf",
    500: "Inter_500Medium.ttf",
    600: "Inter_600SemiBold.ttf",
    700: "Inter_700Bold.ttf",
  },
  mono: { web: "ui-monospace, SFMono-Regular, Menlo, monospace", ios: "Menlo", default: "monospace" },
  /** The home title (fonts/InstrumentSerif-Regular.ttf): its family on the web, its file name on a phone. */
  serif: { web: "Instrument Serif", native: "InstrumentSerif-Regular" },
  letterSpacing: "-0.01em",
};

/** Tailwind radius scale as configured in the old app. Cards use 18 (the latest value, DESIGN_SYSTEM §10.1). */
const radius = {
  DEFAULT: 8,
  md: 10,
  lg: 12,
  xl: 14,
  "2xl": 14,
  card: 18,
  inner: 10,
  button: 11,
  action: 12,
  branch: 12,
  pill: 20,
  sheetTop: 20,
};

const shadow = {
  surface:
    "0 20px 40px -12px rgba(14,38,36,.04), 0 8px 20px -4px rgba(14,38,36,.05), 0 2px 4px rgba(14,38,36,.04), 0 1px 1px rgba(14,38,36,.03)",
  control: "0 2px 6px rgba(14,38,36,.04), 0 1px 1px rgba(14,38,36,.05)",
  sheet: "0 -8px 30px rgba(26,28,30,.08)",
  searchFocus: "0 0 0 4px rgba(36,92,73,.14), 0 1px 2px rgba(14,38,36,.04)",
  btnPrimary: "0 6px 14px -4px rgb(var(--c-btn) / 0.22), 0 1px 2px rgb(var(--c-btn) / 0.16)",
};

const size = {
  touchMin: 44,
  chipMinHeight: 40,
  stepRowMinHeight: 52,
  stepCardHeaderMinHeight: 60,
  tabBarItemMinHeight: 54,
  stepNumberCircle: 28,
  iconTile: 32,
  searchField: 50,
  searchFieldCompact: 40,
  button: 40,
  input: 44,
  contentMaxPhone: 720,
  contentMaxWide: 860,
  sidebarWide: 264,
  sourceColumnWide: 340,
  sheetMax: 440,
  pageBodyMax: 760,
};

const breakpoint = {
  glanceSideBySide: 640,
  library: 860,
  ficheWide: 1100,
};

const motion = { fadeInMs: 180, pulseMs: 700 };

/** `{ "--c-bg": "251 252 248", ... }` for one theme. */
function cssVars(theme) {
  const out = {};
  for (const [name, suffix] of Object.entries(COLOR_NAMES)) out[`--c-${suffix}`] = color[theme][name];
  return out;
}

/** `{ bg: "#FBFCF8", ... }` for one theme, for SVG and placeholders (they cannot read CSS variables). */
function hex(theme) {
  const out = {};
  for (const [name, rgb] of Object.entries(color[theme]))
    out[name] = "#" + rgb.split(" ").map((n) => Number(n).toString(16).padStart(2, "0").toUpperCase()).join("");
  return out;
}

module.exports = { COLOR_NAMES, color, defaultTheme, fixed, font, radius, shadow, size, breakpoint, motion, cssVars, hex };
