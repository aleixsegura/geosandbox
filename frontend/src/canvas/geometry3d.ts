// Scene data for the 3D geometry view: every visible geometry at its Z, plus
// a footprint and drop lines on a reference plane so heights read at a glance.
// Graph-paper geometries keep their units; georeferenced ones (lon/lat on the
// wire) become local metres around the content, so Z in metres is comparable.

import type { VarEntry } from "../state/store";
import type { NDArray, Payload } from "../ws/protocol";
import type { Bounds } from "./display";
import { niceStep } from "./GraphPaper";

type XYZ = [number, number, number];

interface RawPath {
  xyz: Float64Array; // display x, y (paper units or lon/lat) and raw z
  feature: number;
  ring: boolean;
}

interface RawGeometry {
  points: { xyz: XYZ; feature: number }[];
  paths: RawPath[];
  polygons: { rings: Float64Array[]; feature: number }[];
}

const rawCache = new WeakMap<object, RawGeometry>();

/** Absolute display coordinates with Z (0 for parts without one), cached per payload. */
function rawGeometry(p: Payload): RawGeometry {
  const hit = rawCache.get(p.data);
  if (hit) return hit;
  const d = p.data;
  const [ox, oy] = (p.meta.origin ?? [0, 0]) as [number, number];
  const idx = (a?: NDArray) => (a?.data ?? new Uint32Array(0)) as Uint32Array;
  const xyz = (xy?: NDArray, z?: NDArray): Float64Array => {
    const src = (xy?.data ?? new Float32Array(0)) as Float32Array;
    const zs = z?.data as Float32Array | undefined;
    const out = new Float64Array((src.length / 2) * 3);
    for (let i = 0, j = 0; i < src.length; i += 2, j += 3) {
      out[j] = src[i] + ox;
      out[j + 1] = src[i + 1] + oy;
      const zv = zs ? zs[i / 2] : 0;
      out[j + 2] = Number.isFinite(zv) ? zv : 0;
    }
    return out;
  };

  const pts = xyz(d.points, d.points_z);
  const pointFeature = idx(d.point_feature);
  const points = Array.from(pointFeature, (feature, i) => ({ xyz: [pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]] as XYZ, feature }));

  const paths: RawPath[] = [];
  const lines = xyz(d.lines, d.lines_z);
  const lineOffsets = idx(d.line_offsets);
  const lineFeature = idx(d.line_feature);
  for (let i = 0; i + 1 < lineOffsets.length; i++) {
    paths.push({ xyz: lines.subarray(lineOffsets[i] * 3, lineOffsets[i + 1] * 3), feature: lineFeature[i], ring: false });
  }

  const rings = xyz(d.rings, d.rings_z);
  const ringOffsets = idx(d.ring_offsets);
  const polygonRings = idx(d.polygon_rings);
  const polygonFeature = idx(d.polygon_feature);
  const polygons: RawGeometry["polygons"] = [];
  for (let i = 0; i + 1 < polygonRings.length; i++) {
    const own: Float64Array[] = [];
    for (let r = polygonRings[i]; r < polygonRings[i + 1]; r++) {
      const ring = rings.subarray(ringOffsets[r] * 3, ringOffsets[r + 1] * 3);
      own.push(ring);
      paths.push({ xyz: ring, feature: polygonFeature[i], ring: true });
    }
    polygons.push({ rings: own, feature: polygonFeature[i] });
  }

  const raw = { points, paths, polygons };
  rawCache.set(p.data, raw);
  return raw;
}

/** Display coordinates ↔ the local horizontal frame of the scene. */
export interface Frame {
  metric: boolean;
  toLocal: (x: number, y: number) => [number, number];
  fromLocal: (x: number, y: number) => [number, number];
  /** Z of the reference plane: 0 on graph paper, the lowest Z on a map (elevations). */
  plane: number;
  zMin: number;
  zMax: number;
}

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON = 111_320;

