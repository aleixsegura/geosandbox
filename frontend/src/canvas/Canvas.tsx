import { MapView, OrthographicView, OrthographicViewport, WebMercatorViewport, type PickingInfo } from "@deck.gl/core";
import DeckGL from "@deck.gl/react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Map as MapLibre } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";

import { useStore, type VarEntry } from "../state/store";
import { basemapStyle } from "../theme/basemap";
import { THEMES } from "../theme/themes";
import CanvasToolbar from "./CanvasToolbar";
import { displayOf, resolveMode, unionBounds, type Bounds, type Mode } from "./display";
import GraphPaper, { type PaperView } from "./GraphPaper";
import { buildLayers, parseLayerId, TRANSITION_MS } from "./layers";
import Tooltip, { describeHover, type HoverInfo } from "./Tooltip";

const Relief3D = lazy(() => import("./Relief3D"));

interface MapViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

// Room around fitted content: axis labels on the left/bottom, name labels on the right, toolbar on top.
const PAD = { left: 64, right: 170, top: 72, bottom: 48 };

function fitPaper(b: Bounds, w: number, h: number, flipY: boolean): PaperView {
  const bw = Math.max(b[2] - b[0], 1e-9);
  const bh = Math.max(b[3] - b[1], 1e-9);
  const size = Math.max(bw, bh);
  // Degenerate extents (a single point) get a comfortable unit-sized window.
  const fw = bw < size * 1e-6 ? size || 1 : bw;
  const fh = bh < size * 1e-6 ? size || 1 : bh;
  const availW = Math.max(80, w - PAD.left - PAD.right);
  const availH = Math.max(80, h - PAD.top - PAD.bottom);
  const zoom = Math.log2(Math.min(availW / fw, availH / fh));
  const scale = 2 ** zoom;
  // Center the content inside the padded box, then express it as the view target.
  const cx = (b[0] + b[2]) / 2 + (PAD.right - PAD.left) / 2 / scale;
  const shiftY = (PAD.top - PAD.bottom) / 2 / scale;
  const cy = (b[1] + b[3]) / 2 + (flipY ? -shiftY : shiftY);
  return { target: [cx, cy], zoom: Number.isFinite(zoom) ? zoom : 0 };
}

