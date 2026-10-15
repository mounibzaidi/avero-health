/** Design tokens come from @medguides/ui-tokens. Colours are CSS variables so light and dark swap at runtime. */
const { platformSelect } = require("nativewind/theme");
const { font } = require("@medguides/ui-tokens");

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Themes are swapped through CSS variables, not `dark:` variants. "class" (not the default
  // "media") also stops NativeWind's web runtime from throwing when it initialises dark mode.
  darkMode: "class",
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset"), require("@medguides/ui-tokens/tailwind-preset")],
  theme: {
    extend: {
      fontFamily: { mono: platformSelect({ ios: font.mono.ios, android: font.mono.default, default: font.mono.web }) },
    },
  },
  plugins: [],
};
