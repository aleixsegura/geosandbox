// Single source of truth for colors: CSS variables, deck.gl layers and Monaco
// all read from here. Variables use matplotlib's tab10; Solarized supplies the
// UI accents and the editor's syntax colors.

export type RGB = [number, number, number];

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

/**
 * Variable colors: matplotlib's tab10 (Python's default plot cycle) minus red,
 * which is reserved for errors, and grey, which reads as pencil.
 */
export const VAR_COLORS = {
  blue: "#1f77b4",
  orange: "#ff7f0e",
  green: "#2ca02c",
  purple: "#9467bd",
  brown: "#8c564b",
  pink: "#e377c2",
  olive: "#bcbd22",
  cyan: "#17becf",
} as const;
export type VarColor = keyof typeof VAR_COLORS;
export const VAR_COLOR_NAMES = Object.keys(VAR_COLORS) as VarColor[];

export interface Theme {
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

/** The Notebook theme: warm paper, graphite ink, blue-grey ruling. */
export const THEME: Theme = {
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
};

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function varColorRgb(name: VarColor): RGB {
  return hexToRgb(VAR_COLORS[name]);
}

/** Mix two colors; t=0 gives a, t=1 gives b. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
}

const CSS_VARS: (keyof Theme)[] = [
  "paper", "panel", "sunken", "ink", "emph", "pencil", "faint", "rule", "accent", "danger", "ok", "warn",
];

export function applyTheme(): void {
  const root = document.documentElement;
  for (const key of CSS_VARS) {
    root.style.setProperty(`--${key}`, hexToRgb(THEME[key]).join(" "));
  }
  root.style.setProperty("--margin-line", THEME.margin);
}
