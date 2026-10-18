// deck.gl layers for every payload kind. Positions are Float32 offsets from a
// per-variable Float64 origin (coordinateOrigin), so precision survives.

import { COORDINATE_SYSTEM, type Layer } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { IconLayer, LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from "@deck.gl/layers";
import { Matrix4 } from "@math.gl/core";

import type { RasterStyle, Toggles, VarEntry } from "../state/store";
import { colormapLut } from "../theme/colormaps";
import { hexToRgb, mix, THEME, varColorRgb, type RGB } from "../theme/themes";
import type { NDArray, Payload } from "../ws/protocol";
import { ColormapLayer } from "./ColormapLayer";
import { displayOf, mercatorToLngLat, rasterOf, type Mode } from "./display";
import { labelAnchor, prepareGeometry } from "./geometryData";

export interface LayerContext {
  mode: Mode;
  /** World/lng-lat → screen pixels, for label layout and density checks. */
  project?: (xy: [number, number]) => [number, number];
  unproject?: (xy: [number, number]) => [number, number];
  flipY: boolean;
  toggles: Toggles;
  selected: { name: string; feature: number | null } | null;
  /** Variable under the mouse: it shows its vertices even when they are dense. */
  hovered: string | null;
  styles: Record<string, RasterStyle>;
  now: number;
}

export const TRANSITION_MS = 260;
const DASH = new PathStyleExtension({ dash: true });
const RED = hexToRgb(THEME.danger);

const ARROW_ICON =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path d="M9 6 L23 16 L9 26" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  );
const ARROW_MAPPING = { arrow: { x: 0, y: 0, width: 32, height: 32, mask: true } };

// Positions are absolute Float64 (see prepareGeometry): lon/lat on the map, plain units on paper.
function coordinateProps(mode: Mode): any {
  return { coordinateSystem: mode === "map" ? COORDINATE_SYSTEM.LNGLAT : COORDINATE_SYSTEM.CARTESIAN };
}

/** Fade-in scale around the variable's center. */
function growMatrix(origin: [number, number], t: number): Matrix4 | null {
  if (t >= 1) return null;
  const s = 0.94 + 0.06 * t;
  return new Matrix4().translate([origin[0], origin[1], 0]).scale([s, s, 1]).translate([-origin[0], -origin[1], 0]);
}

function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 0→1 over TRANSITION_MS after the variable's latest update. */
export function progress(entry: VarEntry, now: number): number {
  return easeOut(Math.min(1, Math.max(0, (now - entry.updatedAt) / TRANSITION_MS)));
}

const rgba = (c: RGB, a: number): [number, number, number, number] => [c[0], c[1], c[2], Math.round(a)];

/** When something is selected, everything else steps back to this opacity. */
const DIMMED = 0.3;
/** Vertex dots closer than this on screen read as beads: hide them. */
const MIN_VERTEX_GAP = 7;
/** Direction arrows need a segment at least this long on screen. */
const MIN_ARROW_SEGMENT = 28;

function dimFactor(name: string, ctx: LayerContext): number {
  return ctx.selected && ctx.selected.name !== name ? DIMMED : 1;
}

/** Screen pixels per world unit around a point (Infinity when unknown). */
function pixelsPerUnit(ctx: LayerContext, at: [number, number], unit: number): number {
  if (!ctx.project || !(unit > 0)) return Infinity;
  const a = ctx.project(at);
  const b = ctx.project([at[0] + unit, at[1]]);
  return Math.hypot(b[0] - a[0], b[1] - a[1]) / unit;
}

// ---------------------------------------------------------------- geometry-like kinds
interface GeometryStyle {
  color: RGB;
  fillAlpha: number;
  strokeAlpha: number;
  width: number;
  dashed: boolean;
  vertices: boolean;
  arrows: boolean;
}

