import { useEffect } from "react";

import { suggestedExaggeration } from "../../canvas/display";
import { stretchRange } from "../../canvas/layers";
import { useStore, type RasterStyle } from "../../state/store";
import { colormapCss, COLORMAPS } from "../../theme/colormaps";
import { Badge, Code, num, Prop, Section, Segmented } from "../../ui/bits";
import { CubeIcon, PauseIcon, PlayIcon } from "../../ui/icons";
import type { NDArray } from "../../ws/protocol";

interface Raster {
  data: Record<string, any>;
  meta: Record<string, any>;
}

function Histogram({ hist, stats, range }: { hist: Float32Array; stats: any; range: [number, number] }) {
  const max = Math.max(...hist, 1);
  const W = 260;
  const H = 54;
  const span = stats.max - stats.min || 1;
  const x = (v: number) => ((v - stats.min) / span) * W;
  const lo = Math.max(0, Math.min(W, x(range[0])));
  const hi = Math.max(0, Math.min(W, x(range[1])));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" preserveAspectRatio="none" data-testid="histogram">
      <rect x={lo} y={0} width={Math.max(1, hi - lo)} height={H} className="fill-accent/10" />
      {Array.from(hist).map((c, i) => {
        const h = (Math.sqrt(c) / Math.sqrt(max)) * (H - 4);
        return <rect key={i} x={(i * W) / hist.length + 0.5} y={H - h} width={W / hist.length - 1} height={h} className="fill-pencil/60" />;
      })}
      <line x1={lo} x2={lo} y1={0} y2={H} className="stroke-accent" strokeWidth={1} strokeDasharray="2 2" />
      <line x1={hi} x2={hi} y1={0} y2={H} className="stroke-accent" strokeWidth={1} strokeDasharray="2 2" />
    </svg>
  );
}

export function Colorbar({
  style,
  range,
  units,
}: {
  style: { colormap: string; reverse: boolean };
  range: [number, number];
  units?: string | null;
}) {
  return (
    <div data-testid="colorbar">
      <div className="h-3 rounded-sm border border-rule" style={{ background: colormapCss(style.colormap, style.reverse) }} />
      <div className="mt-1 flex font-mono text-2xs text-pencil">
        <span>{num(range[0], 3)}</span>
        <span className="mx-auto text-faint">{units ?? ""}</span>
        <span>{num(range[1], 3)}</span>
      </div>
    </div>
  );
}

/** Colormap swatches plus a reverse toggle; shared by rasters and choropleths. */
export function ColormapGrid({
  colormap,
  reverse,
  onChange,
}: {
  colormap: string;
  reverse: boolean;
  onChange: (patch: { colormap?: string; reverse?: boolean }) => void;
}) {
  return (
    <div className="mb-2 grid grid-cols-4 gap-1.5" data-testid="colormaps">
      {COLORMAPS.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          data-testid={`cmap-${c}`}
          onClick={() => onChange({ colormap: c })}
          className={`group rounded-sm border p-0.5 transition-colors ${colormap === c ? "border-accent" : "border-rule hover:border-pencil"}`}
        >
          <div className="h-2.5 rounded-[2px]" style={{ background: colormapCss(c, reverse) }} />
          <div className={`mt-0.5 font-mono text-[0.6rem] leading-3 ${colormap === c ? "text-accent" : "text-pencil"}`}>{c}</div>
        </button>
      ))}
      <button
        type="button"
        onClick={() => onChange({ reverse: !reverse })}
        className={`rounded-sm border font-mono text-[0.6rem] transition-colors ${reverse ? "border-accent text-accent" : "border-rule text-pencil hover:border-pencil"}`}
      >
        reverse
      </button>
    </div>
  );
}

function Matrix({ m }: { m: number[][] }) {
  return (
    <div className="flex items-stretch gap-1 font-mono text-2xs text-ink" data-testid="affine">
      <div className="w-1.5 rounded-l border-y border-l border-pencil/60" />
      <div className="grid flex-1 grid-cols-3 gap-x-3 gap-y-0.5 py-0.5">
        {m.flat().map((v, i) => (
          <span key={i} className={`text-right ${i >= 6 ? "text-faint" : ""}`}>
            {num(v, 6)}
          </span>
        ))}
      </div>
      <div className="w-1.5 rounded-r border-y border-r border-pencil/60" />
    </div>
  );
}