function fitMap(b: Bounds, w: number, h: number): MapViewState {
  const pad = (b[2] - b[0] < 1e-6 && b[3] - b[1] < 1e-6) ? 0.01 : 0;
  const vp = new WebMercatorViewport({ width: Math.max(w, 100), height: Math.max(h, 100) });
  const { longitude, latitude, zoom } = vp.fitBounds(
    [
      [Math.max(-180, b[0] - pad), Math.max(-85, b[1] - pad)],
      [Math.min(180, b[2] + pad), Math.min(85, b[3] + pad)],
    ],
    { padding: { left: PAD.left, right: PAD.right, top: PAD.top, bottom: PAD.bottom }, maxZoom: 17 },
  );
  return { longitude, latitude, zoom, pitch: 0, bearing: 0 };
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

export default function Canvas() {
  const vars = useStore((s) => s.vars);
  const order = useStore((s) => s.order);
  const themeName = useStore((s) => s.theme);
  const toggles = useStore((s) => s.toggles);
  const selected = useStore((s) => s.selected);
  const styles = useStore((s) => s.rasterStyles);
  const canvasMode = useStore((s) => s.canvasMode);
  const fitRequest = useStore((s) => s.fitRequest);
  const theme = THEMES[themeName];

  const entries = useMemo(() => order.map((n) => vars[n]).filter(Boolean) as VarEntry[], [order, vars]);
  const mode: Mode = resolveMode(canvasMode, entries, styles);
  const visible = entries.filter((e) => e.visible && displayOf(e.payload, styles[e.name])?.mode === mode);
  const flipY = mode === "paper" && visible.some((e) => displayOf(e.payload, styles[e.name])?.pixel);

  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [paperView, setPaperView] = useState<PaperView>({ target: [5, 5], zoom: 5 });
  const [mapView, setMapView] = useState<MapViewState>({ longitude: 0.62, latitude: 41.61, zoom: 9, pitch: 0, bearing: 0 });
  const [now, setNow] = useState(() => performance.now());
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [mapStyle, setMapStyle] = useState<any | null>(null);
  const seen = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ width: e.contentRect.width, height: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let alive = true;
    basemapStyle(theme).then((s) => alive && setMapStyle(s));
    return () => {
      alive = false;
    };
  }, [theme]);

  // Drive the fade/scale-in while any variable is still transitioning.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const t = performance.now();
      setNow(t);
      if (entries.some((e) => t - e.updatedAt < TRANSITION_MS + 20)) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [entries]);

  // Areas of use are context: fit to actual content when there is some.
  const visibleBounds = (): Bounds | null => {
    const content = visible.filter((e) => e.payload.kind !== "crs" && e.payload.kind !== "transformer");
    return unionBounds((content.length ? content : visible).map((e) => displayOf(e.payload, styles[e.name])!.bounds));
  };

  const fit = () => {
    const b = visibleBounds();
    if (!b) return;
    if (mode === "paper") setPaperView(fitPaper(b, size.width, size.height, flipY));
    else setMapView(fitMap(b, size.width, size.height));
  };

  const viewBounds = (): Bounds => {
    if (mode === "paper") {
      const s = 2 ** paperView.zoom;
      const [x, y] = paperView.target;
      return [x - size.width / 2 / s, y - size.height / 2 / s, x + size.width / 2 / s, y + size.height / 2 / s];
    }
    const vp = new WebMercatorViewport({ ...mapView, width: size.width, height: size.height });
    return vp.getBounds() as Bounds; // [minLng, minLat, maxLng, maxLat]
  };

  // Auto-fit: on mode change, on explicit request, and when new content lands outside the view.
  useEffect(() => {
    fit();
    seen.current = new Map(visible.map((e) => [e.name, e.updatedAt]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, fitRequest, size.width > 0 && size.height > 0]);

  // New content is fitted once it stops arriving (a run streams variables one by one).
  const fitTimer = useRef(0);
  const pendingFit = useRef<{ first: boolean; bounds: Bounds[] }>({ first: false, bounds: [] });
  useEffect(() => {
    const fresh = visible.filter((e) => seen.current.get(e.name) !== e.updatedAt);
    if (!fresh.length) return;
    if (seen.current.size === 0) pendingFit.current.first = true;
    seen.current = new Map(visible.map((e) => [e.name, e.updatedAt]));
    pendingFit.current.bounds.push(...fresh.map((e) => displayOf(e.payload, styles[e.name])!.bounds));
    window.clearTimeout(fitTimer.current);
    fitTimer.current = window.setTimeout(() => {
      const { first, bounds } = pendingFit.current;
      pendingFit.current = { first: false, bounds: [] };
      const b = unionBounds(bounds);
      if (b && (first || !contains(viewBounds(), b))) fit();
    }, 180);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.map((e) => `${e.name}:${e.updatedAt}`).join("|")]);

  const project = useMemo(() => {
    const viewport =
      mode === "paper"
        ? new OrthographicViewport({ width: size.width, height: size.height, target: [...paperView.target, 0], zoom: paperView.zoom, flipY })
        : new WebMercatorViewport({ ...mapView, width: size.width, height: size.height });
    return (xy: [number, number]) => viewport.project(xy) as [number, number];
  }, [mode, size.width, size.height, paperView, mapView, flipY]);

  const layers = useMemo(
    () => buildLayers(entries, { mode, flipY, theme, toggles, selected, styles, now, project }),
    [entries, mode, flipY, theme, toggles, selected, styles, now, project],
  );

  const view = useMemo(
    () =>
      mode === "paper"
        ? new OrthographicView({ id: "paper", flipY, controller: { inertia: 200 } as any })
        : new MapView({ id: "map", repeat: true, controller: { inertia: 200 } as any }),
    [mode, flipY],
  );

  const viewState =
    mode === "paper"
      ? { ...paperView, target: [paperView.target[0], paperView.target[1], 0], minZoom: -40, maxZoom: 40 }
      : mapView;

  const onHover = (info: PickingInfo) => {
    setHover(info.layer ? describeHover(info, vars, styles, mode) : null);
  };

  const onClick = (info: PickingInfo) => {
    const parsed = info.layer ? parseLayerId(info.layer.id) : null;
    if (!parsed) {
      useStore.getState().select(null);
      return;
    }
    const feature = (info.object as any)?.feature ?? null;
    useStore.getState().select(parsed.name, feature);
  };

  const show3d = selected && styles[selected.name]?.show3d && vars[selected.name] ? vars[selected.name] : null;
  const drawable = visible.length > 0;

  return (
    <div ref={container} className="relative h-full w-full overflow-hidden bg-paper" data-testid="canvas" data-mode={mode}>
      {show3d ? (
        <Suspense fallback={null}>
          <Relief3D entry={show3d} />
        </Suspense>
      ) : (
        <>
          {mode === "paper" && <GraphPaper view={paperView} width={size.width} height={size.height} flipY={flipY} theme={theme} />}
          <DeckGL
            views={view}
            viewState={viewState as any}
            onViewStateChange={({ viewState: vs }: any) =>
              mode === "paper"
                ? setPaperView({ target: [vs.target[0], vs.target[1]], zoom: vs.zoom })
                : setMapView({ longitude: vs.longitude, latitude: vs.latitude, zoom: vs.zoom, pitch: vs.pitch, bearing: vs.bearing })
            }
            layers={layers}
            onHover={onHover}
            onClick={onClick}
            pickingRadius={6}
            getCursor={({ isDragging, isHovering }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "crosshair")}
          >
            {mode === "map" && mapStyle && <MapLibre reuseMaps mapStyle={mapStyle} attributionControl={false} />}
          </DeckGL>
          {mode === "map" && (
            <div className="pointer-events-none absolute bottom-1 right-2 font-sans text-2xs text-faint">
              © OpenFreeMap · © OpenStreetMap contributors
            </div>
          )}
          {hover && <Tooltip hover={hover} />}
        </>
      )}
      {!drawable && !show3d && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-sm rounded-md bg-paper/80 px-5 py-4 text-center font-hand text-2xl leading-snug text-pencil">
            {entries.length
              ? mode === "map"
                ? "nothing with a CRS is visible…"
                : "nothing to draw on paper — try the Map view"
              : "write some code and run it — geometries, rasters and CRS will appear here"}
            <div className="mt-2 font-sans text-xs not-italic text-faint">
              Shift+Enter runs everything · Ctrl+Enter runs the current cell
            </div>
          </div>
        </div>
      )}
      <CanvasToolbar mode={mode} onFit={() => useStore.getState().requestFit()} />
    </div>
  );
}