function geometryLayers(
  id: string,
  p: Payload,
  style: GeometryStyle,
  ctx: LayerContext,
  t: number,
  pickable: boolean,
): Layer[] {
  const g = prepareGeometry(p);
  const coords = coordinateProps(ctx.mode);
  const invalid = new Set<number>((p.meta.invalid ?? []).map((i: any) => i.feature));
  const modelMatrix = growMatrix(g.origin, t);
  const common = { ...coords, modelMatrix, opacity: t * dimFactor(p.name, ctx), pickable, parameters: { depthTest: false } as any };
  const sel = ctx.selected;
  const isSelected = sel?.name === p.name;
  const focused = isSelected || ctx.hovered === p.name;
  const scale = pixelsPerUnit(ctx, g.origin, g.segment || 1);
  const inFocus = (d: { feature: number }) => sel?.feature == null || sel.feature === d.feature;
  const colorFor = (feature: number, alpha: number) =>
    rgba(invalid.has(feature) ? RED : style.color, isSelected && sel?.feature === feature ? Math.min(255, alpha * 1.8) : alpha);
  const width = isSelected ? style.width * 1.6 : style.width;
  const layers: Layer[] = [];

  // A soft halo under the selected variable (or just the clicked feature).
  if (isSelected && pickable) {
    const halo = rgba(style.color, 60);
    const paths = g.paths.filter(inFocus);
    const points = g.points.filter(inFocus);
    if (paths.length) {
      layers.push(
        new PathLayer({
          id: `${id}-halo`,
          data: paths,
          getPath: (d: any) => d.path,
          positionFormat: "XY",
          _pathType: "open",
          getColor: halo,
          getWidth: width + 7,
          widthUnits: "pixels",
          jointRounded: true,
          capRounded: true,
          ...common,
          pickable: false,
        } as any),
      );
    }
    if (points.length) {
      layers.push(
        new ScatterplotLayer({
          id: `${id}-halo-points`,
          data: points,
          getPosition: (d: any) => d.position,
          getFillColor: halo,
          getRadius: 11,
          radiusUnits: "pixels",
          ...common,
          pickable: false,
        }),
      );
    }
  }

  if (style.fillAlpha > 0 && g.polygons.length) {
    layers.push(
      new SolidPolygonLayer({
        id: `${id}-fill`,
        data: g.polygons,
        getPolygon: (d: any) => d.polygon,
        positionFormat: "XY",
        getFillColor: (d: any) => colorFor(d.feature, invalid.has(d.feature) ? 26 : style.fillAlpha),
        updateTriggers: { getFillColor: [style.color, isSelected, sel?.feature, style.fillAlpha] },
        ...common,
      }),
    );
  }
  if (g.paths.length) {
    const anyDashed = style.dashed || invalid.size > 0;
    layers.push(
      new PathLayer({
        id: `${id}-stroke`,
        data: g.paths,
        getPath: (d: any) => d.path,
        positionFormat: "XY",
        _pathType: "open",
        getColor: (d: any) => colorFor(d.feature, style.strokeAlpha),
        getWidth: width,
        widthUnits: "pixels",
        jointRounded: true,
        capRounded: true,
        ...(anyDashed
          ? {
              extensions: [DASH],
              getDashArray: (d: any) => (style.dashed || invalid.has(d.feature) ? [5, 4] : [0, 0]),
              dashJustified: true,
            }
          : {}),
        updateTriggers: { getColor: [style.color, isSelected, sel?.feature, style.strokeAlpha], getDashArray: [style.dashed] },
        ...common,
      } as any),
    );
  }
  // Vertices closer than a few pixels (buffers, dense curves) only show on hover or selection.
  const dense = g.segment * scale < MIN_VERTEX_GAP;
  if (style.vertices && g.vertices.length && (!dense || focused)) {
    layers.push(
      new ScatterplotLayer({
        id: `${id}-vertices`,
        data: { length: g.vertices.length / 2, attributes: { getPosition: { value: g.vertices, size: 2 } } } as any,
        getFillColor: rgba(mix(style.color, hexToRgb(THEME.ink), 0.35), dense ? 120 : 230),
        getRadius: (isSelected ? 2.6 : 2) * (dense ? 0.6 : 1),
        radiusUnits: "pixels",
        ...common,
      }),
    );
  }
  if (g.points.length) {
    layers.push(
      new ScatterplotLayer({
        id: `${id}-points`,
        data: g.points,
        getPosition: (d: any) => d.position,
        getFillColor: (d: any) => colorFor(d.feature, Math.max(style.strokeAlpha * 0.85, 40)),
        getLineColor: rgba(hexToRgb(THEME.paper), style.vertices ? 255 : 0),
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
        getRadius: isSelected ? 5.5 : 4.5,
        radiusUnits: "pixels",
        updateTriggers: { getFillColor: [style.color, isSelected, sel?.feature, style.strokeAlpha] },
        ...common,
      }),
    );
  }
  // Arrows only on segments long enough to carry one; every line keeps at least one.
  const arrows = style.arrows ? g.arrows.filter((a) => a.keep || a.length * scale >= MIN_ARROW_SEGMENT) : [];
  if (arrows.length) {
    layers.push(
      new IconLayer({
        id: `${id}-arrows`,
        data: arrows,
        iconAtlas: ARROW_ICON,
        iconMapping: ARROW_MAPPING,
        getIcon: () => "arrow",
        getPosition: (d: any) => d.position,
        // Icon angles are counter-clockwise on screen; a y-down canvas mirrors them.
        getAngle: (d: any) => (ctx.flipY ? -d.angle : d.angle),
        getSize: 11,
        sizeUnits: "pixels",
        getColor: rgba(style.color, 190),
        billboard: true,
        updateTriggers: { getAngle: ctx.flipY },
        ...common,
        pickable: false,
      }),
    );
  }
  return layers;
}

