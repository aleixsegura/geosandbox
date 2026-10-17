"""pyproj: CRS cards, Transformer cards and a log of transformed coordinates.

``Transformer.transform`` is patched in the kernel so every call made by user
code is recorded and drawn after the cell finishes. Source points are placed
using the transformer's source CRS and target points using its target CRS,
both honouring the transformer's axis order. For a correct transformation the
two coincide; points outside the CRS area of use or non-finite results are
flagged, which is how swapped lat/lon mistakes show up.
"""

from __future__ import annotations

import hashlib
import sys
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from backend.renderers import on_setup, payload, register
from backend.renderers.geometry import crs_summary, geometry_payload

MAX_POINTS = 5000
MAX_LABELS = 200


# ---------------------------------------------------------------------------- CRS card
def _area_polygon(area: Any):
    """Area-of-use bbox as a shapely (Multi)Polygon in lon/lat, split at the antimeridian."""
    from shapely import MultiPolygon, box

    if area is None:
        return None
    w, s, e, n = area.bounds
    if w <= e:
        return box(w, s, e, n)
    return MultiPolygon([box(w, s, 180, n), box(-180, s, e, n)])


def crs_card(crs: Any) -> dict[str, Any]:
    area = crs.area_of_use
    try:
        datum = crs.datum.name if crs.datum else None
    except Exception:
        datum = None
    op = crs.coordinate_operation
    return {
        **(crs_summary(crs) or {}),
        "type": crs.type_name,
        "is_projected": bool(crs.is_projected),
        "datum": datum,
        "ellipsoid": crs.ellipsoid.name if crs.ellipsoid else None,
        "projection": op.method_name if op else None,
        "axes": [
            {"name": a.name, "abbrev": a.abbrev, "direction": a.direction, "unit": a.unit_name}
            for a in crs.axis_info
        ],
        "area_of_use": (
            {"name": area.name, "bounds": list(area.bounds)} if area is not None else None
        ),
        "wkt": crs.to_wkt(pretty=True),
    }


def _with_area(kind: str, name: str, area: Any, meta: dict[str, Any]) -> dict[str, Any]:
    from pyproj import CRS

    poly = _area_polygon(area)
    if poly is None:
        return payload(kind, name, {}, meta)
    out = geometry_payload([poly], name, title=meta.get("title", kind), crs=CRS.from_epsg(4326), single=True)
    out["kind"] = kind
    out["meta"] = {**out["meta"], **meta}
    return out


def _hash_text(text: str) -> str:
    return hashlib.blake2b(text.encode(), digest_size=12).hexdigest()


@register("pyproj.crs.crs.CRS", fingerprint=lambda crs: _hash_text(crs.to_wkt()))
def render_crs(crs: Any, name: str) -> dict[str, Any]:
    card = crs_card(crs)
    title = f"EPSG:{card['epsg']}" if card.get("epsg") else card["type"]
    return _with_area("crs", name, crs.area_of_use, {"title": title, "card": card})


# ---------------------------------------------------------------------------- Transformer
_NORMALIZED = " (with axis order normalized for visualization)"


def _short(crs: Any) -> str:
    if crs is None:
        return "?"
    epsg = crs.to_epsg()
    if epsg:
        return f"EPSG:{epsg}"
    if crs.name.endswith(_NORMALIZED):
        # always_xy=True hands back an axis-swapped copy without an EPSG code
        from pyproj import CRS

        try:
            base = CRS.from_user_input(crs.name[: -len(_NORMALIZED)])
            if base.to_epsg():
                return f"EPSG:{base.to_epsg()}"
        except Exception:
            pass
        return crs.name[: -len(_NORMALIZED)]
    return crs.name


@register(
    "pyproj.transformer.Transformer",
    fingerprint=lambda t: _hash_text(f"{t.definition}|{getattr(t, '_gs_always_xy', None)}"),
)
def render_transformer(t: Any, name: str) -> dict[str, Any]:
    src, dst = t.source_crs, t.target_crs
    meta = {
        "title": f"{_short(src)} → {_short(dst)}",
        "card": {
            "source": crs_card(src) if src is not None else None,
            "target": crs_card(dst) if dst is not None else None,
            "description": t.description,
            "definition": t.definition,
            "accuracy": t.accuracy,
            "always_xy": getattr(t, "_gs_always_xy", None),
            "area_of_use": (
                {"name": t.area_of_use.name, "bounds": list(t.area_of_use.bounds)} if t.area_of_use else None
            ),
            "operations": [op.name for op in (t.operations or [])],
        },
    }
    return _with_area("transformer", name, t.area_of_use, meta)


