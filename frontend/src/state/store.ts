import { create } from "zustand";

import { VAR_COLOR_NAMES, type VarColor } from "../theme/themes";
import { defaultColormap } from "../theme/colormaps";
import type { Payload } from "../ws/protocol";

export interface VarEntry {
  name: string;
  payload: Payload;
  /** Previous version, drawn dashed after a re-run (geometry-like kinds only). */
  ghost: Payload | null;
  color: VarColor;
  visible: boolean;
  /** performance.now() when the current version arrived: drives the fade/scale-in. */
  updatedAt: number;
}

export interface RasterStyle {
  colormap: string;
  reverse: boolean;
  stretch: "minmax" | "p2p98";
  band: number;
  slice: number[];
  playing: boolean;
  show3d: boolean;
  exaggeration: number;
  datasetVar: string | null;
  /** Draw the dataset's internal block grid (tiles or strips) over it. */
  showBlocks: boolean;
}

/** Choropleth of a geometry collection: features colored by one numeric column. */
export interface FeatureStyle {
  column: string | null;
  colormap: string;
  reverse: boolean;
  stretch: "minmax" | "p2p98";
}

export interface ConsoleEntry {
  id: number;
  kind: "stdout" | "stderr" | "error" | "result" | "info" | "run";
  text: string;
}

export type KernelState = "connecting" | "idle" | "busy" | "disconnected" | "restarting";
export type CanvasMode = "auto" | "paper" | "map";

export interface Toggles {
  ghosts: boolean;
  centroids: boolean;
  bboxes: boolean;
  vertexNumbers: boolean;
}

interface State {
  vars: Record<string, VarEntry>;
  order: string[];
  selected: { name: string; feature: number | null } | null;
  toggles: Toggles;
  canvasMode: CanvasMode;
  rasterStyles: Record<string, RasterStyle>;
  featureStyles: Record<string, FeatureStyle>;
  console: ConsoleEntry[];
  consoleOpen: boolean;
  kernel: KernelState;
  errorLine: { line: number; message: string } | null;
  pendingError: string | null;
  fitRequest: number;
  helpOpen: boolean;
  /** Variables + inspector sidebar; closed so the canvas gets the full width. */
  sidebarOpen: boolean;
  /** Orbit view of geometries with Z (only shown while one is visible). */
  geometry3d: boolean;
  exercisesOpen: boolean;
  colorOf: Record<string, VarColor>;

  upsert: (p: Payload) => void;
  remove: (names: string[]) => void;
  clearAll: () => void;
  clearGhosts: () => void;
  setVisible: (name: string, visible: boolean) => void;
  select: (name: string | null, feature?: number | null) => void;
  setToggle: (k: keyof Toggles, v: boolean) => void;
  setCanvasMode: (m: CanvasMode) => void;
  setRasterStyle: (name: string, patch: Partial<RasterStyle>) => void;
  setFeatureStyle: (name: string, patch: Partial<FeatureStyle>) => void;
  log: (kind: ConsoleEntry["kind"], text: string) => void;
  clearConsole: () => void;
  setConsoleOpen: (open: boolean) => void;
  setKernel: (k: KernelState) => void;
  setErrorLine: (e: { line: number; message: string } | null) => void;
  setPendingError: (m: string | null) => void;
  requestFit: () => void;
  setHelpOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setGeometry3d: (on: boolean) => void;
  setExercisesOpen: (open: boolean) => void;
}

const GHOST_KINDS = new Set(["geometry", "transform"]);
const TOGGLES_KEY = "geosandbox.toggles";