function overlayLayers(id: string, p: Payload, color: RGB, ctx: LayerContext, t: number): Layer[] {
  const g = prepareGeometry(p);
  const coords = coordinateProps(ctx.mode);
  const ink = hexToRgb(THEME.ink);
  const pencil = hexToRgb(THEME.pencil);
  const paper = hexToRgb(THEME.paper);
  const layers: Layer[] = [];
  const common = { ...coords, opacity: t * dimFactor(p.name, ctx), parameters: { depthTest: false } as any };

  // Problem locations of invalid geometries.
  const problems = (p.meta.invalid ?? [])
    .filter((i: any) => i.display)
    .map((i: any) => ({ ...i, display: [i.display[0] + g.origin[0], i.display[1] + g.origin[1]] }));
  if (problems.length) {
    layers.push(
      new ScatterplotLayer({
        id: `${id}-problem`,
        data: problems,
        getPosition: (d: any) => d.display,
        getFillColor: rgba(RED, 40),
        getLineColor: rgba(RED, 255),
        stroked: true,
        getRadius: 9,
        radiusUnits: "pixels",
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
        pickable: true,
        ...common,
      }),
    );
  }
  if (ctx.toggles.bboxes && g.bboxes.length) {
    layers.push(
      new PathLayer({
        id: `${id}-bbox`,
        data: g.bboxes,
        getPath: (d: any) => d.path,
        positionFormat: "XY",
        getColor: rgba(pencil, 150),
        getWidth: 1,
        widthUnits: "pixels",
        extensions: [DASH],
        getDashArray: [2, 3],
        ...common,
      } as any),
    );
  }
  if (ctx.toggles.centroids && g.centroids.length) {
    layers.push(
      new ScatterplotLayer({
        id: `${id}-centroids`,
        data: g.centroids,
        getPosition: (d: any) => d.position,
        getFillColor: rgba(paper, 255),
        getLineColor: rgba(ink, 220),
        stroked: true,
        getRadius: 3.5,
        radiusUnits: "pixels",
        lineWidthUnits: "pixels",
        getLineWidth: 1.5,
        ...common,
      }),
      new TextLayer({
        id: `${id}-centroid-mark`,
        data: g.centroids,
        getPosition: (d: any) => d.position,
        getText: () => "c",
        fontFamily: "JetBrains Mono",
        getSize: 10,
        getColor: rgba(ink, 200),
        getPixelOffset: [7, -7],
        characterSet: "c",
        ...common,
      }),
    );
  }
  if (ctx.toggles.vertexNumbers && g.vertexLabels.length) {
    layers.push(
      new TextLayer({
        id: `${id}-vertex-numbers`,
        data: g.vertexLabels,
        getPosition: (d: any) => d.position,
        getText: (d: any) => d.text,
        fontFamily: "JetBrains Mono",
        getSize: 10,
        getColor: rgba(mix(color, ink, 0.5), 255),
        getPixelOffset: [6, -6],
        getTextAnchor: "start",
        fontSettings: { sdf: true, fontSize: 48, buffer: 6 },
        outlineWidth: 3,
        outlineColor: rgba(paper, 255),
        characterSet: "0123456789",
        ...common,
      }),
    );
  }
  return layers;
}