function CubeSliders({ name, meta, style }: { name: string; meta: any; style: RasterStyle }) {
  const setStyle = useStore((s) => s.setRasterStyle);
  const dims = meta.cube.dims as { name: string; size: number; labels: string[]; is_time: boolean }[];
  const playDim = Math.max(0, dims.findIndex((d) => d.is_time));

  useEffect(() => {
    if (!style.playing) return;
    const id = window.setInterval(() => {
      const cur = useStore.getState().rasterStyles[name];
      if (!cur) return;
      const slice = [...cur.slice];
      slice[playDim] = ((slice[playDim] ?? 0) + 1) % dims[playDim].size;
      setStyle(name, { slice });
    }, 650);
    return () => window.clearInterval(id);
  }, [style.playing, name, playDim, dims, setStyle]);

  return (
    <Section
      title="Dimensions"
      right={
        <button
          type="button"
          data-testid="play"
          onClick={() => setStyle(name, { playing: !style.playing })}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-2xs text-pencil hover:bg-sunken hover:text-ink"
        >
          {style.playing ? <PauseIcon /> : <PlayIcon />} {dims[playDim].name}
        </button>
      }
    >
      {dims.map((d, i) => (
        <div key={d.name} className="py-1">
          <div className="flex items-baseline font-sans text-xs">
            <span className="text-pencil">{d.name}</span>
            <span className="ml-auto font-mono text-ink">{d.labels[style.slice[i] ?? 0]}</span>
            <span className="ml-2 font-mono text-2xs text-faint">
              {(style.slice[i] ?? 0) + 1}/{d.size}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={d.size - 1}
            value={style.slice[i] ?? 0}
            data-testid={`slider-${d.name}`}
            onChange={(e) => {
              const slice = [...style.slice];
              slice[i] = Number(e.target.value);
              setStyle(name, { slice, playing: false });
            }}
            className="gs-range w-full"
          />
        </div>
      ))}
      {meta.cube.truncated && (
        <div className="font-sans text-2xs text-faint">
          Showing the first {meta.cube.truncated.kept} of {meta.cube.truncated.of} {meta.cube.truncated.dim}.
        </div>
      )}
    </Section>
  );
}