# ---------------------------------------------------------------------------- transform log
@dataclass
class TransformRecord:
    transformer: Any
    always_xy: bool
    src: list[np.ndarray] = field(default_factory=list)
    dst: list[np.ndarray] = field(default_factory=list)

    def add(self, xx: Any, yy: Any, out: Any) -> None:
        try:
            a = np.atleast_1d(np.asarray(xx, dtype=np.float64)).ravel()
            b = np.atleast_1d(np.asarray(yy, dtype=np.float64)).ravel()
            oa = np.atleast_1d(np.asarray(out[0], dtype=np.float64)).ravel()
            ob = np.atleast_1d(np.asarray(out[1], dtype=np.float64)).ravel()
        except (TypeError, ValueError):
            return
        room = MAX_POINTS - sum(len(s) for s in self.src)
        if room <= 0 or not (len(a) == len(b) == len(oa) == len(ob)):
            return
        self.src.append(np.column_stack([a, b])[:room])
        self.dst.append(np.column_stack([oa, ob])[:room])


def _to_lonlat(crs: Any, xy: np.ndarray, always_xy: bool) -> np.ndarray:
    from pyproj import Transformer

    tr = Transformer.from_crs(crs, "EPSG:4326", always_xy=always_xy)
    a, b = _ORIGINAL.get("transform", Transformer.transform)(tr, xy[:, 0], xy[:, 1])
    return np.column_stack([a, b] if always_xy else [b, a])


def _inside(area: Any, lonlat: np.ndarray) -> np.ndarray:
    if area is None:
        return np.ones(len(lonlat), bool)
    w, s, e, n = area.bounds
    lon, lat = lonlat[:, 0], lonlat[:, 1]
    in_lon = (lon >= w) & (lon <= e) if w <= e else (lon >= w) | (lon <= e)
    return in_lon & (lat >= s) & (lat <= n) & np.isfinite(lonlat).all(axis=1)


def _fmt(xy: np.ndarray) -> str:
    return ", ".join("nan" if not np.isfinite(v) else f"{v:.6f}" if abs(v) < 1000 else f"{v:.2f}" for v in xy)


