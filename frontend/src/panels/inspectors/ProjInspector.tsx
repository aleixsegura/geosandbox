import type { VarEntry } from "../../state/store";
import { Badge, Code, CopyButton, num, Prop, Section } from "../../ui/bits";

function CrsCard({ card, title = "CRS" }: { card: any; title?: string }) {
  if (!card) return null;
  return (
    <Section title={title} right={card.epsg ? <Badge tone="accent">EPSG:{card.epsg}</Badge> : undefined}>
      <div className="mb-1.5 font-sans text-sm font-medium leading-snug text-emph">{card.name}</div>
      <Prop label="type">{card.type}</Prop>
      <Prop label="units">{card.units ?? "—"}</Prop>
      <Prop label="datum">{card.datum ?? "—"}</Prop>
      <Prop label="ellipsoid">{card.ellipsoid ?? "—"}</Prop>
      {card.projection && <Prop label="projection">{card.projection}</Prop>}
      <Prop label="axes">
        {(card.axes ?? []).map((a: any) => `${a.abbrev} (${a.direction})`).join(", ")}
      </Prop>
      {card.area_of_use && (
        <div className="mt-2 rounded border border-rule bg-sunken/40 px-2 py-1.5">
          <div className="font-sans text-2xs uppercase tracking-wider text-pencil">Area of use</div>
          <div className="mt-0.5 line-clamp-3 font-sans text-xs text-ink" title={card.area_of_use.name}>
            {card.area_of_use.name}
          </div>
          <div className="mt-0.5 font-mono text-2xs text-pencil">
            W {num(card.area_of_use.bounds[0], 2)} · S {num(card.area_of_use.bounds[1], 2)} · E {num(card.area_of_use.bounds[2], 2)} · N{" "}
            {num(card.area_of_use.bounds[3], 2)}
          </div>
        </div>
      )}
    </Section>
  );
}

export function CrsInspector({ entry }: { entry: VarEntry }) {
  const card = entry.payload.meta.card;
  return (
    <>
      <CrsCard card={card} />
      <Section title="WKT" right={<CopyButton text={card.wkt} />}>
        <Code maxHeight={220}>{card.wkt}</Code>
      </Section>
    </>
  );
}

export function TransformerInspector({ entry }: { entry: VarEntry }) {
  const card = entry.payload.meta.card;
  return (
    <>
      <Section title="Transformation">
        <div className="mb-1 flex items-center gap-2 font-sans text-sm text-emph">
          <span>{card.source?.epsg ? `EPSG:${card.source.epsg}` : card.source?.name ?? "?"}</span>
          <span className="text-pencil">→</span>
          <span>{card.target?.epsg ? `EPSG:${card.target.epsg}` : card.target?.name ?? "?"}</span>
        </div>
        <div className="mb-1.5 font-sans text-xs text-pencil">{card.description}</div>
        <Prop label="always_xy">{card.always_xy == null ? "—" : card.always_xy ? "True" : "False"}</Prop>
        <Prop label="accuracy">{card.accuracy == null || card.accuracy < 0 ? "unknown" : `${num(card.accuracy)} m`}</Prop>
        {card.operations?.length > 0 && <Prop label="operations">{card.operations.join(" + ")}</Prop>}
      </Section>
      <Section title="Pipeline" right={<CopyButton text={card.definition} />}>
        <Code>{card.definition.replace(/ step /g, "\n  step ")}</Code>
      </Section>
      <CrsCard card={card.source} title="Source CRS" />
      <CrsCard card={card.target} title="Target CRS" />
    </>
  );
}

export function TransformInspector({ entry }: { entry: VarEntry }) {
  const m = entry.payload.meta;
  return (
    <>
      <Section title="Transformed points">
        <Prop label="points">{m.count}</Prop>
        <Prop label="always_xy">{m.always_xy ? "True" : "False"}</Prop>
        <Prop label="max gap" title="Distance between where the source and target coordinates land on Earth">
          {m.max_offset_m == null ? "—" : `${num(m.max_offset_m, 3)} m`}
        </Prop>
        {m.warnings?.length ? (
          m.warnings.map((w: string) => (
            <div key={w} className="mt-1.5 rounded border border-danger/30 bg-danger/5 px-2 py-1 font-sans text-2xs text-danger">
              {w}
            </div>
          ))
        ) : (
          <div className="mt-1.5 font-sans text-2xs text-ok">Source and target land on the same spot ✓</div>
        )}
      </Section>
      {m.labels?.length > 0 && (
        <Section title="Coordinates">
          <table className="w-full font-mono text-2xs">
            <thead>
              <tr className="text-pencil">
                <th className="text-left font-normal">{m.source_label ?? "source"}</th>
                <th className="text-left font-normal">{m.target_label ?? "target"}</th>
              </tr>
            </thead>
            <tbody>
              {m.labels.slice(0, 50).map((l: any, i: number) => (
                <tr key={i} className={l.ok ? "text-ink" : "text-danger"}>
                  <td className="pr-2">{l.src}</td>
                  <td>{l.dst}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}