export function RasterControls({ name, raster }: { name: string; raster: Raster }) {
  const style = useStore((s) => s.rasterStyles[name]);
  const setStyle = useStore((s) => s.setRasterStyle);
  if (!style) return null;
  const { meta, data } = raster;
  const range = stretchRange(meta, style);
  const statsFor = meta.cube ? meta.stats_global : meta.stats?.[style.band] ?? meta.stats_global;
  const histArr: NDArray | undefined =
    meta.cube || !data.histograms?.shape?.[0] ? data.histogram_global : subarray(data.histograms, style.band);
  const hist = histArr?.data as Float32Array | undefined;
  const bands = meta.stats?.length ?? 1;
  const single = bands === 1 || !!meta.cube;

  return (
    <>
      <Section title="Display">
        <ColormapGrid colormap={style.colormap} reverse={style.reverse} onChange={(patch) => setStyle(name, patch)} />
        <div className="mb-3 flex items-center gap-2">
          <span className="font-sans text-xs text-pencil">stretch</span>
          <Segmented
            testId="stretch"
            value={style.stretch}
            onChange={(v) => setStyle(name, { stretch: v })}
            options={[
              { value: "p2p98", label: "2–98 %" },
              { value: "minmax", label: "min–max" },
            ]}
          />
          {bands > 1 && !meta.cube && (
            <select
              value={style.band}
              onChange={(e) => setStyle(name, { band: Number(e.target.value) })}
              className="gs-select ml-auto"
            >
              {(meta.band_names ?? []).map((b: string, i: number) => (
                <option key={i} value={i}>
                  {b}
                </option>
              ))}
            </select>
          )}
        </div>
        <Colorbar style={style} range={range} units={meta.units} />
        {hist && statsFor && (
          <div className="mt-2">
            <Histogram hist={hist as Float32Array} stats={statsFor} range={range} />
          </div>
        )}
        {single && (
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              data-testid="toggle-3d"
              onClick={() =>
                setStyle(name, style.show3d ? { show3d: false } : { show3d: true, exaggeration: suggestedExaggeration(meta) })
              }
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded border px-2 py-1 font-sans text-xs transition-colors ${
                style.show3d ? "border-accent bg-accent/10 text-accent" : "border-rule text-pencil hover:text-ink"
              }`}
            >
              <CubeIcon /> 3D view
            </button>
            {style.show3d && (
              <label className="flex min-w-[10rem] flex-1 items-center gap-2 font-sans text-2xs text-pencil">
                <span>exaggeration</span>
                <input
                  type="range"
                  min={0.5}
                  max={50}
                  step={0.5}
                  value={style.exaggeration}
                  onChange={(e) => setStyle(name, { exaggeration: Number(e.target.value) })}
                  className="gs-range flex-1"
                  data-testid="exaggeration"
                />
                <span className="w-7 font-mono text-ink">×{style.exaggeration}</span>
              </label>
            )}
          </div>
        )}
      </Section>
      {meta.cube && <CubeSliders name={name} meta={meta} style={style} />}
    </>
  );
}

function subarray(h: NDArray, band: number): NDArray {
  const bins = h.shape[1];
  return { data: (h.data as Float32Array).subarray(band * bins, (band + 1) * bins), shape: [bins] };
}

export function RasterProperties({ raster }: { raster: Raster }) {
  const { meta } = raster;
  const stats: any[] = meta.cube ? [meta.stats_global] : meta.stats ?? [];
  return (
    <>
      <Section title="Raster">
        <Prop label="shape">({(meta.shape as number[]).join(", ")})</Prop>
        <Prop label="dtype">{meta.dtype}</Prop>
        <Prop label="nodata">{meta.nodata == null ? "None" : String(meta.nodata)}</Prop>
        {meta.res && (
          <Prop label="resolution">
            {num(meta.res[0], 6)} × {num(meta.res[1], 6)} {meta.crs?.units ?? ""}
          </Prop>
        )}
        {meta.bounds && (
          <Prop label="bounds">[{meta.bounds.map((v: number) => num(v, 2)).join(", ")}]</Prop>
        )}
        {meta.driver && <Prop label="driver">{meta.driver}</Prop>}
        {meta.downsampled_from && (
          <div className="mt-1.5 rounded border border-warn/40 bg-warn/5 px-2 py-1 font-sans text-2xs text-ink">
            Downsampled for display from {meta.downsampled_from.join(" × ")} px to {meta.display.height} × {meta.display.width}.
          </div>
        )}
        {meta.crs_assumed && (
          <div className="mt-1.5 font-sans text-2xs text-faint">No CRS attached: EPSG:4326 assumed from lat/lon coordinates.</div>
        )}
        {meta.warp_error && <div className="mt-1.5 font-sans text-2xs text-danger">Could not reproject: {meta.warp_error}</div>}
      </Section>
      <Section title="CRS" right={meta.crs?.epsg ? <Badge>EPSG:{meta.crs.epsg}</Badge> : undefined}>
        {meta.crs ? (
          <>
            <Prop label="name">{meta.crs.name}</Prop>
            <Prop label="units">{meta.crs.units ?? "—"}</Prop>
          </>
        ) : (
          <div className="font-sans text-xs text-pencil">None — drawn in pixel coordinates on graph paper.</div>
        )}
      </Section>
      {meta.transform && (
        <Section title="Affine transform">
          <Matrix m={meta.transform} />
          <div className="mt-1 font-sans text-2xs text-faint">x = a·col + b·row + c, y = d·col + e·row + f</div>
        </Section>
      )}
      {stats.length > 0 && (
        <Section title={meta.cube ? "Statistics (all slices)" : "Band statistics"}>
          <table className="w-full font-mono text-2xs">
            <thead>
              <tr className="text-pencil">
                <th className="text-left font-normal">{meta.cube ? "" : "band"}</th>
                {["min", "max", "mean", "std"].map((h) => (
                  <th key={h} className="text-right font-normal">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-ink">
              {stats.slice(0, 16).map((s, i) => (
                <tr key={i}>
                  <td className="text-pencil">{meta.cube ? "all" : meta.band_names?.[i] ?? i + 1}</td>
                  {["min", "max", "mean", "std"].map((k) => (
                    <td key={k} className="text-right">
                      {s ? num(s[k], 3) : "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
      {meta.crs_wkt && (
        <Section title="WKT">
          <Code maxHeight={120}>{meta.crs_wkt}</Code>
        </Section>
      )}
    </>
  );
}
