import { useStore } from "../state/store";

const ROWS: [string, string][] = [
  ["Ctrl + Enter", "Run the current # %% cell"],
  ["Shift + Enter", "Run the whole file"],
  ["Ctrl + Shift + Enter", "Run the selection (or current line)"],
  ["Ctrl + Space", "Autocomplete from the live kernel"],
  ["F", "Fit the canvas to visible objects"],
  ["C", "Clear the canvas (re-run code to draw again)"],
  ["G", "Toggle ghosts (previous versions)"],
  ["V", "Show or hide variables and inspector"],
  ["M", "Cycle canvas: auto → paper → map"],
  ["Esc", "Clear selection / close this panel"],
  ["?", "Show this help"],
];

export default function ShortcutsOverlay() {
  const open = useStore((s) => s.helpOpen);
  const setOpen = useStore((s) => s.setHelpOpen);
  if (!open) return null;
  return (
    <div className="gs-fade fixed inset-0 z-50 grid place-items-center bg-ink/20 backdrop-blur-[2px]" onClick={() => setOpen(false)} data-testid="shortcuts">
      <div className="w-[26rem] rounded-lg border border-rule bg-panel p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 font-hand text-3xl text-emph">Keyboard shortcuts</div>
        <div className="mb-4 font-sans text-xs text-pencil">Cells are separated by lines starting with <code className="font-mono">#&nbsp;%%</code>.</div>
        <table className="w-full">
          <tbody>
            {ROWS.map(([k, v]) => (
              <tr key={k} className="border-t border-rule/70 first:border-t-0">
                <td className="py-1.5 pr-4">
                  {k.split(" + ").map((part, i) => (
                    <span key={i}>
                      {i > 0 && <span className="mx-0.5 text-faint">+</span>}
                      <kbd className="rounded border border-rule bg-sunken px-1.5 py-0.5 font-mono text-2xs text-ink">{part}</kbd>
                    </span>
                  ))}
                </td>
                <td className="py-1.5 font-sans text-xs text-ink">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 font-sans text-2xs text-faint">
          In your code, <code className="font-mono text-pencil">show(obj, label=None)</code> draws any object even if it is not a variable.
        </div>
      </div>
    </div>
  );
}
