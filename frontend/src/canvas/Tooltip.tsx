import type { PickingInfo } from "@deck.gl/core";
import proj4 from "proj4";

import type { RasterStyle, VarEntry } from "../state/store";
import type { NDArray } from "../ws/protocol";
import { rasterOf, type Mode } from "./display";
import { prepareGeometry } from "./geometryData";
import { parseLayerId, sliceIndex, sliceTexels } from "./layers";

export interface HoverInfo {
  x: number;
  y: number;
  title: string;
  rows: [string, string][];
}

export function fmt(v: number, geographic = false): string {
  if (!Number.isFinite(v)) return "—";
  if (geographic) return v.toFixed(6);
  const a = Math.abs(v);
  if (a >= 1e4) return v.toFixed(2);
  if (a >= 1) return Number(v.toFixed(4)).toString();
  return Number(v.toPrecision(5)).toString();
}

const projCache = new Map<string, proj4.Converter | null>();

/** lon/lat → source CRS, when the payload carries a proj4 definition. */
function toSourceCrs(lnglat: [number, number], proj: string | null | undefined): [number, number] | null {
  if (!proj) return null;
  let conv = projCache.get(proj);
  if (conv === undefined) {
    try {
      conv = proj4("WGS84", proj);
    } catch {
      conv = null;
    }
    projCache.set(proj, conv);
  }
  if (!conv) return null;
  try {
    return conv.forward(lnglat) as [number, number];
  } catch {
    return null;
  }
}

function crsLabel(crs: any): string {
  return crs?.epsg ? `EPSG:${crs.epsg}` : crs?.name ?? "source CRS";
}

function pointRows(xy: [number, number], meta: Record<string, any>, mode: Mode): [string, string][] {
  if (mode === "paper") return [["x, y", `${fmt(xy[0])}, ${fmt(xy[1])}`]];
  const rows: [string, string][] = [["lon, lat", `${fmt(xy[0], true)}, ${fmt(xy[1], true)}`]];
  const crs = meta.crs ?? meta.source;
  if (crs && crs.epsg !== 4326) {
    const src = toSourceCrs(xy, crs.proj4);
    if (src) rows.push([crsLabel(crs), `${fmt(src[0], crs.is_geographic)}, ${fmt(src[1], crs.is_geographic)}`]);
  }
  return rows;
}

export function describeHover(
  info: PickingInfo,
  vars: Record<string, VarEntry>,
  styles: Record<string, RasterStyle>,
  mode: Mode,
): HoverInfo | null {
  const parsed = parseLayerId(info.layer!.id);
  if (!parsed) return null;
  const entry = vars[parsed.name];
  if (!entry) return null;
  const p = entry.payload;
  const base = { x: info.x, y: info.y };
  const role = parsed.role.replace(/^-/, "");

  if (role === "vertices" && info.index >= 0) {
    const g = prepareGeometry(p);
    const xy: [number, number] = [g.vertices[info.index * 2], g.vertices[info.index * 2 + 1]];
    return { ...base, title: `${entry.name} · vertex`, rows: pointRows(xy, p.meta, mode) };
  }
  if (role === "points" && info.object) {
    const o = info.object as any;
    const xy: [number, number] = [o.position[0], o.position[1]];
    return { ...base, title: `${entry.name} · point`, rows: pointRows(xy, p.meta, mode) };
  }
  if (role === "problem" && info.object) {
    const o = info.object as any;
    return { ...base, title: `${entry.name} · invalid`, rows: [["reason", o.reason]] };
  }
  if ((role === "src" || role === "dst") && info.object) {
    const o = info.object as any;
    const label = p.meta.labels?.[o.i];
    if (!label) return null;
    const rows: [string, string][] = [
      [p.meta.source_label ?? "source", label.src],
      [p.meta.target_label ?? "target", label.dst],
    ];
    if (label.offset_m != null) rows.push(["gap", `${fmt(label.offset_m)} m`]);
    if (!label.ok) rows.push(["⚠", "outside the area of use"]);
    return { ...base, title: `${entry.name} · point ${o.i}`, rows };
  }
  if (role === "raster") {
    const style = styles[entry.name];
    const r = rasterOf(p, style);
    const bm = (info as any).bitmap;
    if (!r || !style || !bm) return null;
    const { values, mask } = r.data as { values: NDArray; mask: NDArray };
    const [, h, w] = values.shape;
    const [px, py] = bm.pixel as [number, number];
    if (px < 0 || py < 0 || px >= w || py >= h) return null;
    const texels = sliceTexels(values, mask, sliceIndex(r.meta, style));
    const valid = texels[(py * w + px) * 2 + 1] > 0;
    const value = texels[(py * w + px) * 2];
    const rows: [string, string][] = [["value", valid ? fmt(value) : "nodata"]];
    const shape = r.meta.shape as number[];
    const W = shape[shape.length - 1];
    const H = shape[shape.length - 2];
    if (r.meta.display.mode === "map" && info.coordinate) {
      const ll = info.coordinate as [number, number];
      rows.push(["lon, lat", `${fmt(ll[0], true)}, ${fmt(ll[1], true)}`]);
      const src = toSourceCrs(ll, r.meta.crs?.proj4);
      const m = r.meta.transform as number[][] | null;
      if (src) {
        rows.push([crsLabel(r.meta.crs), `${fmt(src[0], r.meta.crs?.is_geographic)}, ${fmt(src[1], r.meta.crs?.is_geographic)}`]);
        if (m) {
          // Inverse affine (no rotation terms in practice, but keep the general form).
          const [[a, b, c], [d, e, f]] = m;
          const det = a * e - b * d;
          const col = (e * (src[0] - c) - b * (src[1] - f)) / det;
          const row = (-d * (src[0] - c) + a * (src[1] - f)) / det;
          rows.push(["pixel (col, row)", `${Math.floor(col)}, ${Math.floor(row)}`]);
        }
      }
    } else {
      rows.push(["pixel (col, row)", `${Math.floor(bm.uv[0] * W)}, ${Math.floor(bm.uv[1] * H)}`]);
    }
    return { ...base, title: entry.name, rows };
  }
  if (info.object && (role === "fill" || role === "stroke")) {
    const o = info.object as any;
    const f = p.meta.features?.[o.feature];
    const rows: [string, string][] = [];
    if (info.coordinate) rows.push(...pointRows(info.coordinate as [number, number], p.meta, mode));
    const title = `${entry.name}${p.meta.count > 1 ? ` [${o.feature}]` : ""} · ${f?.geom_type ?? p.kind}`;
    return { ...base, title, rows };
  }
  return null;
}

export default function Tooltip({ hover }: { hover: HoverInfo }) {
  return (
    <div
      className="pointer-events-none absolute z-20 max-w-xs rounded border border-rule bg-panel/95 px-2.5 py-1.5 shadow-sm"
      style={{ left: hover.x + 14, top: hover.y + 14 }}
    >
      <div className="mb-0.5 font-sans text-xs font-medium text-emph">{hover.title}</div>
      {hover.rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 font-mono text-2xs leading-4">
          <span className="text-pencil">{k}</span>
          <span className="ml-auto whitespace-nowrap text-ink">{v}</span>
        </div>
      ))}
    </div>
  );
}
