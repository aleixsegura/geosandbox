import { displayOf } from "../canvas/display";
import { useMode } from "../canvas/useMode";
import { useStore, type VarEntry } from "../state/store";
import { VAR_COLORS } from "../theme/themes";
import { Badge } from "../ui/bits";

function summary(e: VarEntry): { text: string; badge?: { text: string; tone: "neutral" | "danger" | "accent" } } {
  const { kind, meta } = e.payload;
  if (meta.file) return { text: meta.file.name, badge: { text: meta.layout?.layout ?? meta.file.driver, tone: "accent" } };
  switch (kind) {
    case "geometry":
      return {
        text: meta.title,
        badge: !meta.is_valid ? { text: "invalid", tone: "danger" } : meta.crs?.epsg ? { text: `EPSG:${meta.crs.epsg}`, tone: "neutral" } : undefined,
      };
    case "raster": {
      const shape = (meta.shape as number[]).join("×");
      return { text: `${shape} ${meta.dtype}`, badge: meta.crs?.epsg ? { text: `EPSG:${meta.crs.epsg}`, tone: "neutral" } : undefined };
    }
    case "dataset":
      return { text: meta.title };
    case "crs":
      return { text: meta.card?.name ?? "CRS", badge: { text: meta.title, tone: "accent" } };
    case "transformer":
      return { text: meta.title };
    case "transform":
      return {
        text: `${meta.count} point${meta.count === 1 ? "" : "s"}`,
        badge: meta.warnings?.length ? { text: "check", tone: "danger" } : undefined,
      };
    default:
      return { text: meta.repr ?? meta.type ?? "" };
  }
}

const GLYPH: Record<string, string> = {
  geometry: "◇",
  raster: "▦",
  dataset: "▤",
  crs: "⊕",
  transformer: "⇄",
  transform: "→",
  repr: "·",
};

export default function VariableList() {
  const order = useStore((s) => s.order);
  const vars = useStore((s) => s.vars);
  const selected = useStore((s) => s.selected);
  const styles = useStore((s) => s.rasterStyles);
  const select = useStore((s) => s.select);
  const setVisible = useStore((s) => s.setVisible);
  const mode = useMode();

  if (!order.length) {
    return (
      <div className="px-4 py-6 text-center font-sans text-xs leading-relaxed text-faint" data-testid="var-list-empty">
        Variables you create appear here.
        <br />
        Use <code className="font-mono text-pencil">show(obj)</code> for intermediate results.
      </div>
    );
  }

  return (
    <ul className="py-1" data-testid="var-list">
      {order.map((name) => {
        const e = vars[name];
        if (!e) return null;
        const disp = displayOf(e.payload, styles[name]);
        const drawable = !!disp;
        const elsewhere = drawable && disp!.mode !== mode;
        const s = summary(e);
        const isSel = selected?.name === name;
        return (
          <li
            key={name}
            data-testid={`var-${name}`}
            data-kind={e.payload.kind}
            onClick={() => select(isSel ? null : name)}
            title={elsewhere ? `Drawn on the ${disp!.mode === "map" ? "map" : "graph paper"} — switch view to see it` : undefined}
            className={`group flex cursor-pointer items-center gap-2 border-l-2 px-3 py-1.5 transition-colors ${
              isSel ? "border-accent bg-accent/[0.07]" : "border-transparent hover:bg-sunken/60"
            } ${elsewhere ? "opacity-50" : ""}`}
          >
            {drawable ? (
              <input
                type="checkbox"
                checked={e.visible}
                onClick={(ev) => ev.stopPropagation()}
                onChange={(ev) => setVisible(name, ev.target.checked)}
                className="gs-check"
                style={{ ["--check" as any]: VAR_COLORS[e.color] }}
                aria-label={`Show ${name}`}
              />
            ) : (
              <span className="w-3.5 text-center font-mono text-xs text-faint">{GLYPH.repr}</span>
            )}
            <span className="min-w-0 max-w-[60%] shrink-0 truncate font-mono text-[0.8125rem] text-emph" title={name}>
              {name}
            </span>
            {drawable && <span className="font-mono text-2xs text-faint">{GLYPH[e.payload.kind]}</span>}
            <span className="ml-auto flex min-w-0 items-center gap-1.5">
              <span className="truncate font-mono text-2xs text-pencil">{s.text}</span>
              {s.badge && <Badge tone={s.badge.tone}>{s.badge.text}</Badge>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
