// Single source of truth for colors: CSS variables, deck.gl layers and Monaco
// all read from here. Variables and UI accents use matplotlib's tab10; the editor
// uses Pygments' default style, as Jupyter does.

export type RGB = [number, number, number];

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
  accent: "#1f77b4", // tab10 blue
  danger: "#d62728", // tab10 red
  ok: "#2ca02c", // tab10 green
  warn: "#ff7f0e", // tab10 orange
};

/** Python syntax colors: Pygments' default style, the highlighting Jupyter uses. */
export const SYNTAX = {
  keyword: "#008000",
  string: "#ba2121",
  escape: "#aa5d1f",
  number: "#666666",
  type: "#0000ff",
  comment: "#3d7b7b",
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
