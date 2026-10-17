// Geometries with Z in an orbit view (deck.gl). Shapes float at their height
// over a ruled reference plane, with their footprint and dashed drop lines.

import { OrbitView, type PickingInfo } from "@deck.gl/core";
import { PathStyleExtension } from "@deck.gl/extensions";
import { LineLayer, PathLayer, ScatterplotLayer, SolidPolygonLayer, TextLayer } from "@deck.gl/layers";
import DeckGL from "@deck.gl/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useStore, type VarEntry } from "../state/store";
import { hexToRgb, mix, THEME, varColorRgb, type RGB } from "../theme/themes";
import type { Mode } from "./display";
import { buildAxes, buildShape, makeFrame, suggestedZScale, type Vertex } from "./geometry3d";
import Tooltip, { fmt, type HoverInfo } from "./Tooltip";

interface OrbitState {
  target: [number, number, number];
  zoom: number;
  rotationX: number;
  rotationOrbit: number;
}

const DASH = new PathStyleExtension({ dash: true });
const rgba = (c: RGB, a: number): [number, number, number, number] => [c[0], c[1], c[2], Math.round(a)];

export default function Geometry3D({ entries, mode }: { entries: VarEntry[]; mode: Mode }) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const fitRequest = useStore((s) => s.fitRequest);
  const setGeometry3d = useStore((s) => s.setGeometry3d);
  const select = useStore((s) => s.select);

  const frame = useMemo(() => makeFrame(entries, mode === "map"), [entries, mode]);
  const flatShapes = useMemo(() => entries.map((e) => buildShape(e, frame, 1)), [entries, frame]);
  const width = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of flatShapes) for (const v of s.vertices) for (const c of [v.position[0], v.position[1]]) {
      lo = Math.min(lo, c);
      hi = Math.max(hi, c);
    }
    return Number.isFinite(hi - lo) ? hi - lo : 1;
  }, [flatShapes]);
  const [zScale, setZScale] = useState(() => suggestedZScale(frame, width));

  const shapes = useMemo(() => (zScale === 1 ? flatShapes : entries.map((e) => buildShape(e, frame, zScale))), [entries, frame, zScale, flatShapes]);
  const axes = useMemo(() => buildAxes(shapes, frame, zScale), [shapes, frame, zScale]);

  const fitView = (): OrbitState => {
    const [x0, y0, z0, x1, y1, z1] = axes.extent;
    const diagonal = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1;
    return {
      target: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
      zoom: Math.log2((Math.min(size.width, size.height) * 0.95) / diagonal),
      rotationX: 32,
      rotationOrbit: -32,
    };
  };
  const [view, setView] = useState<OrbitState | null>(null);

  useEffect(() => {
    const el = host.current!;
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit on first layout, on F, and whenever the content (or its exaggeration) changes.
  const fitKey = `${axes.extent.join()}|${size.width > 0}`;
  useEffect(() => {
    setView((v) => ({ ...fitView(), ...(v ? { rotationX: v.rotationX, rotationOrbit: v.rotationOrbit } : {}) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, fitRequest]);

  const paper = hexToRgb(THEME.paper);
  const pencil = hexToRgb(THEME.pencil);
  const ink = hexToRgb(THEME.ink);

  const layers = useMemo(() => {
    const out: any[] = [
      new LineLayer({
        id: "g3d-grid",
        data: axes.grid,
        getSourcePosition: (d: any) => d.from,
        getTargetPosition: (d: any) => d.to,
        getColor: rgba(hexToRgb(THEME.gridMajor), 255),
        getWidth: 1,
      }),
      new LineLayer({
        id: "g3d-zaxis",
        data: axes.zAxis,
        getSourcePosition: (d: any) => d.from,
        getTargetPosition: (d: any) => d.to,
        getColor: rgba(hexToRgb(THEME.axis), 255),
        getWidth: 1.25,
      }),
      new TextLayer({
        id: "g3d-ticks",
        data: axes.ticks,
        getPosition: (d: any) => d.position,
        getText: (d: any) => d.text,
        getTextAnchor: (d: any) => d.anchor,
        getAlignmentBaseline: "center",
        getColor: rgba(pencil, 255),
        getSize: 10,
        fontFamily: '"JetBrains Mono", monospace',
        characterSet: "auto",
      }),
    ];
    for (const s of shapes) {
      const entry = entries.find((e) => e.name === s.name)!;
      const color = varColorRgb(entry.color);
      const id = `g3d|${s.name}`;
      out.push(
        new PathLayer({
          id: `${id}|footprint`,
          data: s.footprints,
          getPath: (d: any) => d.path,
          positionFormat: "XYZ",
          getColor: rgba(mix(color, paper, 0.55), 200),
          getWidth: 1,
          widthUnits: "pixels",
          _pathType: "open",
        }),
        new PathLayer({
          id: `${id}|drops`,
          data: s.drops,
          getPath: (d: any) => d.path,
          positionFormat: "XYZ",
          getColor: rgba(color, 130),
          getWidth: 1,
          widthUnits: "pixels",
          getDashArray: [3, 3],
          dashJustified: true,
          extensions: [DASH],
        }),
        new SolidPolygonLayer({
          id: `${id}|fill`,
          data: s.polygons,
          getPolygon: (d: any) => d.polygon,
          positionFormat: "XYZ",
          getFillColor: rgba(color, 70),
          pickable: true,
        }),
        new PathLayer({
          id: `${id}|stroke`,
          data: s.paths,
          getPath: (d: any) => d.path,
          positionFormat: "XYZ",
          getColor: rgba(color, 255),
          getWidth: 2,
          widthUnits: "pixels",
          billboard: true,
          _pathType: "open",
          pickable: true,
        }),
        new ScatterplotLayer({
          id: `${id}|vertices`,
          data: s.vertices,
          getPosition: (d: Vertex) => d.position,
          getFillColor: rgba(mix(color, ink, 0.2), 255),
          getLineColor: rgba(paper, 255),
          stroked: true,
          lineWidthUnits: "pixels",
          getLineWidth: 1,
          radiusUnits: "pixels",
          getRadius: 3.5,
          billboard: true,
          pickable: true,
        }),
        new TextLayer({
          id: `${id}|label`,
          data: [s],
          getPosition: (d: any) => d.top,
          getText: (d: any) => d.name,
          getColor: rgba(mix(color, ink, 0.25), 255),
          getPixelOffset: [8, -8],
          getTextAnchor: "start",
          getAlignmentBaseline: "bottom",
          fontFamily: "Caveat",
          fontWeight: 600,
          getSize: 21,
          fontSettings: { sdf: true, fontSize: 72, buffer: 10 },
          outlineWidth: 5,
          outlineColor: rgba(paper, 235),
          characterSet: "auto",
        }),
      );
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shapes, axes, entries]);

  const onHover = (info: PickingInfo) => {
    const v = info.object as Vertex | undefined;
    if (!info.layer || !v?.source) {
      setHover(null);
      return;
    }
    const geo = mode === "map";
    setHover({
      x: info.x,
      y: info.y,
      title: v.name,
      rows: [
        [geo ? "lon" : "x", fmt(v.source[0], geo)],
        [geo ? "lat" : "y", fmt(v.source[1], geo)],
        ["z", fmt(v.source[2])],
      ],
    });
  };

  const onClick = (info: PickingInfo) => {
    const name = info.layer?.id.split("|")[1];
    select(name ?? null, name ? ((info.object as any)?.feature ?? null) : null);
  };

  return (
    <div ref={host} className="absolute inset-0" data-testid="geometry3d">
      {view && (
        <DeckGL
          views={new OrbitView({ id: "orbit", orbitAxis: "Z", fovy: 40, controller: { inertia: 200 } as any })}
          viewState={{ ...view, minZoom: -30, maxZoom: 40 } as any}
          onViewStateChange={({ viewState: vs }: any) =>
            setView({ target: vs.target, zoom: vs.zoom, rotationX: vs.rotationX, rotationOrbit: vs.rotationOrbit })
          }
          layers={layers}
          onHover={onHover}
          onClick={onClick}
          pickingRadius={6}
          getCursor={({ isDragging, isHovering }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
        />
      )}
      {hover && <Tooltip hover={hover} />}
      <div className="pointer-events-none absolute left-4 top-4 font-hand text-2xl text-emph">
        3D <span className="text-pencil">· geometries with Z{zScale !== 1 && ` · Z ×${zScale}`}</span>
      </div>
      <div className="absolute bottom-4 left-4 flex items-center gap-3 rounded border border-rule bg-panel/90 px-2.5 py-1.5 font-sans text-xs text-pencil shadow-sm">
        <button type="button" onClick={() => setGeometry3d(false)} className="hover:text-ink" data-testid="back-to-2d">
          Back to 2D
        </button>
        <span className="h-4 w-px bg-rule" />
        <label className="flex items-center gap-2" title="Vertical exaggeration (Z only; labels keep real values)">
          Z ×
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={zScale}
            onChange={(e) => setZScale(Number(e.target.value))}
            className="gs-range w-28"
            data-testid="z-scale"
          />
          <span className="w-7 font-mono text-ink">{zScale}</span>
        </label>
      </div>
      <div className="pointer-events-none absolute bottom-4 right-4 font-sans text-2xs text-faint">
        drag to orbit · shift-drag to pan · scroll to zoom
      </div>
    </div>
  );
}