export function makeFrame(entries: VarEntry[], map: boolean): Frame {
  const bounds = entries.map((e) => e.payload.meta.display_bounds as Bounds);
  const minX = Math.min(...bounds.map((b) => b[0]));
  const minY = Math.min(...bounds.map((b) => b[1]));
  const maxX = Math.max(...bounds.map((b) => b[2]));
  const maxY = Math.max(...bounds.map((b) => b[3]));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ranges = entries.map((e) => (e.payload.meta.z_range as [number, number] | null) ?? [0, 0]);
  // Geometries without Z sit at 0, so 0 is part of the range whenever one is shown.
  const flat = entries.some((e) => !e.payload.meta.z_range);
  const zMin = Math.min(...ranges.map((r) => r[0]), ...(flat ? [0] : []));
  const zMax = Math.max(...ranges.map((r) => r[1]), ...(flat ? [0] : []));
  const coslat = Math.cos((cy * Math.PI) / 180);
  return {
    metric: map,
    toLocal: map
      ? (x, y) => [(x - cx) * M_PER_DEG_LON * coslat, (y - cy) * M_PER_DEG_LAT]
      : (x, y) => [x - cx, y - cy],
    fromLocal: map
      ? (x, y) => [cx + x / (M_PER_DEG_LON * coslat), cy + y / M_PER_DEG_LAT]
      : (x, y) => [x + cx, y + cy],
    plane: map ? zMin : 0,
    zMin,
    zMax,
  };
}

/** Exaggeration that makes the Z span about a quarter of the horizontal extent (maps only). */
export function suggestedZScale(frame: Frame, width: number): number {
  const span = frame.zMax - frame.zMin;
  if (!frame.metric || !span || span >= width * 0.25) return 1;
  return Math.min(100, Math.max(1, Math.round((width * 0.25) / span)));
}

export interface Vertex {
  position: XYZ; // scene coordinates
  source: XYZ; // display x, y (paper units or lon/lat) and raw z
  name: string;
  feature: number;
}

export interface Shape {
  name: string;
  paths: { path: Float64Array; feature: number }[];
  footprints: { path: Float64Array }[];
  polygons: { polygon: { positions: Float64Array; holeIndices: number[] }; feature: number }[];
  drops: { path: Float64Array }[];
  vertices: Vertex[];
  top: XYZ; // label anchor: the highest corner of the shape
}

const MAX_DROPS = 6000;

export function buildShape(entry: VarEntry, frame: Frame, zScale: number): Shape {
  const raw = rawGeometry(entry.payload);
  const z = (v: number) => frame.plane + (v - frame.plane) * zScale;
  const scene = (src: Float64Array): Float64Array => {
    const out = new Float64Array(src.length);
    for (let i = 0; i < src.length; i += 3) {
      const [x, y] = frame.toLocal(src[i], src[i + 1]);
      out[i] = x;
      out[i + 1] = y;
      out[i + 2] = z(src[i + 2]);
    }
    return out;
  };
  const flatten = (path: Float64Array): Float64Array => {
    const out = path.slice();
    for (let i = 2; i < out.length; i += 3) out[i] = frame.plane;
    return out;
  };

  const vertices: Vertex[] = [];
  const drops: Shape["drops"] = [];
  let top: XYZ = [0, 0, -Infinity];
  const addVertex = (src: XYZ, pos: XYZ, feature: number) => {
    vertices.push({ position: pos, source: src, name: entry.name, feature });
    if (pos[2] !== frame.plane && drops.length < MAX_DROPS) drops.push({ path: new Float64Array([...pos, pos[0], pos[1], frame.plane]) });
    if (pos[2] > top[2] || (pos[2] === top[2] && pos[0] > top[0])) top = pos;
  };

  const paths: Shape["paths"] = [];
  const footprints: Shape["footprints"] = [];
  for (const p of raw.paths) {
    const path = scene(p.xyz);
    paths.push({ path, feature: p.feature });
    footprints.push({ path: flatten(path) });
    // Rings repeat their first vertex: skip the closing one.
    const n = path.length / 3 - (p.ring ? 1 : 0);
    for (let v = 0; v < n; v++) {
      addVertex([p.xyz[v * 3], p.xyz[v * 3 + 1], p.xyz[v * 3 + 2]], [path[v * 3], path[v * 3 + 1], path[v * 3 + 2]], p.feature);
    }
  }
  for (const pt of raw.points) {
    const [x, y] = frame.toLocal(pt.xyz[0], pt.xyz[1]);
    addVertex(pt.xyz, [x, y, z(pt.xyz[2])], pt.feature);
  }

  const polygons: Shape["polygons"] = raw.polygons.map((poly) => {
    const parts = poly.rings.map(scene);
    const positions = new Float64Array(parts.reduce((n, r) => n + r.length, 0));
    const holeIndices: number[] = [];
    let at = 0;
    parts.forEach((r, i) => {
      if (i > 0) holeIndices.push(at);
      positions.set(r, at);
      at += r.length;
    });
    return { polygon: { positions, holeIndices }, feature: poly.feature };
  });

  return { name: entry.name, paths, footprints, polygons, drops, vertices, top };
}