type TextAnchor = "start" | "end";
type Baseline = "bottom" | "top";

interface LabelSpec {
  /** World (or lng/lat) point the label belongs to. */
  position: [number, number];
  text: string;
  color: [number, number, number, number];
  offset: [number, number];
  textAnchor: TextAnchor;
  baseline: Baseline;
  size: number;
  /** Keep the given offset: no candidate search. */
  fixed?: boolean;
  /** Pushed away from its point: draw a guide line back to it. */
  leader?: boolean;
}

const LABEL_SIZE = 21;

function labelSpec(entry: VarEntry, text: string, ctx: LayerContext, t: number, color: RGB): LabelSpec | null {
  const disp = displayOf(entry.payload, ctx.styles[entry.name]);
  if (!disp) return null;
  const [, minY, maxX, maxY] = disp.bounds;
  // Geometries pin the label on the shape itself; other kinds on their extent's
  // top-right corner (in a y-down canvas "top" is minY).
  const anchor = entry.payload.kind === "geometry" ? labelAnchor(entry.payload, ctx.flipY) : null;
  const ink = hexToRgb(THEME.ink);
  return {
    position: anchor ?? [maxX, ctx.flipY ? minY : maxY],
    text,
    color: rgba(mix(color, ink, 0.25), 255 * t * dimFactor(entry.name, ctx)),
    offset: [7, -3],
    textAnchor: "start",
    baseline: "bottom",
    size: LABEL_SIZE,
  };
}

/** Handwritten notes next to the problem spots of invalid geometries. */
function problemLabels(p: Payload, t: number, ctx: LayerContext): LabelSpec[] {
  const g = prepareGeometry(p);
  return (p.meta.invalid ?? [])
    .filter((i: any) => i.display)
    .map((i: any) => ({
      // Label layer positions are absolute (paper) or lng/lat (map).
      position: [i.display[0] + g.origin[0], i.display[1] + g.origin[1]] as [number, number],
      text: String(i.reason).replace(/\[.*$/, "").toLowerCase(),
      color: rgba(RED, 255 * t * dimFactor(p.name, ctx)),
      offset: [12, 28] as [number, number],
      textAnchor: "start" as const,
      baseline: "bottom" as const,
      size: 18,
      fixed: true,
    }));
}

/** Up-right first, then the other three corners around the label's point. */
const CANDIDATES: { offset: [number, number]; textAnchor: TextAnchor; baseline: Baseline }[] = [
  { offset: [7, -3], textAnchor: "start", baseline: "bottom" },
  { offset: [7, 3], textAnchor: "start", baseline: "top" },
  { offset: [-7, -3], textAnchor: "end", baseline: "bottom" },
  { offset: [-7, 3], textAnchor: "end", baseline: "top" },
];

type Rect = [number, number, number, number];

let measureCtx: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();

/** Rendered width of a Caveat label, measured once with a 2D canvas. */
function textWidth(text: string, size: number): number {
  const key = `${size}|${text}`;
  const hit = widths.get(key);
  if (hit !== undefined) return hit;
  measureCtx ??= document.createElement("canvas").getContext("2d");
  let w = text.length * size * 0.36;
  if (measureCtx) {
    measureCtx.font = `600 ${size}px Caveat`;
    w = measureCtx.measureText(text).width;
  }
  // Fonts may still be loading: only cache real measurements.
  if (document.fonts?.check?.(`600 ${size}px Caveat`)) widths.set(key, w);
  return w;
}

function labelRect(x: number, y: number, l: LabelSpec): Rect {
  const w = textWidth(l.text, l.size) + 6;
  const left = l.textAnchor === "start" ? x + l.offset[0] : x + l.offset[0] - w;
  const top = l.baseline === "bottom" ? y + l.offset[1] - l.size : y + l.offset[1];
  return [left, top, left + w, top + l.size];
}

const overlaps = (r: Rect, placed: Rect[]) => placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);

