/** @type {import('tailwindcss').Config} */
// Colors are CSS variables set from src/theme/themes.ts, shared with deck.gl and Monaco.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: v("paper"),
        panel: v("panel"),
        sunken: v("sunken"),
        ink: v("ink"),
        emph: v("emph"),
        pencil: v("pencil"),
        faint: v("faint"),
        rule: v("rule"),
        accent: v("accent"),
        danger: v("danger"),
        ok: v("ok"),
        warn: v("warn"),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        hand: ["Caveat", "cursive"],
      },
      fontSize: { "2xs": ["0.6875rem", "1rem"] },
      transitionDuration: { DEFAULT: "200ms" },
    },
  },
  plugins: [],
};