function loadToggles(): Toggles {
  const base = { ghosts: true, centroids: false, bboxes: false, vertexNumbers: false };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(TOGGLES_KEY) ?? "{}") };
  } catch {
    return base;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Stable per name, distinct from colors in use while there are free ones. */
function pickColor(name: string, used: Set<VarColor>): VarColor {
  const start = hash(name) % VAR_COLOR_NAMES.length;
  for (let i = 0; i < VAR_COLOR_NAMES.length; i++) {
    const c = VAR_COLOR_NAMES[(start + i) % VAR_COLOR_NAMES.length];
    if (!used.has(c)) return c;
  }
  return VAR_COLOR_NAMES[start];
}

function rasterMeta(p: Payload, datasetVar: string | null): Record<string, any> | null {
  if (p.kind === "raster") return p.meta;
  if (p.kind === "dataset") {
    const vars = p.data.variables ?? {};
    const key = datasetVar && vars[datasetVar] ? datasetVar : Object.keys(vars)[0];
    return key ? vars[key].meta : null;
  }
  return null;
}

function initialStyle(name: string, p: Payload, prev?: RasterStyle): RasterStyle | null {
  const datasetVar = p.kind === "dataset" ? prev?.datasetVar ?? Object.keys(p.data.variables ?? {})[0] ?? null : null;
  const meta = rasterMeta(p, datasetVar);
  if (!meta) return null;
  const dims = meta.cube?.dims ?? [];
  const slice = dims.map((d: any, i: number) => Math.min(prev?.slice?.[i] ?? 0, d.size - 1));
  if (prev) return { ...prev, slice, band: Math.min(prev.band, (meta.stats?.length || 1) - 1), datasetVar };
  const s = meta.stats_global ?? {};
  return {
    colormap: defaultColormap({ ...meta, var_name: meta.var_name ?? name }, s.min ?? 0, s.max ?? 1),
    reverse: false,
    stretch: "p2p98",
    band: 0,
    slice,
    playing: false,
    show3d: false,
    exaggeration: 2,
    datasetVar,
    showBlocks: false,
  };
}

/** Keep the chosen column across re-runs while it still exists and is numeric. */
function initialFeatureStyle(p: Payload, prev?: FeatureStyle): FeatureStyle | null {
  const numeric = (p.meta.numeric ?? []) as { name: string }[];
  if (p.kind !== "geometry" || !numeric.length) return null;
  const column = prev?.column && numeric.some((c) => c.name === prev.column) ? prev.column : null;
  return { colormap: "viridis", reverse: false, stretch: "p2p98", ...prev, column };
}

let consoleId = 0;

export const useStore = create<State>((set, get) => ({
  vars: {},
  order: [],
  selected: null,
  toggles: loadToggles(),
  canvasMode: "auto",
  rasterStyles: {},
  featureStyles: {},
  console: [],
  consoleOpen: true,
  kernel: "connecting",
  errorLine: null,
  pendingError: null,
  fitRequest: 0,
  helpOpen: false,
  sidebarOpen: false,
  geometry3d: false,
  exercisesOpen: false,
  colorOf: {},

  upsert: (p) =>
    set((s) => {
      const prev = s.vars[p.name];
      let color = prev?.color ?? s.colorOf[p.name];
      if (!color) {
        const used = new Set(Object.values(s.vars).map((v) => v.color));
        color = pickColor(p.name, used);
      }
      const ghost = prev && GHOST_KINDS.has(prev.payload.kind) && prev.payload.kind === p.kind ? prev.payload : null;
      const entry: VarEntry = {
        name: p.name,
        payload: p,
        ghost,
        color,
        visible: prev?.visible ?? true,
        updatedAt: performance.now(),
      };
      const style = initialStyle(p.name, p, s.rasterStyles[p.name]);
      const featureStyle = initialFeatureStyle(p, s.featureStyles[p.name]);
      return {
        vars: { ...s.vars, [p.name]: entry },
        order: prev ? s.order : [...s.order, p.name],
        colorOf: { ...s.colorOf, [p.name]: color },
        rasterStyles: style ? { ...s.rasterStyles, [p.name]: style } : s.rasterStyles,
        featureStyles: featureStyle ? { ...s.featureStyles, [p.name]: featureStyle } : s.featureStyles,
      };
    }),

  remove: (names) =>
    set((s) => {
      const vars = { ...s.vars };
      for (const n of names) delete vars[n];
      return {
        vars,
        order: s.order.filter((n) => !names.includes(n)),
        selected: s.selected && names.includes(s.selected.name) ? null : s.selected,
      };
    }),

  /** Empty the canvas and variable list; the kernel keeps its namespace. */
  clearAll: () => set({ vars: {}, order: [], selected: null, rasterStyles: {}, featureStyles: {} }),

  clearGhosts: () =>
    set((s) => {
      if (!Object.values(s.vars).some((v) => v.ghost)) return {};
      const vars: Record<string, VarEntry> = {};
      for (const [k, v] of Object.entries(s.vars)) vars[k] = v.ghost ? { ...v, ghost: null } : v;
      return { vars };
    }),

  setVisible: (name, visible) =>
    set((s) => (s.vars[name] ? { vars: { ...s.vars, [name]: { ...s.vars[name], visible } } } : {})),

  select: (name, feature = null) => set({ selected: name ? { name, feature } : null }),

  setToggle: (k, v) => {
    const toggles = { ...get().toggles, [k]: v };
    localStorage.setItem(TOGGLES_KEY, JSON.stringify(toggles));
    set({ toggles });
  },

  setCanvasMode: (canvasMode) => set({ canvasMode }),

  setRasterStyle: (name, patch) =>
    set((s) => {
      const cur = s.rasterStyles[name];
      if (!cur) return {};
      const next = { ...cur, ...patch };
      if (patch.datasetVar !== undefined && patch.datasetVar !== cur.datasetVar && s.vars[name]) {
        Object.assign(next, initialStyle(name, s.vars[name].payload, { ...next, slice: [] }));
      }
      return { rasterStyles: { ...s.rasterStyles, [name]: next } };
    }),

  setFeatureStyle: (name, patch) =>
    set((s) => (s.featureStyles[name] ? { featureStyles: { ...s.featureStyles, [name]: { ...s.featureStyles[name], ...patch } } } : {})),

  log: (kind, text) =>
    set((s) => {
      const last = s.console[s.console.length - 1];
      // Merge consecutive stream chunks so long prints stay one entry.
      if (last && last.kind === kind && (kind === "stdout" || kind === "stderr")) {
        return { console: [...s.console.slice(0, -1), { ...last, text: last.text + text }] };
      }
      const console = [...s.console, { id: ++consoleId, kind, text }];
      return { console: console.length > 500 ? console.slice(-500) : console };
    }),

  clearConsole: () => set({ console: [] }),
  setConsoleOpen: (consoleOpen) => set({ consoleOpen }),
  setKernel: (kernel) => set({ kernel }),
  setErrorLine: (errorLine) => set({ errorLine }),
  setPendingError: (pendingError) => set({ pendingError }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setGeometry3d: (geometry3d) => set({ geometry3d }),
  setExercisesOpen: (exercisesOpen) => set({ exercisesOpen }),
}));

export { rasterMeta };

// Exposed for end-to-end tests.
(window as any).__store = useStore;
