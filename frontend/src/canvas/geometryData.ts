// Turn the flat buffers of a geometry payload into deck.gl-friendly objects.
// Everything is memoized per payload object, so styling changes never redo it.

import type { NDArray, Payload } from "../ws/protocol";

type Coords = Float32Array | Float64Array;

export interface PolygonDatum {
  polygon: { positions: Coords; holeIndices: number[] };
  feature: number;
}

export interface PathDatum {
  path: Coords;
  feature: number;
  ring: boolean;
}

export interface PointDatum {
  position: [number, number];
  feature: number;
}

export interface ArrowDatum {
  position: [number, number];
  angle: number;
  feature: number;
  /** World length of the segment the arrow sits on. */
  length: number;
  /** One arrow per line is kept whatever the zoom, so direction never disappears. */
  keep: boolean;
}

export interface VertexLabel {
  position: [number, number];
  text: string;
}

export interface PreparedGeometry {
  polygons: PolygonDatum[];
  paths: PathDatum[];
  points: PointDatum[];
  vertices: Coords; // all line + ring vertices, xy interleaved
  arrows: ArrowDatum[];
  vertexLabels: VertexLabel[];
  centroids: PointDatum[];
  bboxes: PathDatum[];
  origin: [number, number];
  /** Median world length of line and ring segments (0 without any). */
  segment: number;
}

const MAX_ARROWS = 4000;
const MAX_VERTEX_LABELS = 1500;
const cache = new WeakMap<object, PreparedGeometry>();

const idx = (a?: NDArray) => (a?.data ?? new Uint32Array(0)) as Uint32Array;

/**
 * Positions become absolute Float64 coordinates (graph-paper units or lon/lat).
 * The wire carries Float32 offsets from a Float64 origin; deck.gl splits
 * Float64 positions into high/low parts itself, so precision is preserved in
 * both views, and large extents (areas of use) are not distorted the way
 * LNGLAT_OFFSETS would distort them.
 */
export function prepareGeometry(p: Payload): PreparedGeometry {
  const hit = cache.get(p.data);
  if (hit) return hit;
  const d = p.data;
  const origin = (p.meta.origin ?? [0, 0]) as [number, number];
  const arr = (a?: NDArray): Coords => {
    const src = (a?.data ?? new Float32Array(0)) as Float32Array;
    const out = new Float64Array(src.length);
    for (let i = 0; i < src.length; i += 2) {
      out[i] = src[i] + origin[0];
      out[i + 1] = src[i + 1] + origin[1];
    }
    return out;
  };

  const rings = arr(d.rings);
  const ringOffsets = idx(d.ring_offsets);
  const polygonRings = idx(d.polygon_rings);
  const polygonFeature = idx(d.polygon_feature);
  const polygons: PolygonDatum[] = [];
  const paths: PathDatum[] = [];
  for (let i = 0; i + 1 < polygonRings.length; i++) {
    const r0 = polygonRings[i];
    const r1 = polygonRings[i + 1];
    const v0 = ringOffsets[r0];
    const v1 = ringOffsets[r1];
    const holeIndices: number[] = [];
    for (let r = r0 + 1; r < r1; r++) holeIndices.push((ringOffsets[r] - v0) * 2);
    polygons.push({ polygon: { positions: rings.subarray(v0 * 2, v1 * 2), holeIndices }, feature: polygonFeature[i] });
    for (let r = r0; r < r1; r++) {
      paths.push({ path: rings.subarray(ringOffsets[r] * 2, ringOffsets[r + 1] * 2), feature: polygonFeature[i], ring: true });
    }
  }

  const lines = arr(d.lines);
  const lineOffsets = idx(d.line_offsets);
  const lineFeature = idx(d.line_feature);
  const arrows: ArrowDatum[] = [];
  for (let i = 0; i + 1 < lineOffsets.length; i++) {
    const a = lineOffsets[i];
    const b = lineOffsets[i + 1];
    paths.push({ path: lines.subarray(a * 2, b * 2), feature: lineFeature[i], ring: false });
    const first = arrows.length;
    for (let v = a; v + 1 < b && arrows.length < MAX_ARROWS; v++) {
      const x0 = lines[v * 2], y0 = lines[v * 2 + 1], x1 = lines[v * 2 + 2], y1 = lines[v * 2 + 3];
      if (x0 === x1 && y0 === y1) continue;
      arrows.push({
        position: [(x0 + x1) / 2, (y0 + y1) / 2],
        angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI,
        feature: lineFeature[i],
        length: Math.hypot(x1 - x0, y1 - y0),
        keep: false,
      });
    }
    if (arrows.length > first) arrows[(first + arrows.length - 1) >> 1].keep = true;
  }

  const pts = arr(d.points);
  const pointFeature = idx(d.point_feature);
  const points: PointDatum[] = [];
  for (let i = 0; i < pointFeature.length; i++) points.push({ position: [pts[i * 2], pts[i * 2 + 1]], feature: pointFeature[i] });

  const vertices = new Float64Array(lines.length + rings.length);
  vertices.set(lines, 0);
  vertices.set(rings, lines.length);

  // Vertex numbering per feature, in drawing order (rings repeat their first vertex: skip it).
  const vertexLabels: VertexLabel[] = [];
  const counters = new Map<number, number>();
  const label = (x: number, y: number, feature: number) => {
    const n = counters.get(feature) ?? 0;
    counters.set(feature, n + 1);
    if (vertexLabels.length < MAX_VERTEX_LABELS) vertexLabels.push({ position: [x, y], text: String(n) });
  };
  for (const pt of points) label(pt.position[0], pt.position[1], pt.feature);
  for (const path of paths) {
    const n = path.path.length / 2 - (path.ring ? 1 : 0);
    for (let v = 0; v < n; v++) label(path.path[v * 2], path.path[v * 2 + 1], path.feature);
  }

  const cen = arr(d.centroids);
  const centroids: PointDatum[] = [];
  for (let i = 0; i * 2 < cen.length; i++) {
    if (Number.isFinite(cen[i * 2])) centroids.push({ position: [cen[i * 2], cen[i * 2 + 1]], feature: i });
  }
  const bb = arr(d.bboxes);
  const bboxes: PathDatum[] = [];
  for (let i = 0; i * 8 < bb.length; i++) {
    const box = bb.subarray(i * 8, i * 8 + 8);
    if (!Number.isFinite(box[0])) continue;
    const closed = new Float64Array(10);
    closed.set(box);
    closed.set(box.subarray(0, 2), 8);
    bboxes.push({ path: closed, feature: i, ring: true });
  }

  const prepared: PreparedGeometry = {
    polygons,
    paths,
    points,
    vertices,
    arrows,
    vertexLabels,
    centroids,
    bboxes,
    origin,
    segment: medianSegment(paths),
  };
  cache.set(p.data, prepared);
  return prepared;
}

