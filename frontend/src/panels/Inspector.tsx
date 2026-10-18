import { rasterOf } from "../canvas/display";
import { useStore, type VarEntry } from "../state/store";
import { VAR_COLORS } from "../theme/themes";
import { Code, CopyButton, Prop, Section } from "../ui/bits";
import { FileSection, LayoutSection } from "./inspectors/FileInspector";
import GeometryInspector from "./inspectors/GeometryInspector";
import { CrsInspector, TransformerInspector, TransformInspector } from "./inspectors/ProjInspector";
import { RasterControls, RasterProperties } from "./inspectors/RasterInspector";

function Summary({ summary }: { summary: any }) {
  return (
    <div className="font-mono text-2xs leading-[1.15rem] text-ink" data-testid="xr-summary">
      <div>
        <span className="text-pencil">Dimensions: </span>(
        {Object.entries(summary.dims)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")}
        )
      </div>
      {summary.coords.length > 0 && <div className="mt-1 text-pencil">Coordinates:</div>}
      {summary.coords.map((c: any) => (
        <div key={c.name} className="pl-2">
          <div className="flex gap-2">
            <span className="truncate text-emph">{c.name}</span>
            <span className="truncate text-pencil">({c.dims.join(", ")})</span>
            <span className="ml-auto shrink-0 text-faint">{c.dtype}</span>
          </div>
          <div className="truncate pl-3 text-pencil">{c.preview}</div>
        </div>
      ))}
      {Object.keys(summary.attrs).length > 0 && <div className="mt-1 text-pencil">Attributes:</div>}
      {Object.entries(summary.attrs).map(([k, v]) => (
        <div key={k} className="flex gap-2 pl-2">
          <span className="w-24 shrink-0 truncate text-emph">{k}:</span>
          <span className="truncate">{String(v)}</span>
        </div>
      ))}
    </div>
  );
}

function DatasetInspector({ entry }: { entry: VarEntry }) {
  const style = useStore((s) => s.rasterStyles[entry.name]);
  const setStyle = useStore((s) => s.setRasterStyle);
  const { meta } = entry.payload;
  const child = rasterOf(entry.payload, style);
  return (
    <>
      <Section title="Data variables">
        <div className="flex flex-wrap gap-1.5" data-testid="dataset-vars">
          {meta.data_vars.map((v: any) => (
            <button
              key={v.name}
              type="button"
              disabled={!v.renderable}
              onClick={() => setStyle(entry.name, { datasetVar: v.name })}
              title={`(${v.dims.join(", ")}) ${v.dtype}`}
              className={`rounded border px-2 py-0.5 font-mono text-xs transition-colors ${
                style?.datasetVar === v.name
                  ? "border-accent bg-accent/10 text-accent"
                  : v.renderable
                    ? "border-rule text-ink hover:border-pencil"
                    : "cursor-default border-rule/60 text-faint"
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Summary">
        <Summary summary={meta.summary} />
      </Section>
      {child && <RasterControls name={entry.name} raster={child} />}
      {child && <LayoutSection name={entry.name} meta={child.meta} />}
      {child && <RasterProperties raster={child} />}
    </>
  );
}

/** The query behind a DuckDB relation and the types of its columns. */
function QuerySection({ meta }: { meta: Record<string, any> }) {
  return (
    <Section title="SQL" right={<CopyButton text={meta.sql} />}>
      <Code maxHeight={140}>{meta.sql}</Code>
      <div className="mt-2" data-testid="sql-columns">
        {meta.column_types.map((c: any) => (
          <Prop key={c.name} label={c.name}>
            <span className={c.name === meta.geometry_column ? "text-accent" : ""}>{c.type}</span>
          </Prop>
        ))}
      </div>
      {meta.truncated && <div className="mt-1.5 font-sans text-2xs text-faint">Drawing the first {meta.truncated.toLocaleString()} rows.</div>}
    </Section>
  );
}

function ReprInspector({ entry }: { entry: VarEntry }) {
  const { meta } = entry.payload;
  return (
    <Section title={meta.type}>
      <Code maxHeight={260} wrap={!meta.preformatted}>
        {meta.repr}
      </Code>
      {meta.render_error && (
        <div className="mt-2 rounded border border-danger/30 bg-danger/5 px-2 py-1 font-mono text-2xs text-danger">
          renderer failed: {meta.render_error}
        </div>
      )}
      {!meta.preformatted && <div className="mt-2 font-sans text-2xs text-faint">Not drawable — listed with its short repr.</div>}
    </Section>
  );
}

export default function Inspector() {
  const selected = useStore((s) => s.selected);
  const entry = useStore((s) => (s.selected ? s.vars[s.selected.name] : undefined));

  if (!selected || !entry) {
    return (
      <div className="px-4 py-6 text-center font-sans text-xs text-faint" data-testid="inspector-empty">
        Select a variable or click an object on the canvas.
      </div>
    );
  }
  const p = entry.payload;
  return (
    <div data-testid="inspector" data-kind={p.kind}>
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-rule bg-panel px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: VAR_COLORS[entry.color] }} />
        <span className="font-mono text-sm font-medium text-emph">{entry.name}</span>
        <span className="ml-auto truncate font-sans text-xs text-pencil">{p.meta.title ?? p.meta.type}</span>
      </div>
      {p.meta.file && <FileSection meta={p.meta} />}
      {p.kind === "geometry" && <GeometryInspector entry={entry} />}
      {p.kind === "raster" && (
        <>
          <RasterControls name={entry.name} raster={p} />
          <LayoutSection name={entry.name} meta={p.meta} />
          {p.meta.summary && (
            <Section title="DataArray">
              <Summary summary={p.meta.summary} />
            </Section>
          )}
          <RasterProperties raster={p} />
        </>
      )}
      {p.kind === "dataset" && <DatasetInspector entry={entry} />}
      {p.kind === "crs" && <CrsInspector entry={entry} />}
      {p.kind === "transformer" && <TransformerInspector entry={entry} />}
      {p.kind === "transform" && <TransformInspector entry={entry} />}
      {p.kind === "repr" && <ReprInspector entry={entry} />}
      {p.meta.sql && <QuerySection meta={p.meta} />}
    </div>
  );
}