@register("backend.renderers.proj.TransformRecord")
def render_transform(rec: TransformRecord, name: str) -> dict[str, Any]:
    from pyproj import Geod

    t = rec.transformer
    src_xy = np.concatenate(rec.src) if rec.src else np.zeros((0, 2))
    dst_xy = np.concatenate(rec.dst) if rec.dst else np.zeros((0, 2))
    src_crs, dst_crs = t.source_crs, t.target_crs
    if src_crs is None or dst_crs is None or not len(src_xy):
        return payload("transform", name, {}, {"title": t.description, "placed": False, "count": len(src_xy)})

    with np.errstate(invalid="ignore"):
        src_ll = _to_lonlat(src_crs, src_xy, rec.always_xy)
        dst_ll = _to_lonlat(dst_crs, dst_xy, rec.always_xy)
    ok = np.isfinite(src_ll).all(axis=1) & np.isfinite(dst_ll).all(axis=1)
    src_in = _inside(src_crs.area_of_use, src_ll)
    dst_in = _inside(dst_crs.area_of_use, dst_ll)
    _, _, dist = Geod(ellps="WGS84").inv(
        np.where(ok, src_ll[:, 0], 0), np.where(ok, src_ll[:, 1], 0),
        np.where(ok, dst_ll[:, 0], 0), np.where(ok, dst_ll[:, 1], 0),
    )
    dist = np.where(ok, dist, np.nan)

    finite = np.concatenate([src_ll[ok], dst_ll[ok]])
    origin = (finite.min(axis=0) + finite.max(axis=0)) / 2 if len(finite) else np.zeros(2)
    warnings = []
    if (~ok).any():
        warnings.append(f"{int((~ok).sum())} point(s) produced non-finite coordinates (outside the projection's domain?)")
    for inside, crs in ((src_in, src_crs), (dst_in, dst_crs)):
        outside = int((~inside & ok).sum())
        if outside:
            warnings.append(
                f"{outside} point(s) fall outside the area of use of {_short(crs)}"
                " — check the axis order (lat/lon vs lon/lat, always_xy) and the CRS."
            )
    good = ok & src_in & dst_in

    labels = [
        {"src": _fmt(s), "dst": _fmt(d), "lonlat": _fmt(ll), "ok": bool(g), "offset_m": None if not o else float(dd)}
        for s, d, ll, o, g, dd in zip(src_xy[:MAX_LABELS], dst_xy[:MAX_LABELS], src_ll[:MAX_LABELS], ok, good, dist)
    ]
    meta = {
        "title": f"{_short(src_crs)} → {_short(dst_crs)}",
        "placed": True,
        "count": int(len(src_xy)),
        "origin": origin.tolist(),
        "display_crs": "EPSG:4326",
        "display_bounds": [*finite.min(axis=0).tolist(), *finite.max(axis=0).tolist()] if len(finite) else None,
        "source": crs_summary(src_crs),
        "target": crs_summary(dst_crs),
        "source_label": _short(src_crs),
        "target_label": _short(dst_crs),
        "always_xy": rec.always_xy,
        "max_offset_m": float(np.nanmax(dist)) if ok.any() else None,
        "labels": labels,
        "warnings": warnings,
    }
    data = {
        "src": np.where(ok[:, None], src_ll - origin, np.nan).astype(np.float32),
        "dst": np.where(ok[:, None], dst_ll - origin, np.nan).astype(np.float32),
        "flags": good.astype(np.uint8),
    }
    return payload("transform", name, data, meta)


_ORIGINAL: dict[str, Any] = {}


def _cell_directory() -> str | None:
    try:
        from ipykernel.compiler import get_tmp_directory

        return get_tmp_directory()
    except Exception:
        return None


@on_setup
def patch_pyproj(session: Any) -> None:
    from pyproj import Transformer

    if _ORIGINAL:
        return
    _ORIGINAL["transform"] = Transformer.transform
    _ORIGINAL["from_crs"] = Transformer.from_crs
    active: dict[int, TransformRecord] = {}

    def from_crs(crs_from: Any, crs_to: Any, always_xy: bool = False, *args: Any, **kwargs: Any) -> Any:
        t = _ORIGINAL["from_crs"](crs_from, crs_to, always_xy, *args, **kwargs)
        t._gs_always_xy = bool(always_xy)
        return t

    def label_for(t: Any) -> str:
        # Name the record after the variable holding the transformer, when there is one.
        for name, value in session.ip.user_ns.items():
            if value is t and not name.startswith("_"):
                return f"{name}.transform()"
        return f"transform {_short(t.source_crs)} → {_short(t.target_crs)}"

    cell_dir = _cell_directory()

    def transform(self: Any, xx: Any, yy: Any, *args: Any, **kwargs: Any) -> Any:
        out = _ORIGINAL["transform"](self, xx, yy, *args, **kwargs)
        direction = kwargs.get("direction", "FORWARD")
        forward = str(getattr(direction, "name", direction)).upper() == "FORWARD"
        # Only calls written in a cell: libraries (GeoPandas' to_crs…) use pyproj too.
        caller = sys._getframe(1).f_code.co_filename
        from_cell = caller.startswith(cell_dir) if cell_dir else caller.startswith("<ipython-input")
        if forward and from_cell and not session.rendering:
            try:
                rec = active.get(id(self))
                if rec is None:
                    rec = active[id(self)] = TransformRecord(self, getattr(self, "_gs_always_xy", False))
                    session.defer(rec, label_for(self))
                rec.add(xx, yy, out)
            except Exception:
                pass
        return out

    Transformer.from_crs = staticmethod(from_crs)
    Transformer.transform = transform
    session.ip.events.register("post_run_cell", lambda _result: active.clear())
