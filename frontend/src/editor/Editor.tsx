import MonacoEditor from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import { useStore } from "../state/store";
import { complete, execute } from "../ws/client";
import { cellAt, cellRanges, cellTitle } from "./cells";
import { monaco } from "./monacoSetup";
import { defineThemes } from "./themes";

type Editor = Monaco.editor.IStandaloneCodeEditor;

const CODE_KEY = "geosandbox.code";
const DEFAULT_SNIPPET = "shapely_basics";

/** Imperative handle for the toolbar and the snippet picker. */
export const editorApi = {
  editor: null as Editor | null,
  runCell(): void {
    const ed = this.editor;
    if (!ed) return;
    const model = ed.getModel()!;
    const lines = model.getLinesContent();
    const cell = cellAt(lines, ed.getPosition()?.lineNumber ?? 1);
    const code = lines.slice(cell.start - 1, cell.end).join("\n");
    execute(code, cell.start - 1, `cell · lines ${cell.start}–${cell.end} · ${cellTitle(lines, cell)}`);
  },
  runAll(): void {
    const ed = this.editor;
    if (!ed) return;
    const model = ed.getModel()!;
    execute(model.getValue(), 0, `all · ${model.getLineCount()} lines`);
  },
  runSelection(): void {
    const ed = this.editor;
    if (!ed) return;
    const sel = ed.getSelection();
    const model = ed.getModel()!;
    if (!sel || sel.isEmpty()) {
      // No selection: run the current line.
      const line = ed.getPosition()?.lineNumber ?? 1;
      execute(model.getLineContent(line), line - 1, `line ${line}`);
      return;
    }
    // Run whole lines so indentation stays valid.
    const start = sel.startLineNumber;
    const end = sel.endColumn === 1 && sel.endLineNumber > start ? sel.endLineNumber - 1 : sel.endLineNumber;
    const code = model.getLinesContent().slice(start - 1, end).join("\n");
    execute(dedent(code), start - 1, `selection · lines ${start}–${end}`);
  },
  /** Lines carrying a kernel error marker (used by end-to-end tests). */
  errorLines(): number[] {
    const model = this.editor?.getModel();
    if (!model) return [];
    return monaco.editor.getModelMarkers({ owner: "kernel", resource: model.uri }).map((m) => m.startLineNumber);
  },
  setCode(code: string): void {
    const ed = this.editor;
    if (!ed) return;
    ed.setValue(code);
    ed.setPosition({ lineNumber: 1, column: 1 });
    ed.focus();
  },
};

// Exposed for end-to-end tests.
(window as any).__editorApi = editorApi;

function dedent(code: string): string {
  const lines = code.split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length);
  const n = indents.length ? Math.min(...indents) : 0;
  return n ? lines.map((l) => l.slice(n)).join("\n") : code;
}

const KIND: Record<string, Monaco.languages.CompletionItemKind> = {
  function: monaco.languages.CompletionItemKind.Function,
  class: monaco.languages.CompletionItemKind.Class,
  module: monaco.languages.CompletionItemKind.Module,
  keyword: monaco.languages.CompletionItemKind.Keyword,
  instance: monaco.languages.CompletionItemKind.Variable,
  statement: monaco.languages.CompletionItemKind.Variable,
  param: monaco.languages.CompletionItemKind.Variable,
  path: monaco.languages.CompletionItemKind.File,
  property: monaco.languages.CompletionItemKind.Property,
};

let completionRegistered = false;

function registerCompletion(): void {
  if (completionRegistered) return;
  completionRegistered = true;
  monaco.languages.registerCompletionItemProvider("python", {
    triggerCharacters: ["."],
    async provideCompletionItems(model, position) {
      const reply = await complete(model.getValue(), model.getOffsetAt(position));
      if (!reply) return { suggestions: [] };
      const start = model.getPositionAt(reply.cursor_start);
      const end = model.getPositionAt(reply.cursor_end);
      const range = new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column);
      return {
        suggestions: reply.matches.slice(0, 200).map((m, i) => ({
          label: m,
          insertText: m,
          kind: KIND[reply.types[i]] ?? monaco.languages.CompletionItemKind.Text,
          detail: reply.types[i] || undefined,
          range,
          sortText: String(i).padStart(4, "0"),
        })),
      };
    },
  });
}

