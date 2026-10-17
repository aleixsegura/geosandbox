import { useEffect, useState, type ReactNode } from "react";

import { editorApi } from "../editor/Editor";
import { useStore } from "../state/store";
import { THEMES, type ThemeName } from "../theme/themes";
import { HelpIcon, PlayAllIcon, PlayIcon, RestartIcon, SelectionIcon, StopIcon } from "../ui/icons";
import { interrupt, restart } from "../ws/client";

function Button({ onClick, title, children, testId, tone = "neutral" }: { onClick: () => void; title: string; children: ReactNode; testId?: string; tone?: "neutral" | "primary" }) {
  return (
    <button
      type="button"
      title={title}
      data-testid={testId}
      onClick={onClick}
      className={`flex h-7 items-center gap-1.5 rounded px-2 font-sans text-xs transition-colors ${
        tone === "primary" ? "text-accent hover:bg-accent/10" : "text-pencil hover:bg-sunken hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

const STATUS: Record<string, { label: string; dot: string }> = {
  connecting: { label: "connecting", dot: "bg-warn" },
  idle: { label: "kernel idle", dot: "bg-ok" },
  busy: { label: "running", dot: "bg-accent gs-pulse" },
  disconnected: { label: "disconnected", dot: "bg-danger" },
  restarting: { label: "restarting", dot: "bg-warn gs-pulse" },
};

export default function TopBar() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const kernel = useStore((s) => s.kernel);
  const setHelpOpen = useStore((s) => s.setHelpOpen);
  const [snippets, setSnippets] = useState<{ name: string }[]>([]);

  useEffect(() => {
    fetch("/api/snippets")
      .then((r) => r.json())
      .then(setSnippets)
      .catch(() => setSnippets([]));
  }, []);

  const loadSnippet = async (name: string) => {
    if (!name) return;
    const r = await fetch(`/api/snippets/${name}`);
    if (r.ok) editorApi.setCode((await r.json()).code);
  };

  const status = STATUS[kernel];
  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-rule bg-panel px-3">
      <div className="mr-3 flex items-baseline gap-2">
        <span className="font-sans text-[0.95rem] font-semibold tracking-tight text-emph">GeoSandbox</span>
        <span className="hidden font-hand text-lg leading-none text-pencil lg:inline">a geospatial notebook</span>
      </div>
      <select
        className="gs-select"
        value=""
        onChange={(e) => loadSnippet(e.target.value)}
        data-testid="snippets"
        aria-label="Load a snippet"
      >
        <option value="">Load snippet…</option>
        {snippets.map((s) => (
          <option key={s.name} value={s.name}>
            {s.name}
          </option>
        ))}
      </select>
      <div className="mx-2 h-5 w-px bg-rule" />
      <Button title="Run cell (Ctrl+Enter)" onClick={() => editorApi.runCell()} testId="run-cell" tone="primary">
        <PlayIcon /> Cell
      </Button>
      <Button title="Run all (Shift+Enter)" onClick={() => editorApi.runAll()} testId="run-all" tone="primary">
        <PlayAllIcon /> All
      </Button>
      <Button title="Run selection (Ctrl+Shift+Enter)" onClick={() => editorApi.runSelection()} testId="run-selection">
        <SelectionIcon /> Selection
      </Button>
      <div className="mx-2 h-5 w-px bg-rule" />
      <Button title="Interrupt the kernel" onClick={interrupt} testId="interrupt">
        <StopIcon />
      </Button>
      <Button title="Restart the kernel (clears all variables)" onClick={restart} testId="restart">
        <RestartIcon /> Restart
      </Button>
      <div className="ml-auto flex items-center gap-3">
        <span className="flex items-center gap-1.5 font-sans text-2xs text-pencil" data-testid="kernel-status" data-state={kernel}>
          <span className={`h-2 w-2 rounded-full ${status.dot}`} />
          {status.label}
        </span>
        <select className="gs-select" value={theme} onChange={(e) => setTheme(e.target.value as ThemeName)} data-testid="theme" aria-label="Theme">
          {Object.values(THEMES).map((t) => (
            <option key={t.name} value={t.name}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="button" title="Keyboard shortcuts (?)" onClick={() => setHelpOpen(true)} className="rounded p-1 text-pencil hover:bg-sunken hover:text-ink">
          <HelpIcon />
        </button>
      </div>
    </header>
  );
}
