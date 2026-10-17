// Colormap lookup tables (256 × RGBA8) uploaded as textures; the GPU does the mapping.

type Stop = [number, string];

const STOPS: Record<string, Stop[]> = {
  viridis: [
    [0, "#440154"], [0.13, "#482878"], [0.25, "#3e4989"], [0.38, "#31688e"], [0.5, "#26828e"],
    [0.63, "#1f9e89"], [0.75, "#35b779"], [0.88, "#6ece58"], [1, "#fde725"],
  ],
  magma: [
    [0, "#000004"], [0.13, "#1c1044"], [0.25, "#4f127b"], [0.38, "#812581"], [0.5, "#b5367a"],
    [0.63, "#e55064"], [0.75, "#fb8761"], [0.88, "#fec287"], [1, "#fcfdbf"],
  ],
  cividis: [
    [0, "#00204d"], [0.13, "#123570"], [0.25, "#3b496c"], [0.38, "#575d6d"], [0.5, "#707173"],
    [0.63, "#8a8778"], [0.75, "#a69d75"], [0.88, "#c4b56c"], [1, "#ffea46"],
  ],
  terrain: [
    [0, "#333399"], [0.15, "#0099ff"], [0.25, "#00cc66"], [0.5, "#ffff99"], [0.75, "#996633"], [1, "#ffffff"],
  ],
  greys: [
    [0, "#000000"], [1, "#ffffff"],
  ],
  RdBu: [
    [0, "#67001f"], [0.1, "#b2182b"], [0.2, "#d6604d"], [0.3, "#f4a582"], [0.4, "#fddbc7"], [0.5, "#f7f7f7"],
    [0.6, "#d1e5f0"], [0.7, "#92c5de"], [0.8, "#4393c3"], [0.9, "#2166ac"], [1, "#053061"],
  ],
  spectral: [
    [0, "#9e0142"], [0.1, "#d53e4f"], [0.2, "#f46d43"], [0.3, "#fdae61"], [0.4, "#fee08b"], [0.5, "#ffffbf"],
    [0.6, "#e6f598"], [0.7, "#abdda4"], [0.8, "#66c2a5"], [0.9, "#3288bd"], [1, "#5e4fa2"],
  ],
};

export const COLORMAPS = Object.keys(STOPS);
export type ColormapName = keyof typeof STOPS;

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const cache = new Map<string, Uint8Array>();

export function colormapLut(name: string, reverse = false): Uint8Array {
  const key = `${name}:${reverse}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const stops = (STOPS[name] ?? STOPS.viridis).map(([t, c]) => [t, parse(c)] as const);
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = reverse ? 1 - i / 255 : i / 255;
    let j = 0;
    while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
    const [t0, c0] = stops[j];
    const [t1, c1] = stops[j + 1];
    const f = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    for (let k = 0; k < 3; k++) lut[i * 4 + k] = Math.round(c0[k] + (c1[k] - c0[k]) * f);
    lut[i * 4 + 3] = 255;
  }
  cache.set(key, lut);
  return lut;
}

export function colormapCss(name: string, reverse = false): string {
  const stops = STOPS[name] ?? STOPS.viridis;
  const parts = stops.map(([t, c]) => `${c} ${((reverse ? 1 - t : t) * 100).toFixed(0)}%`);
  if (reverse) parts.reverse();
  return `linear-gradient(to right, ${parts.join(", ")})`;
}

/** Sensible default colormap for a raster. */
export function defaultColormap(meta: { units?: string | null; var_name?: string | null; title?: string }, min: number, max: number): string {
  const hint = `${meta.var_name ?? ""} ${meta.title ?? ""}`.toLowerCase();
  if (/dem|elev|height|altitude|relief/.test(hint)) return "terrain";
  if (/shade/.test(hint)) return "greys";
  if (min < 0 && max > 0 && Math.abs(Math.abs(min) - Math.abs(max)) / Math.max(Math.abs(min), Math.abs(max)) < 0.5) return "RdBu";
  return "viridis";
}