/**
 * Greedy placement in screen space: try the four corners around each label's
 * point; if all collide, move it away and draw a guide line back.
 */
function layoutLabels(labels: LabelSpec[], project?: (xy: [number, number]) => [number, number]): void {
  if (!project) return;
  const placed: Rect[] = [];
  for (const l of labels) {
    const [x, y] = project(l.position);
    if (l.fixed) {
      placed.push(labelRect(x, y, l));
      continue;
    }
    const free = CANDIDATES.find((c) => !overlaps(labelRect(x, y, { ...l, ...c }), placed));
    if (free) {
      Object.assign(l, free);
      placed.push(labelRect(x, y, l));
      continue;
    }
    // Step away from the point, alternating up and down, so the guide line stays short.
    Object.assign(l, CANDIDATES[0]);
    for (let attempt = 1; attempt <= 10; attempt++) {
      const step = Math.ceil(attempt / 2) * (attempt % 2 ? -1 : 1) * (l.size - 2);
      const moved = { ...l, offset: [CANDIDATES[0].offset[0] + 10, CANDIDATES[0].offset[1] + step] as [number, number] };
      if (!overlaps(labelRect(x, y, moved), placed) || attempt === 10) {
        l.offset = moved.offset;
        l.leader = true;
        placed.push(labelRect(x, y, l));
        break;
      }
    }
  }
}

function labelLayers(labels: LabelSpec[], ctx: LayerContext): Layer[] {
  const paper = hexToRgb(THEME.paper);
  const coordinateSystem = (ctx.mode === "map" ? COORDINATE_SYSTEM.LNGLAT : COORDINATE_SYSTEM.CARTESIAN) as any;
  const leaders =
    ctx.project && ctx.unproject
      ? labels
          .filter((l) => l.leader)
          .map((l) => {
            const [x, y] = ctx.project!(l.position);
            return { from: l.position, to: ctx.unproject!([x + l.offset[0] - 2, y + l.offset[1] - l.size * 0.4]), color: l.color };
          })
      : [];
  return [
    new LineLayer({
      id: "label-leaders",
      data: leaders,
      getSourcePosition: (d: any) => d.from,
      getTargetPosition: (d: any) => d.to,
      getColor: (d: any) => [d.color[0], d.color[1], d.color[2], d.color[3] * 0.55],
      getWidth: 1,
      widthUnits: "pixels",
      coordinateSystem,
      parameters: { depthTest: false } as any,
    }),
    new TextLayer({
      id: "labels",
      data: labels,
      getPosition: (d: any) => d.position,
      getText: (d: any) => d.text,
      getColor: (d: any) => d.color,
      getPixelOffset: (d: any) => d.offset,
      fontFamily: "Caveat",
      fontWeight: 600,
      getSize: (d: any) => d.size,
      getTextAnchor: (d: any) => d.textAnchor,
      getAlignmentBaseline: (d: any) => d.baseline,
      fontSettings: { sdf: true, fontSize: 72, buffer: 10 },
      outlineWidth: 5,
      outlineColor: rgba(paper, 235),
      characterSet: "auto",
      coordinateSystem,
      parameters: { depthTest: false } as any,
      updateTriggers: {
        getColor: [labels.map((l) => l.color[3]).join()],
        getPixelOffset: [labels.map((l) => l.offset.join()).join()],
        getTextAnchor: [labels.map((l) => l.textAnchor).join()],
        getAlignmentBaseline: [labels.map((l) => l.baseline).join()],
      },
    }),
  ];
}

// ---------------------------------------------------------------- rasters
const texelCache = new WeakMap<object, Map<number, Float32Array>>();

/** Interleave one slice of values with its validity mask: [value, valid, value, valid…]. */
export function sliceTexels(values: NDArray, mask: NDArray, index: number): Float32Array {
  let byIndex = texelCache.get(values);
  if (!byIndex) texelCache.set(values, (byIndex = new Map()));
  const hit = byIndex.get(index);
  if (hit) return hit;
  const [, h, w] = values.shape;
  const n = h * w;
  const v = values.data as Float32Array;
  const m = mask.data as Uint8Array;
  const mOffset = mask.shape[0] === 1 ? 0 : index * n;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = v[index * n + i];
    out[i * 2 + 1] = m[mOffset + i];
  }
  byIndex.set(index, out);
  return out;
}

