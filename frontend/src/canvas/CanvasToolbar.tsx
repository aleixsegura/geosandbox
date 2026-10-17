import type { ReactNode } from "react";

import { useStore, type Toggles } from "../state/store";
import { AutoIcon, BboxIcon, CentroidIcon, EraserIcon, FitIcon, GhostIcon, MapIcon, NumbersIcon, PaperIcon } from "../ui/icons";
import type { Mode } from "./display";

function ToolButton({ active, title, onClick, children, testId }: { active?: boolean; title: string; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded transition-colors ${
        active ? "bg-accent/15 text-accent" : "text-pencil hover:bg-sunken hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

const TOGGLES: { key: keyof Toggles; title: string; icon: ReactNode }[] = [
  { key: "ghosts", title: "Previous versions (ghosts) — G", icon: <GhostIcon /> },
  { key: "centroids", title: "Centroids", icon: <CentroidIcon /> },
  { key: "bboxes", title: "Bounding boxes", icon: <BboxIcon /> },
  { key: "vertexNumbers", title: "Vertex numbers", icon: <NumbersIcon /> },
];

export default function CanvasToolbar({ mode, onFit }: { mode: Mode; onFit: () => void }) {
  const canvasMode = useStore((s) => s.canvasMode);
  const toggles = useStore((s) => s.toggles);
  const setToggle = useStore((s) => s.setToggle);
  const setCanvasMode = useStore((s) => s.setCanvasMode);
  const clearAll = useStore((s) => s.clearAll);

  return (
    <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-rule bg-panel/90 p-1 shadow-sm backdrop-blur-sm">
      <ToolButton title="Choose automatically" active={canvasMode === "auto"} onClick={() => setCanvasMode("auto")} testId="mode-auto">
        <AutoIcon />
      </ToolButton>
      <ToolButton title="Graph paper (no CRS)" active={canvasMode === "paper" || (canvasMode === "auto" && mode === "paper")} onClick={() => setCanvasMode("paper")} testId="mode-paper">
        <PaperIcon />
      </ToolButton>
      <ToolButton title="Map (objects with a CRS)" active={canvasMode === "map" || (canvasMode === "auto" && mode === "map")} onClick={() => setCanvasMode("map")} testId="mode-map">
        <MapIcon />
      </ToolButton>
      <div className="mx-1 h-5 w-px bg-rule" />
      {TOGGLES.map((t) => (
        <ToolButton key={t.key} title={t.title} active={toggles[t.key]} onClick={() => setToggle(t.key, !toggles[t.key])} testId={`toggle-${t.key}`}>
          {t.icon}
        </ToolButton>
      ))}
      <div className="mx-1 h-5 w-px bg-rule" />
      <ToolButton title="Fit to content — F" onClick={onFit} testId="fit">
        <FitIcon />
      </ToolButton>
      <ToolButton title="Clear the canvas (variables stay in the kernel) — C" onClick={clearAll} testId="clear-canvas">
        <EraserIcon />
      </ToolButton>
    </div>
  );
}
