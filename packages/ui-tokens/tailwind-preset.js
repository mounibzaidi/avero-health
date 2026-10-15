/** Tailwind 3 preset for the app (NativeWind). Colours read the CSS variables that ThemeProvider swaps. */
const { COLOR_NAMES, font, radius } = require("./tokens");

const colors = {};
for (const [name, suffix] of Object.entries(COLOR_NAMES)) colors[name] = `rgb(var(--c-${suffix}) / <alpha-value>)`;

const borderRadius = {};
for (const [name, px] of Object.entries(radius)) borderRadius[name] = `${px}px`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors,
      fontFamily: { heading: [font.sans], sans: [font.sans] },
      borderRadius,
    },
  },
};