export function sliceIndex(meta: Record<string, any>, style: RasterStyle): number {
  const dims = meta.cube?.dims as { size: number }[] | undefined;
  if (!dims?.length) return style.band;
  let index = 0;
  for (let i = 0; i < dims.length; i++) index = index * dims[i].size + (style.slice[i] ?? 0);
  return index;
}

export function stretchRange(meta: Record<string, any>, style: RasterStyle): [number, number] {
  const s = (meta.cube ? meta.stats_global : meta.stats?.[style.band]) ?? meta.stats_global;
  if (!s) return [0, 1];
  return style.stretch === "minmax" ? [s.min, s.max] : [s.p2, s.p98];
}

function rasterLayer(id: string, entry: VarEntry, ctx: LayerContext, t: number): Layer | null {
  const style = ctx.styles[entry.name];
  const r = rasterOf(entry.payload, style);
  if (!r || !style) return null;
  const { values, mask } = r.data as { values: NDArray; mask: NDArray };
  const index = sliceIndex(r.meta, style);
  const [, h, w] = values.shape;
  const disp = r.meta.display;
  let bounds: [number, number, number, number];
  if (disp.mode === "map") {
    const [l, b, rr, tt] = disp.bounds3857;
    const [west, south] = mercatorToLngLat(l, b);
    const [east, north] = mercatorToLngLat(rr, tt);
    bounds = [west, south, east, north];
  } else {
    const shape = r.meta.shape as number[];
    const W = shape[shape.length - 1];
    const H = shape[shape.length - 2];
    // [left, bottom, right, top]: the first row sits at y = 0 (top of a y-down canvas).
    bounds = ctx.flipY ? [0, H, W, 0] : [0, -H, W, 0];
  }
  const [vmin, vmax] = stretchRange(r.meta, style);
  return new ColormapLayer({
    id: `${id}-raster`,
    texels: sliceTexels(values, mask, index),
    texWidth: w,
    texHeight: h,
    lut: colormapLut(style.colormap, style.reverse),
    vmin,
    vmax,
    fade: t,
    bounds,
    pickable: true,
    coordinateSystem: disp.mode === "map" ? COORDINATE_SYSTEM.LNGLAT : COORDINATE_SYSTEM.CARTESIAN,
    parameters: { depthTest: false } as any,
  } as any);
}

// ---------------------------------------------------------------- transforms
function transformLayers(id: string, entry: VarEntry, t: number, color: RGB, ghost: boolean, dim: number): Layer[] {
  const p = entry.payload;
  if (!p.meta.placed || !p.data.src) return [];
  const src = p.data.src.data as Float32Array;
  const dst = p.data.dst.data as Float32Array;
  const flags = p.data.flags.data as Uint8Array;
  const [ox, oy] = p.meta.origin as [number, number];
  const pairs = Array.from({ length: flags.length }, (_, i) => ({
    i,
    src: [src[i * 2] + ox, src[i * 2 + 1] + oy] as [number, number],
    dst: [dst[i * 2] + ox, dst[i * 2 + 1] + oy] as [number, number],
    ok: flags[i] === 1,
  })).filter((d) => Number.isFinite(d.src[0]) && Number.isFinite(d.dst[0]));
  const coords = coordinateProps("map");
  const paper = hexToRgb(THEME.paper);
  const a = ghost ? 0.35 : 1;
  const common = { ...coords, opacity: (ghost ? 1 : t) * dim, parameters: { depthTest: false } as any };
  const layers: Layer[] = [
    new LineLayer({
      id: `${id}-links`,
      data: pairs,
      getSourcePosition: (d: any) => d.src,
      getTargetPosition: (d: any) => d.dst,
      getColor: (d: any) => rgba(d.ok ? color : RED, 200 * a),
      getWidth: 1.5,
      widthUnits: "pixels",
      ...common,
    }),
    new ScatterplotLayer({
      id: `${id}-src`,
      data: pairs,
      getPosition: (d: any) => d.src,
      getFillColor: rgba(paper, ghost ? 0 : 160),
      getLineColor: (d: any) => rgba(d.ok ? color : RED, 255 * a),
      stroked: true,
      getRadius: 7,
      radiusUnits: "pixels",
      lineWidthUnits: "pixels",
        getLineWidth: 1.5,
      pickable: !ghost,
      ...common,
    }),
    new ScatterplotLayer({
      id: `${id}-dst`,
      data: pairs,
      getPosition: (d: any) => d.dst,
      getFillColor: (d: any) => rgba(d.ok ? color : RED, 255 * a),
      getRadius: 3,
      radiusUnits: "pixels",
      pickable: !ghost,
      ...common,
    }),
  ];
  return layers;
}

