import { choroplethRange } from "../../canvas/layers";
import { useStore, type VarEntry } from "../../state/store";
import { Badge, Code, CopyButton, num, Prop, Section, Segmented } from "../../ui/bits";
import { Colorbar, ColormapGrid } from "./RasterInspector";

/** Color the features by a numeric column; everything here runs on the GPU, never in Python. */
function ColorBy({ entry }: { entry: VarEntry }) {
  const style = useStore((s) => s.featureStyles[entry.name]);
  const setStyle = useStore((s) => s.setFeatureStyle);
  const numeric = (entry.payload.meta.numeric ?? []) as { name: string; dtype: string; missing: number }[];
  if (!style || !numeric.length) return null;
  const column = numeric.find((c) => c.name === style.column);
  const range = choroplethRange(entry.payload.meta, style);
  return (
    <Section title="Color by">
      <select
        value={style.column ?? ""}
        onChange={(e) => setStyle(entry.name, { column: e.target.value || null })}
        className="gs-select mb-2 w-full"
        data-testid="color-by"
      >
        <option value="">— single color —</option>
        {numeric.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name} ({c.dtype})
          </option>
        ))}
      </select>
      {column && range && (
        <>
          <ColormapGrid colormap={style.colormap} reverse={style.reverse} onChange={(patch) => setStyle(entry.name, patch)} />
          <div className="mb-3 flex items-center gap-2">
            <span className="font-sans text-xs text-pencil">stretch</span>
            <Segmented
              testId="color-stretch"
              value={style.stretch}
              onChange={(v) => setStyle(entry.name, { stretch: v })}
              options={[
                { value: "p2p98", label: "2–98 %" },
                { value: "minmax", label: "min–max" },
              ]}
            />
          </div>
          <Colorbar style={style} range={range} />
          {column.missing > 0 && (
            <div className="mt-1.5 font-sans text-2xs text-faint">{column.missing} features without a value are drawn faded.</div>
          )}
        </>
      )}
    </Section>
  );
}

function Bounds({ b }: { b: (number | null)[] }) {
  if (!b || b[0] == null) return <>—</>;
  return (
    <>
      [{b.map((v) => num(v as number, 3)).join(", ")}]
    </>
  );
}

function FeatureDetails({ f }: { f: any }) {
  return (
    <>
      <Prop label="geom_type">{f.geom_type ?? "None"}</Prop>
      <Prop label="is_valid">
        {f.is_valid ? <span className="text-ok">True</span> : <span className="text-danger">False</span>}
      </Prop>
      {!f.is_valid && f.reason && (
        <div className="my-1 rounded border border-danger/30 bg-danger/5 px-2 py-1 font-mono text-2xs text-danger">{f.reason}</div>
      )}
      <Prop label="area">{num(f.area)}</Prop>
      <Prop label="length">{num(f.length)}</Prop>
      <Prop label="bounds" title="minx, miny, maxx, maxy">
        <Bounds b={f.bounds} />
      </Prop>
      <Prop label="centroid">{f.centroid ? `(${num(f.centroid[0], 3)}, ${num(f.centroid[1], 3)})` : "—"}</Prop>
      <Prop label="vertices">{f.n_vertices}</Prop>
      {f.has_z && <Prop label="has_z">True</Prop>}
    </>
  );
}

export default function GeometryInspector({ entry }: { entry: VarEntry }) {
  const { meta } = entry.payload;
  const selected = useStore((s) => s.selected);
  const select = useStore((s) => s.select);
  const featureIndex = selected?.name === entry.name ? selected.feature : null;
  const many = meta.count > 1;
  const f = meta.features?.[many ? featureIndex ?? -1 : 0];
  const attrs = meta.attributes;

  return (
    <>
      {many && (
        <Section title="Collection">
          <Prop label="features">{meta.count}</Prop>
          <Prop label="types">{(meta.geom_types ?? []).join(", ")}</Prop>
          <Prop label="all valid">{meta.is_valid ? <span className="text-ok">True</span> : <span className="text-danger">False</span>}</Prop>
          <Prop label="total area">{num(meta.area)}</Prop>
          <Prop label="total length">{num(meta.length)}</Prop>
          <Prop label="vertices">{meta.n_vertices}</Prop>
          <Prop label="total_bounds">
            <Bounds b={meta.bounds} />
          </Prop>
          <div className="mt-2 flex flex-wrap gap-1">
            {(meta.features ?? []).slice(0, 60).map((ft: any, i: number) => (
              <button
                key={i}
                type="button"
                onClick={() => select(entry.name, featureIndex === i ? null : i)}
                className={`rounded-sm border px-1.5 font-mono text-2xs transition-colors ${
                  featureIndex === i
                    ? "border-accent bg-accent/10 text-accent"
                    : ft.is_valid
                      ? "border-rule text-pencil hover:text-ink"
                      : "border-danger/40 text-danger"
                }`}
                title={ft.geom_type ?? "None"}
              >
                {meta.index?.[i] ?? attrs?.index?.[i] ?? i}
              </button>
            ))}
            {meta.count > 60 && <span className="font-mono text-2xs text-faint">… {meta.count - 60} more</span>}
          </div>
        </Section>
      )}
      <ColorBy entry={entry} />
      {f ? (
        <Section title={many ? `Feature ${featureIndex}` : "Geometry"}>
          <FeatureDetails f={f} />
        </Section>
      ) : (
        many && (
          <div className="px-4 pb-3 font-sans text-xs text-faint">Click a feature on the canvas or above to inspect it.</div>
        )
      )}
      {attrs && featureIndex != null && attrs.rows[featureIndex] && (
        <Section title="Attributes">
          {attrs.columns.map((c: string, i: number) => (
            <Prop key={c} label={c} title={attrs.dtypes[i]}>
              {attrs.rows[featureIndex][i]}
            </Prop>
          ))}
          {attrs.hidden_columns > 0 && <div className="font-sans text-2xs text-faint">+{attrs.hidden_columns} more columns</div>}
        </Section>
      )}
      {meta.crs ? (
        <Section title="CRS" right={meta.axis_order && <Badge>{meta.axis_order}</Badge>}>
          <Prop label="name">{meta.crs.name}</Prop>
          <Prop label="EPSG">{meta.crs.epsg ?? "—"}</Prop>
          <Prop label="units">{meta.crs.units ?? "—"}</Prop>
          <div className="mt-1 font-sans text-2xs text-faint">Drawn reprojected to WGS 84; metrics are in the source CRS.</div>
        </Section>
      ) : (
        <Section title="CRS">
          <div className="font-sans text-xs text-pencil">
            None — shapely geometries are plain Cartesian coordinates, drawn on graph paper.
          </div>
        </Section>
      )}
      {f?.wkt && (
        <Section title="WKT" right={<CopyButton text={f.wkt} />}>
          <Code>{f.wkt}</Code>
        </Section>
      )}
    </>
  );
}
