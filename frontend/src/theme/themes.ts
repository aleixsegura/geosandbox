// Single source of truth for colors: CSS variables, deck.gl layers and Monaco
// all read from here. Accents are the official Solarized palette in every theme.

export type RGB = [number, number, number];
export type ThemeName = "notebook" | "solarized-light" | "solarized-dark";

export const SOLARIZED = {
  base03: "#002b36",
  base02: "#073642",
  base01: "#586e75",
  base00: "#657b83",
  base0: "#839496",
  base1: "#93a1a1",
  base2: "#eee8d5",
  base3: "#fdf6e3",
  yellow: "#b58900",
  orange: "#cb4b16",
  red: "#dc322f",
  magenta: "#d33682",
  violet: "#6c71c4",
  blue: "#268bd2",
  cyan: "#2aa198",
  green: "#859900",
} as const;

/** Variable colors, ordered for maximum contrast between neighbours. Red is reserved for errors. */
export const ACCENTS = ["blue", "orange", "green", "magenta", "cyan", "violet", "yellow"] as const;
export type AccentName = (typeof ACCENTS)[number];

export interface Theme {
  name: ThemeName;
  label: string;
  dark: boolean;
  paper: string; // app background
  panel: string; // raised surfaces (sidebar, toolbar)
  sunken: string; // inputs, console
  ink: string; // body text
  emph: string; // headings, emphasized text
  pencil: string; // secondary text, axis labels
  faint: string; // tertiary text, disabled
  rule: string; // borders, separators
  gridMinor: string;
  gridMajor: string;
  axis: string;
  margin: string; // editor margin line
  accent: string; // UI accent (selection, focus)
  danger: string;
  ok: string;
  warn: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  notebook: {
    name: "notebook",
    label: "Notebook",
    dark: false,
    paper: "#f2f0eb",
    panel: "#f7f6f2",
    sunken: "#ebe8e1",
    ink: "#2b2b2b",
    emph: "#1c1c1c",
    pencil: "#6e6a64",
    faint: "#a29d95",
    rule: "#dcd7cd",
    gridMinor: "#dfe5ec",
    gridMajor: "#c3cfdc",
    axis: "#8797aa",
    margin: "#e3aaa5",
    accent: SOLARIZED.blue,
    danger: SOLARIZED.red,
    ok: SOLARIZED.green,
    warn: SOLARIZED.yellow,
  },
  "solarized-light": {
    name: "solarized-light",
    label: "Solarized light",
    dark: false,
    paper: SOLARIZED.base3,
    panel: SOLARIZED.base3,
    sunken: SOLARIZED.base2,
    ink: SOLARIZED.base00,
    emph: SOLARIZED.base01,
    pencil: SOLARIZED.base1,
    faint: SOLARIZED.base1,
    rule: SOLARIZED.base2,
    gridMinor: SOLARIZED.base2,
    gridMajor: "#dcd5bf", // base2 blended 15% toward base1
    axis: SOLARIZED.base1,
    margin: SOLARIZED.red,
    accent: SOLARIZED.blue,
    danger: SOLARIZED.red,
    ok: SOLARIZED.green,
    warn: SOLARIZED.yellow,
  },
  "solarized-dark": {
    name: "solarized-dark",
    label: "Solarized dark",
    dark: true,
    paper: SOLARIZED.base03,
    panel: SOLARIZED.base03,
    sunken: SOLARIZED.base02,
    ink: SOLARIZED.base0,
    emph: SOLARIZED.base1,
    pencil: SOLARIZED.base01,
    faint: SOLARIZED.base01,
    rule: SOLARIZED.base02,
    gridMinor: "#04323d", // base03 blended toward base02
    gridMajor: SOLARIZED.base02,
    axis: SOLARIZED.base01,
    margin: SOLARIZED.red,
    accent: SOLARIZED.blue,
    danger: SOLARIZED.red,
    ok: SOLARIZED.green,
    warn: SOLARIZED.yellow,
  },
};

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function accentRgb(name: AccentName | "red"): RGB {
  return hexToRgb(SOLARIZED[name]);
}

/** Mix two colors; t=0 gives a, t=1 gives b. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
}

const CSS_VARS: (keyof Theme)[] = [
  "paper", "panel", "sunken", "ink", "emph", "pencil", "faint", "rule", "accent", "danger", "ok", "warn",
];

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme.name;
  root.style.colorScheme = theme.dark ? "dark" : "light";
  for (const key of CSS_VARS) {
    root.style.setProperty(`--${key}`, hexToRgb(theme[key] as string).join(" "));
  }
  root.style.setProperty("--margin-line", theme.margin);
}
