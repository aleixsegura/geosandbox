// Ask Claude (through the backend) for a set of exercises and open them in the
// editor as `# %%` cells. The API key never reaches the browser.

import { useEffect, useState, type ReactNode } from "react";

import { editorApi } from "../editor/Editor";
import { useStore } from "../state/store";

const LIBRARIES: [string, string][] = [
  ["shapely", "Shapely"],
  ["gdal", "GDAL / OGR"],
  ["pyproj", "pyproj"],
  ["rasterio", "Rasterio"],
  ["xarray", "xarray"],
  ["geopandas", "GeoPandas"],
];
const LEVELS: [string, string][] = [
  ["beginner", "Beginner"],
  ["intermediate", "Intermediate"],
  ["advanced", "Advanced"],
];
const LANGUAGES: [string, string][] = [
  ["es", "Español"],
  ["en", "English"],
];

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-sans text-2xs font-semibold uppercase tracking-[0.08em] text-pencil">{label}</span>
      {children}
    </label>
  );
}

function Select({ value, options, onChange, testId }: { value: string; options: [string, string][]; onChange: (v: string) => void; testId: string }) {
  return (
    <select className="gs-select w-full" value={value} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}

export default function ExercisesDialog() {
  const open = useStore((s) => s.exercisesOpen);
  const setOpen = useStore((s) => s.setExercisesOpen);
  const log = useStore((s) => s.log);
  const [library, setLibrary] = useState("shapely");
  const [count, setCount] = useState(5);
  const [level, setLevel] = useState("beginner");
  const [language, setLanguage] = useState("es");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<{ configured: boolean; model: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    fetch("/api/exercises/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [open]);

  if (!open) return null;

  const generate = async () => {
    const current = editorApi.editor?.getValue() ?? "";
    if (current.trim() && !window.confirm("Replace the code in the editor with the new exercises?")) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ library, count, level, language, topic }),
      });
      const body = await r.json();
      if (!r.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Request failed (${r.status})`);
      editorApi.setCode(body.code);
      log("info", `Loaded ${body.count} exercises from ${body.model}.`);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const close = () => !busy && setOpen(false);
  return (
    <div className="gs-fade fixed inset-0 z-50 grid place-items-center bg-ink/20 backdrop-blur-[2px]" onClick={close} data-testid="exercises">
      <div className="w-[28rem] rounded-lg border border-rule bg-panel p-6 shadow-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 font-hand text-3xl text-emph">Exercises</div>
        <div className="mb-4 font-sans text-xs text-pencil">
          Claude writes the statements and starter code; they open in the editor, one <code className="font-mono">#&nbsp;%%</code> cell each.
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Library">
            <Select value={library} options={LIBRARIES} onChange={setLibrary} testId="ex-library" />
          </Field>
          <Field label="How many">
            <input
              type="number"
              min={1}
              max={10}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
              className="h-7 w-full rounded border border-rule bg-panel px-2 font-sans text-xs text-ink focus:border-accent focus:outline-none"
              data-testid="ex-count"
            />
          </Field>
          <Field label="Level">
            <Select value={level} options={LEVELS} onChange={setLevel} testId="ex-level" />
          </Field>
          <Field label="Language">
            <Select value={language} options={LANGUAGES} onChange={setLanguage} testId="ex-language" />
          </Field>
        </div>
        <div className="mt-3">
          <Field label="Topic (optional)">
            <textarea
              value={topic}
              maxLength={300}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. buffers and spatial predicates"
              rows={2}
              className="w-full resize-none rounded border border-rule bg-panel px-2 py-1.5 font-sans text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none"
              data-testid="ex-topic"
            />
          </Field>
        </div>
        {status && !status.configured && (
          <div className="mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 font-sans text-xs text-ink" data-testid="ex-no-key">
            No API key. Set <code className="font-mono">ANTHROPIC_API_KEY</code> in your environment or in a <code className="font-mono">.env</code> file at the
            project root, then restart <code className="font-mono">pixi run dev</code>.
          </div>
        )}
        {error && (
          <div className="mt-3 rounded border border-danger/40 bg-danger/10 px-3 py-2 font-sans text-xs text-danger" data-testid="ex-error">
            {error}
          </div>
        )}
        <div className="mt-5 flex items-center gap-3">
          <span className="font-sans text-2xs text-faint">{status?.model}</span>
          <button type="button" onClick={close} disabled={busy} className="ml-auto rounded px-3 py-1.5 font-sans text-xs text-pencil hover:bg-sunken hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            onClick={generate}
            disabled={busy || status?.configured === false}
            className="rounded bg-accent px-3 py-1.5 font-sans text-xs font-medium text-paper transition-opacity disabled:opacity-40"
            data-testid="ex-generate"
          >
            {busy ? "Claude is writing…" : "Generate"}
          </button>
        </div>
      </div>
    </div>
  );
}
