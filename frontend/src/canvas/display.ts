// Where (and whether) each variable can be drawn: graph paper or map.

import type { RasterStyle, VarEntry } from "../state/store";
import type { Payload } from "../ws/protocol";

export type Mode = "paper" | "map";
export type Bounds = [number, number, number, number]; // minX, minY, maxX, maxY

const R = 6378137;

export function mercatorToLngLat(x: number, y: number): [number, number] {
  return [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
}

export function lngLatToMercator(lng: number, lat: number): [number, number] {
  const clamped = Math.max(-85.0511, Math.min(85.0511, lat));
  return [(lng * Math.PI * R) / 180, R * Math.log(Math.tan(Math.PI / 4 + (clamped * Math.PI) / 360))];
}

/** The raster payload actually drawn for a variable (datasets draw their selected child). */
export function rasterOf(p: Payload, style?: RasterStyle): { data: Record<string, any>; meta: Record<string, any> } | null {
  if (p.kind === "raster") return p;
  if (p.kind === "dataset") {
    const vars = p.data.variables ?? {};
    const key = style?.datasetVar && vars[style.datasetVar] ? style.datasetVar : Object.keys(vars)[0];
    return key ? vars[key] : null;
  }
  return null;
}

export function displayOf(p: Payload, style?: RasterStyle): { mode: Mode; bounds: Bounds; pixel?: boolean } | null {
  switch (p.kind) {
    case "geometry":
    case "crs":
    case "transformer":
    case "transform": {
      const b = p.meta.display_bounds as Bounds | null | undefined;
      if (!b || b.some((v) => v == null || !Number.isFinite(v))) return null;
      return { mode: p.meta.display_crs ? "map" : "paper", bounds: b };
    }
    case "raster":
    case "dataset": {
      const r = rasterOf(p, style);
      if (!r) return null;
      const disp = r.meta.display;
      if (disp.mode === "map") {
        const [l, b, rr, t] = disp.bounds3857;
        const [w, s] = mercatorToLngLat(l, b);
        const [e, n] = mercatorToLngLat(rr, t);
        return { mode: "map", bounds: [w, s, e, n] };
      }
      const shape = r.meta.shape as number[];
      return { mode: "paper", bounds: [0, 0, shape[shape.length - 1], shape[shape.length - 2]], pixel: true };
    }
    default:
      return null;
  }
}

export function resolveMode(requested: "auto" | Mode, entries: VarEntry[], styles: Record<string, RasterStyle>): Mode {
  if (requested !== "auto") return requested;
  return entries.some((e) => e.visible && displayOf(e.payload, styles[e.name])?.mode === "map") ? "map" : "paper";
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (!list.length) return null;
  return list.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
}

/** Physical size of the drawn grid, and whether it is in metres. */
export function rasterExtent(meta: Record<string, any>): { width: number; height: number; metric: boolean } {
  const disp = meta.display;
  if (disp.mode === "map") {
    const [l, b, r, t] = disp.bounds3857;
    // Web Mercator stretches by 1/cos(lat): undo it to get ground metres.
    const lat = (2 * Math.atan(Math.exp((b + t) / 2 / 6378137)) - Math.PI / 2);
    return { width: (r - l) * Math.cos(lat), height: (t - b) * Math.cos(lat), metric: true };
  }
  const shape = meta.shape as number[];
  return { width: shape[shape.length - 1], height: shape[shape.length - 2], metric: false };
}

/** Exaggeration that makes the relief about 12 % of the horizontal extent. */
export function suggestedExaggeration(meta: Record<string, any>): number {
  const s = meta.stats_global;
  const { width, height, metric } = rasterExtent(meta);
  const range = s ? s.max - s.min : 0;
  if (!metric || !range) return 1;
  return Math.min(50, Math.max(1, Math.round((0.12 * Math.max(width, height)) / range)));
}
