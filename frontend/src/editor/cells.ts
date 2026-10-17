// `# %%` cells, as in VS Code / Spyder / Jupytext percent format.

export const CELL_RE = /^\s*#\s*%%/;

export interface CellRange {
  /** 1-based, inclusive. A cell starts at its `# %%` line (or line 1). */
  start: number;
  end: number;
}

export function cellRanges(lines: string[]): CellRange[] {
  const starts = [1];
  lines.forEach((line, i) => {
    if (i > 0 && CELL_RE.test(line)) starts.push(i + 1);
  });
  return starts.map((start, i) => ({ start, end: i + 1 < starts.length ? starts[i + 1] - 1 : lines.length }));
}

export function cellAt(lines: string[], line: number): CellRange {
  return cellRanges(lines).find((c) => line >= c.start && line <= c.end) ?? { start: 1, end: lines.length };
}

/** Title of a cell: the text after `# %%`, or its first code line. */
export function cellTitle(lines: string[], cell: CellRange): string {
  const first = lines[cell.start - 1] ?? "";
  const title = CELL_RE.test(first) ? first.replace(CELL_RE, "").trim() : "";
  if (title) return title;
  const code = lines.slice(cell.start - 1, cell.end).find((l) => l.trim() && !l.trim().startsWith("#"));
  return (code ?? "").trim().slice(0, 48);
}
