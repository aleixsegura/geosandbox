import { useEffect, useRef } from "react";

import { useStore } from "../state/store";
import { ChevronIcon, TrashIcon } from "../ui/icons";

const TONE = {
  stdout: "text-ink",
  stderr: "text-warn",
  error: "text-danger",
  result: "text-emph",
  info: "text-pencil italic",
  run: "text-pencil",
};

export default function Console() {
  const entries = useStore((s) => s.console);
  const open = useStore((s) => s.consoleOpen);
  const setOpen = useStore((s) => s.setConsoleOpen);
  const clear = useStore((s) => s.clearConsole);
  const kernel = useStore((s) => s.kernel);
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = body.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, open]);

  return (
    <div className="flex h-full flex-col bg-panel" data-testid="console">
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-rule px-3">
        <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1 font-sans text-xs font-medium text-pencil hover:text-ink">
          <ChevronIcon open={open} /> Console
        </button>
        {kernel === "busy" && <span className="gs-busy font-sans text-2xs text-accent">running…</span>}
        <button type="button" title="Clear console" onClick={clear} className="ml-auto rounded p-1 text-faint hover:bg-sunken hover:text-ink">
          <TrashIcon />
        </button>
      </div>
      {open && (
        <div ref={body} className="min-h-0 flex-1 overflow-auto px-3 pb-2 font-mono text-xs leading-5" data-testid="console-body">
          {entries.length === 0 && <div className="pt-1 font-sans text-2xs text-faint">print() output and tracebacks show up here.</div>}
          {entries.map((e) =>
            e.kind === "run" ? (
              <div key={e.id} className="mt-2 flex items-center gap-2 font-sans text-2xs text-faint first:mt-0">
                <span className="text-accent">▸</span> {e.text}
                <span className="h-px flex-1 bg-rule" />
              </div>
            ) : (
              <pre key={e.id} className={`whitespace-pre-wrap break-words ${TONE[e.kind]}`}>
                {e.text}
              </pre>
            ),
          )}
        </div>
      )}
    </div>
  );
}