/** Median segment length, sampled so huge geometries stay cheap. */
function medianSegment(paths: PathDatum[]): number {
  const lengths: number[] = [];
  let total = 0;
  for (const p of paths) total += p.path.length / 2;
  const stride = Math.max(1, Math.floor(total / 4000));
  for (const { path } of paths) {
    for (let v = 0; v + 3 < path.length; v += 2 * stride) {
      const d = Math.hypot(path[v + 2] - path[v], path[v + 3] - path[v + 1]);
      if (d > 0) lengths.push(d);
    }
  }
  if (!lengths.length) return 0;
  lengths.sort((a, b) => a - b);
  return lengths[lengths.length >> 1];
}

const anchors = new WeakMap<object, Map<boolean, [number, number]>>();

/**
 * Where a geometry's name label is pinned: the vertex closest to the top-right
 * of its extent (on screen), so the label touches the shape instead of
 * floating at a bounding-box corner.
 */
export function labelAnchor(p: Payload, flipY: boolean): [number, number] | null {
  let byFlip = anchors.get(p.data);
  if (!byFlip) anchors.set(p.data, (byFlip = new Map()));
  const hit = byFlip.get(flipY);
  if (hit) return hit;
  const g = prepareGeometry(p);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const pt of g.points) xs.push(pt.position[0]), ys.push(pt.position[1]);
  const stride = Math.max(1, Math.floor(g.vertices.length / 2 / 20000));
  for (let i = 0; i + 1 < g.vertices.length; i += 2 * stride) xs.push(g.vertices[i]), ys.push(g.vertices[i + 1]);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  }
  if (!Number.isFinite(minX)) return null;
  const w = maxX - minX || 1;
  const h = maxY - minY || 1;
  let best: [number, number] = [maxX, flipY ? minY : maxY];
  let score = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue;
    const up = flipY ? (maxY - ys[i]) / h : (ys[i] - minY) / h;
    // Favour the top a little: labels read best above a shape.
    const s = (xs[i] - minX) / w + 1.15 * up;
    if (s > score) (score = s), (best = [xs[i], ys[i]]);
  }
  byFlip.set(flipY, best);
  return best;
}
