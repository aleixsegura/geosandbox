import { useState, type ReactNode } from "react";

import { CopyIcon } from "./icons";

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-t border-rule px-4 py-3 first:border-t-0">
      <div className="mb-2 flex items-center">
        <h3 className="font-sans text-2xs font-semibold uppercase tracking-[0.08em] text-pencil">{title}</h3>
        <div className="ml-auto">{right}</div>
      </div>
      {children}
    </section>
  );
}

export function Prop({ label, children, title }: { label: string; children: ReactNode; title?: string }) {
  return (
    <div className="flex items-baseline gap-3 py-[3px]" title={title}>
      <span className="shrink-0 font-sans text-xs text-pencil">{label}</span>
      <span className="ml-auto min-w-0 truncate text-right font-mono text-xs text-ink">{children}</span>
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-2xs text-pencil transition-colors hover:bg-sunken hover:text-ink"
    >
      <CopyIcon /> {done ? "Copied" : label}
    </button>
  );
}

/** Preformatted text; `wrap={false}` keeps column-aligned output (tables) intact and scrolls instead. */
export function Code({ children, maxHeight = 160, wrap = true }: { children: string; maxHeight?: number; wrap?: boolean }) {
  return (
    <pre
      className={`overflow-auto ${wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre"} rounded border border-rule bg-sunken/60 px-2.5 py-2 font-mono text-2xs leading-[1.1rem] text-ink`}
      style={{ maxHeight }}
    >
      {children}
    </pre>
  );
}

export function Segmented<T extends string>({ value, options, onChange, testId }: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  testId?: string;
}) {
  return (
    <div className="inline-flex rounded border border-rule bg-sunken/50 p-0.5" data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-[3px] px-2 py-0.5 font-sans text-2xs transition-colors ${
            value === o.value ? "bg-panel text-emph shadow-sm" : "text-pencil hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "danger" | "accent" | "ok" }) {
  const tones = {
    neutral: "border-rule text-pencil",
    danger: "border-danger/40 text-danger",
    accent: "border-accent/40 text-accent",
    ok: "border-ok/40 text-ok",
  };
  return <span className={`whitespace-nowrap rounded-sm border px-1 font-mono text-[0.625rem] leading-4 ${tones[tone]}`}>{children}</span>;
}

export function num(v: number | null | undefined, digits = 4): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e7 || a < 1e-4)) return v.toExponential(3);
  if (a >= 1e4) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return Number(v.toFixed(digits)).toString();
}
