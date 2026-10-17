import { useStore } from "../state/store";
import { resolveMode, type Mode } from "./display";

/** The canvas mode (paper or map) currently in effect, shared by canvas and sidebar. */
export function useMode(): Mode {
  return useStore((s) => resolveMode(s.canvasMode, s.order.map((n) => s.vars[n]).filter(Boolean), s.rasterStyles));
}
