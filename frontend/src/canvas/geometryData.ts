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
  /** What still has to be added to positions to get real coordinates ([0,0] when absolute). */
  offset: [number, number];
}

const MAX_ARROWS = 4000;
const MAX_VERTEX_LABELS = 1500;
const cache = { offsets: new WeakMap<object, PreparedGeometry>(), absolute: new WeakMap<object, PreparedGeometry>() };

const idx = (a?: NDArray) => (a?.data ?? new Uint32Array(0)) as Uint32Array;

/**
 * ``absolute``: positions are real coordinates in Float64 (the orthographic
 * paper view ignores coordinateOrigin; deck.gl keeps fp64 precision itself).
 * Otherwise they stay Float32 offsets from ``meta.origin`` (map view).
 */
export function prepareGeometry(p: Payload, absolute = false): PreparedGeometry {
  const store = absolute ? cache.absolute : cache.offsets;
  const hit = store.get(p.data);
  if (hit) return hit;
  const d = p.data;
  const origin = (p.meta.origin ?? [0, 0]) as [number, number];
  const arr = (a?: NDArray): Coords => {
    const src = (a?.data ?? new Float32Array(0)) as Float32Array;
    if (!absolute) return src;
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
    for (let v = a; v + 1 < b && arrows.length < MAX_ARROWS; v++) {
      const x0 = lines[v * 2], y0 = lines[v * 2 + 1], x1 = lines[v * 2 + 2], y1 = lines[v * 2 + 3];
      if (x0 === x1 && y0 === y1) continue;
      arrows.push({
        position: [(x0 + x1) / 2, (y0 + y1) / 2],
        angle: (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI,
        feature: lineFeature[i],
      });
    }
  }

  const pts = arr(d.points);
  const pointFeature = idx(d.point_feature);
  const points: PointDatum[] = [];
  for (let i = 0; i < pointFeature.length; i++) points.push({ position: [pts[i * 2], pts[i * 2 + 1]], feature: pointFeature[i] });

  const vertices = absolute ? new Float64Array(lines.length + rings.length) : new Float32Array(lines.length + rings.length);
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
    const closed = absolute ? new Float64Array(10) : new Float32Array(10);
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
    offset: absolute ? [0, 0] : origin,
  };
  store.set(p.data, prepared);
  return prepared;
}
