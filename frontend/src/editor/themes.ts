import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import { SOLARIZED, THEME as t } from "../theme/themes";

const strip = (hex: string) => hex.replace("#", "");

export const MONACO_THEME = "notebook";

export function defineTheme(monaco: typeof Monaco): void {
  const s = SOLARIZED;
  monaco.editor.defineTheme(MONACO_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: strip(t.ink) },
      { token: "comment", foreground: strip("#8c877f"), fontStyle: "italic" },
      { token: "keyword", foreground: strip(s.green) },
      { token: "string", foreground: strip(s.cyan) },
      { token: "string.escape", foreground: strip(s.orange) },
      { token: "number", foreground: strip(s.magenta) },
      { token: "type", foreground: strip(s.yellow) },
      { token: "identifier", foreground: strip(t.ink) },
      { token: "delimiter", foreground: strip(t.pencil) },
      { token: "tag", foreground: strip(s.blue) },
    ],
    colors: {
      "editor.background": t.paper,
      "editor.foreground": t.ink,
      "editorGutter.background": t.paper,
      "editorLineNumber.foreground": t.faint,
      "editorLineNumber.activeForeground": t.pencil,
      "editor.lineHighlightBackground": "#0000000a",
      "editor.lineHighlightBorder": "#00000000",
      "editorCursor.foreground": t.emph,
      "editor.selectionBackground": `${t.accent}33`,
      "editor.inactiveSelectionBackground": `${t.accent}1f`,
      "editorIndentGuide.background1": t.rule,
      "editorIndentGuide.activeBackground1": t.faint,
      "editorWhitespace.foreground": t.rule,
      "editorBracketMatch.background": `${t.accent}22`,
      "editorBracketMatch.border": `${t.accent}66`,
      "editorWidget.background": t.panel,
      "editorWidget.border": t.rule,
      "editorSuggestWidget.background": t.panel,
      "editorSuggestWidget.border": t.rule,
      "editorSuggestWidget.selectedBackground": `${t.accent}26`,
      "editorSuggestWidget.highlightForeground": t.accent,
      "editorHoverWidget.background": t.panel,
      "editorHoverWidget.border": t.rule,
      "editorError.foreground": s.red,
      "editorOverviewRuler.border": "#00000000",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": `${t.pencil}33`,
      "scrollbarSlider.hoverBackground": `${t.pencil}55`,
      "scrollbarSlider.activeBackground": `${t.pencil}77`,
    },
  });
}