// ---------------------------------------------------------------- entry point
export function buildLayers(entries: VarEntry[], ctx: LayerContext): Layer[] {
  const below: Layer[] = []; // rasters and areas of use
  const middle: Layer[] = []; // ghosts
  const above: Layer[] = []; // geometries
  const top: Layer[] = []; // overlays
  const labels: LabelSpec[] = [];

  // The selected variable is drawn last, so it is never hidden under another one.
  const ordered = ctx.selected
    ? [...entries.filter((e) => e.name !== ctx.selected!.name), ...entries.filter((e) => e.name === ctx.selected!.name)]
    : entries;
  for (const entry of ordered) {
    const p = entry.payload;
    const disp = displayOf(p, ctx.styles[entry.name]);
    if (!entry.visible || !disp || disp.mode !== ctx.mode) continue;
    const id = layerId(entry.name);
    const color = varColorRgb(entry.color);
    const t = progress(entry, ctx.now);
    const showGhost = ctx.toggles.ghosts && entry.ghost && displayOf(entry.ghost)?.mode === ctx.mode;

    switch (p.kind) {
      case "geometry": {
        if (showGhost) {
          middle.push(
            ...geometryLayers(
              `${id}-ghost`,
              entry.ghost!,
              { color, fillAlpha: 0, strokeAlpha: 150, width: 1.4, dashed: true, vertices: false, arrows: false },
              ctx,
              1,
              false,
            ),
          );
        }
        above.push(
          ...geometryLayers(
            id,
            p,
            { color, fillAlpha: 46, strokeAlpha: 255, width: 1.6, dashed: false, vertices: true, arrows: true },
            ctx,
            t,
            true,
          ),
        );
        top.push(...overlayLayers(id, p, color, ctx, t));
        labels.push(...problemLabels(p, t, ctx));
        const label = labelSpec(entry, entry.name, ctx, t, color);
        if (label) labels.push(label);
        break;
      }
      case "crs":
      case "transformer": {
        below.push(
          ...geometryLayers(
            id,
            p,
            { color, fillAlpha: 18, strokeAlpha: 200, width: 1.2, dashed: true, vertices: false, arrows: false },
            ctx,
            t,
            true,
          ),
        );
        const label = labelSpec(entry, `${entry.name} · area of use`, ctx, t, color);
        if (label) labels.push(label);
        break;
      }
      case "transform": {
        const dim = dimFactor(entry.name, ctx);
        if (showGhost) middle.push(...transformLayers(`${id}-ghost`, { ...entry, payload: entry.ghost! }, 1, color, true, dim));
        above.push(...transformLayers(id, entry, t, color, false, dim));
        break;
      }
      case "raster":
      case "dataset": {
        const layer = rasterLayer(id, entry, ctx, t);
        if (layer) below.push(layer);
        const label = labelSpec(entry, entry.name, ctx, t, color);
        if (label) labels.push(label);
        break;
      }
    }
  }
  layoutLabels(labels, ctx.project);
  return [...below, ...middle, ...above, ...top, ...labelLayers(labels, ctx)];
}

// Layer ids are `v:<name>␟<role>`; ␟ cannot clash with real variable names in practice.
const SEP = "␟";

export function layerId(name: string): string {
  return `v:${name}${SEP}`;
}

export function parseLayerId(id: string): { name: string; role: string } | null {
  if (!id.startsWith("v:")) return null;
  const i = id.indexOf(SEP);
  return i < 0 ? null : { name: id.slice(2, i), role: id.slice(i + 1) };
}
