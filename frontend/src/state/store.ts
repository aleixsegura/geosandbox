import { create } from "zustand";

import { ACCENTS, type AccentName, type ThemeName } from "../theme/themes";
import { defaultColormap } from "../theme/colormaps";
import type { Payload } from "../ws/protocol";

export interface VarEntry {
  name: string;
  payload: Payload;
  /** Previous version, drawn dashed after a re-run (geometry-like kinds only). */
  ghost: Payload | null;
  color: AccentName;
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
  theme: ThemeName;
  toggles: Toggles;
  canvasMode: CanvasMode;
  rasterStyles: Record<string, RasterStyle>;
  console: ConsoleEntry[];
  consoleOpen: boolean;
  kernel: KernelState;
  errorLine: { line: number; message: string } | null;
  pendingError: string | null;
  fitRequest: number;
  helpOpen: boolean;
  colorOf: Record<string, AccentName>;

  upsert: (p: Payload) => void;
  remove: (names: string[]) => void;
  clearAll: () => void;
  clearGhosts: () => void;
  setVisible: (name: string, visible: boolean) => void;
  select: (name: string | null, feature?: number | null) => void;
  setTheme: (t: ThemeName) => void;
  setToggle: (k: keyof Toggles, v: boolean) => void;
  setCanvasMode: (m: CanvasMode) => void;
  setRasterStyle: (name: string, patch: Partial<RasterStyle>) => void;
  log: (kind: ConsoleEntry["kind"], text: string) => void;
  clearConsole: () => void;
  setConsoleOpen: (open: boolean) => void;
  setKernel: (k: KernelState) => void;
  setErrorLine: (e: { line: number; message: string } | null) => void;
  setPendingError: (m: string | null) => void;
  requestFit: () => void;
  setHelpOpen: (open: boolean) => void;
}

const GHOST_KINDS = new Set(["geometry", "transform"]);
const THEME_KEY = "geosandbox.theme";
const TOGGLES_KEY = "geosandbox.toggles";

function loadTheme(): ThemeName {
  const t = localStorage.getItem(THEME_KEY);
  return t === "solarized-light" || t === "solarized-dark" || t === "notebook" ? t : "notebook";
}

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

/** Stable per name, distinct from colors in use while there are free accents. */
function pickColor(name: string, used: Set<AccentName>): AccentName {
  const start = hash(name) % ACCENTS.length;
  for (let i = 0; i < ACCENTS.length; i++) {
    const c = ACCENTS[(start + i) % ACCENTS.length];
    if (!used.has(c)) return c;
  }
  return ACCENTS[start];
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
  };
}

let consoleId = 0;

export const useStore = create<State>((set, get) => ({
  vars: {},
  order: [],
  selected: null,
  theme: loadTheme(),
  toggles: loadToggles(),
  canvasMode: "auto",
  rasterStyles: {},
  console: [],
  consoleOpen: true,
  kernel: "connecting",
  errorLine: null,
  pendingError: null,
  fitRequest: 0,
  helpOpen: false,
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
      return {
        vars: { ...s.vars, [p.name]: entry },
        order: prev ? s.order : [...s.order, p.name],
        colorOf: { ...s.colorOf, [p.name]: color },
        rasterStyles: style ? { ...s.rasterStyles, [p.name]: style } : s.rasterStyles,
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

  clearAll: () => set({ vars: {}, order: [], selected: null, rasterStyles: {} }),

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

  setTheme: (theme) => {
    localStorage.setItem(THEME_KEY, theme);
    set({ theme });
  },

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
}));

export { rasterMeta };