export interface Axes {
  grid: { from: XYZ; to: XYZ }[];
  zAxis: { from: XYZ; to: XYZ }[];
  ticks: { position: XYZ; text: string; anchor: "middle" | "end" | "start" }[];
  extent: [number, number, number, number, number, number]; // x0, y0, z0, x1, y1, z1 (scene)
}

const fmtTick = (v: number, step: number): string =>
  (Math.abs(v) < step * 1e-6 ? 0 : v).toFixed(Math.max(0, -Math.floor(Math.log10(step) + 1e-9)));

/** A ruled reference plane under the shapes, with ticks on two edges and a Z axis. */
export function buildAxes(shapes: Shape[], frame: Frame, zScale: number): Axes {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of shapes) {
    for (const v of s.vertices) {
      x0 = Math.min(x0, v.position[0]);
      y0 = Math.min(y0, v.position[1]);
      x1 = Math.max(x1, v.position[0]);
      y1 = Math.max(y1, v.position[1]);
    }
  }
  if (!Number.isFinite(x0)) [x0, y0, x1, y1] = [-1, -1, 1, 1];
  const size = Math.max(x1 - x0, y1 - y0, 1e-9);
  const step = niceStep(size / 6);
  const gx0 = Math.floor((x0 - size * 0.08) / step) * step;
  const gy0 = Math.floor((y0 - size * 0.08) / step) * step;
  const gx1 = Math.ceil((x1 + size * 0.08) / step) * step;
  const gy1 = Math.ceil((y1 + size * 0.08) / step) * step;
  const pz = frame.plane;

  const grid: Axes["grid"] = [];
  const ticks: Axes["ticks"] = [];
  for (let x = gx0; x <= gx1 + step * 1e-6; x += step) {
    grid.push({ from: [x, gy0, pz], to: [x, gy1, pz] });
  }
  for (let y = gy0; y <= gy1 + step * 1e-6; y += step) {
    grid.push({ from: [gx0, y, pz], to: [gx1, y, pz] });
  }
  // Tick labels show the original coordinates: graph-paper units, or metres from the corner on a map.
  const every = Math.max(1, Math.ceil((gx1 - gx0) / step / 6));
  for (let i = 0, x = gx0; x <= gx1 + step * 1e-6; i++, x += step) {
    if (i % every) continue;
    const text = frame.metric ? `${fmtTick(x - gx0, step)} m` : fmtTick(frame.fromLocal(x, 0)[0], step);
    ticks.push({ position: [x, gy0 - step * 0.35, pz], text, anchor: "middle" });
  }
  for (let i = 0, y = gy0; y <= gy1 + step * 1e-6; i++, y += step) {
    // Skip the first (shared with the X ticks) and the last (where the Z axis stands).
    if (i % every || i === 0 || y > gy1 - step * 0.5) continue;
    const text = frame.metric ? `${fmtTick(y - gy0, step)} m` : fmtTick(frame.fromLocal(0, y)[1], step);
    ticks.push({ position: [gx0 - step * 0.25, y, pz], text, anchor: "end" });
  }

  // Z axis at the back-left corner, ticked in real Z units (before exaggeration).
  const zLo = Math.min(frame.zMin, pz);
  const zHi = Math.max(frame.zMax, pz);
  const zStep = niceStep(Math.max(zHi - zLo, 1e-9) / 4);
  const zs = (v: number) => pz + (v - pz) * zScale;
  const zAxis: Axes["zAxis"] = [];
  const zFrom = Math.floor(zLo / zStep) * zStep;
  const zTo = Math.ceil(zHi / zStep) * zStep;
  if (zTo > zFrom) {
    zAxis.push({ from: [gx0, gy1, zs(zFrom)], to: [gx0, gy1, zs(zTo)] });
    for (let v = zFrom; v <= zTo + zStep * 1e-6; v += zStep) {
      zAxis.push({ from: [gx0, gy1, zs(v)], to: [gx0 + step * 0.15, gy1, zs(v)] });
      ticks.push({ position: [gx0 - step * 0.12, gy1, zs(v)], text: `${fmtTick(v, zStep)}${frame.metric ? " m" : ""}`, anchor: "end" });
    }
  }

  return { grid, zAxis, ticks, extent: [gx0, gy0, zs(zFrom), gx1, gy1, zs(zTo)] };
}
