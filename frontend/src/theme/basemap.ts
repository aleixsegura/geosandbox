// OpenFreeMap "positron" vector style, re-inked toward the notebook theme:
// every color is desaturated and its lightness re-mapped between the theme's
// ink and paper, so the map reads like a pencil sketch on the same paper.

import { hexToRgb, mix, THEME, type RGB } from "./themes";

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

let raw: Promise<any | null> | null = null;
let inked: any | null = null;

function fetchStyle(): Promise<any | null> {
  raw ??= fetch(STYLE_URL)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return raw;
}

function parseColor(s: string): [number, number, number, number] | null {
  const str = s.trim().toLowerCase();
  let m = str.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  m = str.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  m = str.match(/^hsla?\(([^)]+)\)$/);
  if (m) {
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat);
    const [r, g, b] = hslToRgb(p[0] / 360, p[1] / 100, p[2] / 100);
    return [r, g, b, p[3] ?? 1];
  }
  return null;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

function luminance([r, g, b]: number[]): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function reink(color: string, water: boolean): string {
  const c = parseColor(color);
  if (!c) return color;
  const ink = hexToRgb(THEME.ink);
  const paper = hexToRgb(THEME.paper);
  const tint = hexToRgb(THEME.gridMajor); // the notebook's blue-grey, for water
  // White → paper, black → ink.
  let out = mix(ink, paper, Math.pow(luminance(c), 0.8));
  if (water) out = mix(out, tint, 0.6);
  return `rgba(${out[0]}, ${out[1]}, ${out[2]}, ${c[3]})`;
}

function walk(value: any, water: boolean): any {
  if (typeof value === "string") return parseColor(value) ? reink(value, water) : value;
  if (Array.isArray(value)) return value.map((v) => walk(v, water));
  return value;
}

export async function basemapStyle(): Promise<any | null> {
  if (inked) return inked;
  const style = await fetchStyle();
  if (!style) return null;
  const copy = structuredClone(style);
  for (const layer of copy.layers ?? []) {
    if (!layer.paint) continue;
    // Water keeps a hint of the notebook's blue-grey ruling (labels excluded).
    const water = /water/.test(layer.id) && layer.type !== "symbol";
    for (const [key, value] of Object.entries(layer.paint)) {
      if (key.endsWith("color")) layer.paint[key] = walk(value, water);
    }
    if (layer.type === "symbol" && layer.paint["text-halo-color"]) layer.paint["text-halo-color"] = `${THEME.paper}cc`;
  }
  inked = copy;
  return copy;
}
