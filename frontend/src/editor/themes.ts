import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api";

import { SYNTAX as s, THEME as t } from "../theme/themes";

const strip = (hex: string) => hex.replace("#", "");

export const MONACO_THEME = "notebook";

export function defineTheme(monaco: typeof Monaco): void {
  monaco.editor.defineTheme(MONACO_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "", foreground: strip(t.ink) },
      { token: "comment", foreground: strip(s.comment), fontStyle: "italic" },
      { token: "keyword", foreground: strip(s.keyword), fontStyle: "bold" },
      { token: "string", foreground: strip(s.string) },
      { token: "string.escape", foreground: strip(s.escape) },
      { token: "number", foreground: strip(s.number) },
      { token: "type", foreground: strip(s.type) },
      { token: "identifier", foreground: strip(t.ink) },
      { token: "delimiter", foreground: strip(t.pencil) },
      { token: "tag", foreground: strip(s.type) },
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
      "editorError.foreground": t.danger,
      "editorOverviewRuler.border": "#00000000",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": `${t.pencil}33`,
      "scrollbarSlider.hoverBackground": `${t.pencil}55`,
      "scrollbarSlider.activeBackground": `${t.pencil}77`,
    },
  });
}