export default function Editor() {
  const theme = useStore((s) => s.theme);
  const errorLine = useStore((s) => s.errorLine);
  const decorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const errorDecorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);

  // Error marker + red line, cleared on the next run or when the line is edited.
  useEffect(() => {
    const ed = editorApi.editor;
    const model = ed?.getModel();
    if (!ed || !model) return;
    if (!errorLine) {
      monaco.editor.setModelMarkers(model, "kernel", []);
      errorDecorations.current?.clear();
      return;
    }
    const line = Math.min(Math.max(1, errorLine.line), model.getLineCount());
    monaco.editor.setModelMarkers(model, "kernel", [
      {
        severity: monaco.MarkerSeverity.Error,
        message: errorLine.message,
        startLineNumber: line,
        endLineNumber: line,
        startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
        endColumn: model.getLineMaxColumn(line),
      },
    ]);
    errorDecorations.current?.clear();
    errorDecorations.current = ed.createDecorationsCollection([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, className: "gs-error-line", glyphMarginClassName: "gs-error-glyph", glyphMarginHoverMessage: { value: errorLine.message } },
      },
    ]);
    ed.revealLineInCenterIfOutsideViewport(line);
  }, [errorLine]);

  const refreshCells = (ed: Editor) => {
    const model = ed.getModel();
    if (!model) return;
    const lines = model.getLinesContent();
    const current = cellAt(lines, ed.getPosition()?.lineNumber ?? 1);
    const ranges = cellRanges(lines);
    const decos: Monaco.editor.IModelDeltaDecoration[] = [];
    for (const c of ranges) {
      if (c.start > 1 || /^\s*#\s*%%/.test(lines[0] ?? "")) {
        decos.push({
          range: new monaco.Range(c.start, 1, c.start, 1),
          options: { isWholeLine: true, className: "gs-cell-sep", glyphMarginClassName: "gs-cell-run", glyphMarginHoverMessage: { value: "Run cell" } },
        });
      }
    }
    if (ranges.length > 1) {
      decos.push({
        range: new monaco.Range(current.start, 1, current.end, 1),
        options: { isWholeLine: true, linesDecorationsClassName: "gs-cell-active" },
      });
    }
    decorations.current?.set(decos);
  };

  const onMount = (ed: Editor) => {
    editorApi.editor = ed;
    decorations.current = ed.createDecorationsCollection([]);
    registerCompletion();

    ed.addAction({
      id: "gs.runCell",
      label: "Run cell",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
      run: () => editorApi.runCell(),
    });
    ed.addAction({
      id: "gs.runAll",
      label: "Run all",
      keybindings: [monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => editorApi.runAll(),
    });
    ed.addAction({
      id: "gs.runSelection",
      label: "Run selection",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Enter],
      run: () => editorApi.runSelection(),
    });

    ed.onMouseDown((e) => {
      if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) {
        const el = e.target.element;
        if (el?.classList.contains("gs-cell-run")) {
          ed.setPosition({ lineNumber: e.target.position.lineNumber, column: 1 });
          editorApi.runCell();
        }
      }
    });

    let saveTimer = 0;
    ed.onDidChangeModelContent((e) => {
      refreshCells(ed);
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => localStorage.setItem(CODE_KEY, ed.getValue()), 300);
      const err = useStore.getState().errorLine;
      if (err && e.changes.some((c) => c.range.startLineNumber <= err.line && c.range.endLineNumber >= err.line)) {
        useStore.getState().setErrorLine(null);
      }
    });
    ed.onDidChangeCursorPosition(() => refreshCells(ed));

    const saved = localStorage.getItem(CODE_KEY);
    if (saved) {
      ed.setValue(saved);
    } else {
      fetch(`/api/snippets/${DEFAULT_SNIPPET}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((s) => s && !ed.getValue() && ed.setValue(s.code));
    }
    refreshCells(ed);
    ed.focus();
  };

  return (
    <MonacoEditor
      language="python"
      theme={theme}
      beforeMount={defineThemes}
      onMount={onMount}
      options={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: 13.5,
        lineHeight: 22,
        fontLigatures: false,
        minimap: { enabled: false },
        glyphMargin: true,
        lineDecorationsWidth: 14,
        lineNumbersMinChars: 3,
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        padding: { top: 14, bottom: 14 },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
        tabSize: 4,
        automaticLayout: true,
        fixedOverflowWidgets: true,
        quickSuggestions: { other: true, comments: false, strings: false },
        suggest: { showWords: false },
        wordBasedSuggestions: "off",
        guides: { indentation: true },
      }}
    />
  );
}
