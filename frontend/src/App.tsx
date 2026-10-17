import { useEffect, useRef } from "react";
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from "react-resizable-panels";

import Canvas from "./canvas/Canvas";
import Editor from "./editor/Editor";
import Console from "./panels/Console";
import Inspector from "./panels/Inspector";
import ShortcutsOverlay from "./panels/ShortcutsOverlay";
import TopBar from "./panels/TopBar";
import VariableList from "./panels/VariableList";
import { useStore } from "./state/store";

function Handle({ direction }: { direction: "horizontal" | "vertical" }) {
  return <PanelResizeHandle className={`gs-handle gs-handle-${direction}`} />;
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest(".monaco-editor") || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
      const s = useStore.getState();
      if (e.key === "Escape") {
        if (s.helpOpen) s.setHelpOpen(false);
        else if (!typing) s.select(null);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") s.setHelpOpen(!s.helpOpen);
      else if (e.key === "f") s.requestFit();
      else if (e.key === "c") s.clearAll();
      else if (e.key === "v") s.setSidebarOpen(!s.sidebarOpen);
      else if (e.key === "g") s.setToggle("ghosts", !s.toggles.ghosts);
      else if (e.key === "m") s.setCanvasMode(s.canvasMode === "auto" ? "paper" : s.canvasMode === "paper" ? "map" : "auto");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export default function App() {
  const consoleOpen = useStore((s) => s.consoleOpen);
  const setConsoleOpen = useStore((s) => s.setConsoleOpen);
  const sidebarOpen = useStore((s) => s.sidebarOpen);
  const consolePanel = useRef<ImperativePanelHandle>(null);
  useEffect(() => {
    const panel = consolePanel.current;
    if (!panel) return;
    if (consoleOpen && panel.isCollapsed()) panel.expand();
    if (!consoleOpen && !panel.isCollapsed()) panel.collapse();
  }, [consoleOpen]);
  useGlobalShortcuts();

  return (
    <div className="flex h-full flex-col bg-paper text-ink">
      <TopBar />
      <PanelGroup direction="horizontal" autoSaveId="gs-main" className="min-h-0 flex-1">
        <Panel defaultSize={42} minSize={22} className="flex flex-col">
          <PanelGroup direction="vertical" autoSaveId="gs-left">
            <Panel defaultSize={72} minSize={20} className="gs-editor relative">
              <Editor />
            </Panel>
            <Handle direction="vertical" />
            <Panel
              ref={consolePanel}
              defaultSize={28}
              minSize={10}
              collapsible
              collapsedSize={4}
              onCollapse={() => setConsoleOpen(false)}
              onExpand={() => setConsoleOpen(true)}
            >
              <Console />
            </Panel>
          </PanelGroup>
        </Panel>
        <Handle direction="horizontal" />
        <Panel defaultSize={58} minSize={30}>
          <PanelGroup direction="horizontal">
            <Panel id="canvas" order={1} defaultSize={70} minSize={30} data-testid="right-canvas">
              <Canvas />
            </Panel>
            {sidebarOpen && <Handle direction="horizontal" />}
            {sidebarOpen && (
              <Panel id="sidebar" order={2} defaultSize={30} minSize={18} className="flex flex-col bg-panel" data-testid="sidebar">
                <PanelGroup direction="vertical" autoSaveId="gs-sidebar">
                  <Panel defaultSize={36} minSize={12} className="flex flex-col">
                    <div className="flex h-8 shrink-0 items-center px-4 font-sans text-2xs font-semibold uppercase tracking-[0.08em] text-pencil">
                      Variables
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
                      <VariableList />
                    </div>
                  </Panel>
                  <Handle direction="vertical" />
                  <Panel defaultSize={64} minSize={20} className="overflow-auto">
                    <Inspector />
                  </Panel>
                </PanelGroup>
              </Panel>
            )}
          </PanelGroup>
        </Panel>
      </PanelGroup>
      <ShortcutsOverlay />
    </div>
  );
}
