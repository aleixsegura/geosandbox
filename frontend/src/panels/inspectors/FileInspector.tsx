// What a file looks like inside: container, schema, Parquet row groups, COG
// structure; and how any dataset is cut into blocks and overviews.

import type { ReactNode } from "react";

import { useStore } from "../../state/store";
import { Badge, num, Prop, Section } from "../../ui/bits";

export function bytes(n: number | null | undefined): string {
  if (n == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) (v /= 1024), i++;
  return `${i ? v.toFixed(v < 10 ? 1 : 0) : v} ${units[i]}`;
}

function Table({ head, rows, testId }: { head: string[]; rows: (string | number | null)[][]; testId?: string }) {
  return (
    <table className="w-full font-mono text-2xs" data-testid={testId}>
      <thead>
        <tr className="text-pencil">
          {head.map((h, i) => (
            <th key={h} className={`font-normal ${i ? "text-right" : "text-left"}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="text-ink">
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} className={`max-w-[9rem] truncate ${j ? "text-right" : "text-emph"}`} title={String(c ?? "")}>
                {c ?? "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Note({ children, tone = "faint" }: { children: ReactNode; tone?: "faint" | "danger" | "ok" }) {
  const cls = { faint: "text-faint", danger: "text-danger", ok: "text-ok" }[tone];
  return <div className={`mt-1.5 font-sans text-2xs ${cls}`}>{children}</div>;
}

function VectorDetails({ f }: { f: any }) {
  const caps = f.capabilities ?? {};
  return (
    <>
      {f.layers?.length > 1 && (
        <Section title={`Layers (${f.layers.length + f.hidden_layers})`}>
          <Table head={["name", "geometry", "features"]} rows={f.layers.map((l: any) => [l.name, l.geometry_type, l.features])} />
          <Note>The canvas shows the first layer, “{f.layer}”. Read another with gpd.read_file(path, layer=…).</Note>
        </Section>
      )}
      <Section title={`Schema · ${f.layer}`}>
        <Prop label="geometry">
          {f.geometry_type}
          {f.geometry_name ? ` (${f.geometry_name})` : ""}
        </Prop>
        <Prop label="CRS">{f.crs ?? "None"}</Prop>
        {f.fid_column && <Prop label="FID column">{f.fid_column}</Prop>}
        {f.encoding && <Prop label="encoding">{f.encoding}</Prop>}
        <div className="mt-2">
          <Table testId="file-fields" head={["field", "dtype", "OGR type"]} rows={f.fields.map((c: any) => [c.name, c.dtype, c.ogr_type])} />
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {Object.entries(caps).map(([k, v]) => (
            <span key={k} title={v ? "supported" : "not supported"} className={v ? "" : "opacity-50"}>
              <Badge tone={v ? "ok" : "neutral"}>{k.replace(/_/g, " ")}</Badge>
            </span>
          ))}
        </div>
        {f.features_shown < (f.features ?? 0) && (
          <Note>
            Drawing the first {f.features_shown.toLocaleString()} of {f.features.toLocaleString()} features.
          </Note>
        )}
      </Section>
      {f.parquet && <ParquetDetails pq={f.parquet} />}
    </>
  );
}

function ParquetDetails({ pq }: { pq: any }) {
  const geo = pq.geo;
  return (
    <Section title="Parquet">
      <Prop label="rows">{pq.num_rows.toLocaleString()}</Prop>
      <Prop label="row groups">{pq.num_row_groups}</Prop>
      {pq.created_by && <Prop label="created by">{pq.created_by}</Prop>}
      <div className="mt-2">
        <Table
          testId="row-groups"
          head={["row group", "rows", "size"]}
          rows={pq.row_groups.slice(0, 8).map((g: any, i: number) => [i, g.rows.toLocaleString(), bytes(g.bytes)])}
        />
      </div>
      <div className="mt-2">
        <Table head={["column", "physical", "codec"]} rows={pq.columns.map((c: any) => [c.name, c.type, c.compression])} />
      </div>
      {geo ? (
        <div className="mt-3" data-testid="geoparquet">
          <div className="mb-1 font-sans text-2xs font-semibold uppercase tracking-[0.08em] text-pencil">GeoParquet {geo.version}</div>
          <Prop label="geometry column">{geo.primary_column}</Prop>
          <Prop label="encoding">{geo.encoding}</Prop>
          <Prop label="types">{(geo.geometry_types ?? []).join(", ") || "any"}</Prop>
          <Prop label="CRS">{geo.crs ?? "None"}</Prop>
          {geo.bbox && <Prop label="bbox">[{geo.bbox.map((v: number) => num(v, 4)).join(", ")}]</Prop>}
          <Prop label="bbox covering">{geo.covering ? "yes" : "no"}</Prop>
          <Note>
            {geo.covering
              ? "Each row also stores its bbox, so readers can skip row groups outside a query window."
              : "Without a bbox covering column, a spatial filter has to decode every geometry."}
          </Note>
        </div>
      ) : (
        <Note tone="danger">No “geo” metadata: plain Parquet, not GeoParquet.</Note>
      )}
    </Section>
  );
}

function CogDetails({ cog }: { cog: any }) {
  const ifds = Object.entries(cog.ifd_offsets ?? {}) as [string, number][];
  const data = cog.data_offsets ?? {};
  return (
    <Section title="Cloud Optimized GeoTIFF" right={<Badge tone={cog.valid ? "ok" : "danger"}>{cog.valid ? "valid" : "not a COG"}</Badge>}>
      <div data-testid="cog">
        {cog.errors.map((e: string) => (
          <div key={e} className="mb-1 rounded border border-danger/30 bg-danger/5 px-2 py-1 font-mono text-2xs text-danger">
            {e}
          </div>
        ))}
        {cog.warnings.map((w: string) => (
          <div key={w} className="mb-1 font-sans text-2xs text-warn">
            {w}
          </div>
        ))}
        {ifds.length > 0 && (
          <div className="mt-1">
            <Table head={["image", "IFD at byte", "first block at"]} rows={ifds.map(([k, v]) => [k, v.toLocaleString(), data[k]?.toLocaleString() ?? null])} />
            <Note>
              A COG keeps every image directory (IFD) at the start of the file, so one small HTTP range request is enough to
              know where each block lives.
            </Note>
          </div>
        )}
      </div>
    </Section>
  );
}

export function FileSection({ meta }: { meta: Record<string, any> }) {
  const f = meta.file;
  return (
    <>
      <Section title="File" right={<Badge tone="accent">{f.driver}</Badge>}>
        <div className="font-mono text-2xs text-ink" data-testid="file-info">
          <div className="truncate text-pencil" title={f.path}>
            {f.path}
          </div>
        </div>
        <Prop label="size on disk">{bytes(f.size)}</Prop>
        {f.sidecars.length > 0 && (
          <div className="mt-2">
            <Table head={["companion file", "size"]} rows={f.sidecars.map((s: any) => [s.name, bytes(s.size)])} />
          </div>
        )}
      </Section>
      {f.kind === "vector" && <VectorDetails f={f} />}
      {f.cog && <CogDetails cog={f.cog} />}
    </>
  );
}

export function LayoutSection({ name, meta }: { name: string; meta: Record<string, any> }) {
  const style = useStore((s) => s.rasterStyles[name]);
  const setStyle = useStore((s) => s.setRasterStyle);
  const l = meta.layout;
  if (!style || !l) return null;
  const [bw, bh] = l.block;
  return (
    <Section
      title="Internal layout"
      right={
        <button
          type="button"
          data-testid="toggle-blocks"
          disabled={!l.grid}
          onClick={() => setStyle(name, { showBlocks: !style.showBlocks })}
          className={`rounded border px-2 py-0.5 font-sans text-2xs transition-colors disabled:opacity-40 ${
            style.showBlocks ? "border-accent bg-accent/10 text-accent" : "border-rule text-pencil hover:text-ink"
          }`}
        >
          show blocks
        </button>
      }
    >
      <Prop label="organization">{l.organization}</Prop>
      <Prop label="block size">
        {bw} × {bh} px
      </Prop>
      <Prop label="blocks">
        {l.blocks[0]} × {l.blocks[1]} = {(l.blocks[0] * l.blocks[1]).toLocaleString()}
      </Prop>
      <Prop label="compression">{l.compression ?? "none"}</Prop>
      {l.interleave && <Prop label="interleave">{l.interleave}</Prop>}
      {l.layout && <Prop label="layout">{l.layout}</Prop>}
      {l.overviews.length > 0 ? (
        <div className="mt-2">
          <Table head={["overview", "factor", "size"]} rows={l.overviews.map((o: any, i: number) => [i, `1/${o.factor}`, `${o.width} × ${o.height}`])} />
        </div>
      ) : (
        <Prop label="overviews">none</Prop>
      )}
      <Note>
        {l.organization === "strips"
          ? "Strips span the full width: reading a small window still decodes whole rows."
          : "Tiles let a reader fetch only the blocks that touch the window it needs."}
        {!l.grid && " Too many blocks to draw."}
      </Note>
    </Section>
  );
}
