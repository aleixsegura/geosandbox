"""Shapely geometries, ``ogr.Geometry`` and lists/arrays of them.

Every geometry is a *feature*. Features are exploded into three flat groups
(points, lines, polygon rings) whose coordinates are Float32 offsets from a
Float64 ``origin`` in ``meta`` — deck.gl adds the origin back on the GPU, so
UTM-sized coordinates keep sub-millimetre precision.

Geometries with a CRS (ogr with a spatial reference, GeoPandas) are reprojected
to EPSG:4326 for display; metrics in ``meta`` stay in the source CRS.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any, Sequence

import numpy as np

from backend.renderers import payload, register

MAX_FEATURE_META = 2000
WKT_LIMIT = 2000
_LOCATION_RE = re.compile(r"\[\s*([-+\d.eE]+)\s+([-+\d.eE]+)")


def crs_summary(crs: Any) -> dict[str, Any] | None:
    if crs is None:
        return None
    try:
        epsg = crs.to_epsg()
    except Exception:
        epsg = None
    return {
        "name": crs.name,
        "epsg": epsg,
        "is_geographic": bool(crs.is_geographic),
        "proj4": _proj4(crs),
        "units": _units(crs),
    }


def _proj4(crs: Any) -> str | None:
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            return crs.to_proj4()
        except Exception:
            return None


def _units(crs: Any) -> str | None:
    try:
        return crs.axis_info[0].unit_name
    except Exception:
        return None


def to_shapely(obj: Any) -> Any | None:
    """Convert a shapely or ogr geometry to shapely; ``None`` if it is neither."""
    import shapely

    if isinstance(obj, shapely.Geometry):
        return obj
    if type(obj).__module__ == "osgeo.ogr" and type(obj).__name__ == "Geometry":
        return shapely.from_wkb(bytes(obj.ExportToIsoWkb()))
    return None


def ogr_crs(geom: Any) -> tuple[Any, bool]:
    """CRS of an ogr geometry and whether its data axis order is x=east (traditional GIS)."""
    srs = geom.GetSpatialReference()
    if srs is None:
        return None, True
    from pyproj import CRS

    crs = CRS.from_wkt(srs.ExportToWkt())
    mapping = list(srs.GetDataAxisToSRSAxisMapping())
    # Data x is CRS axis mapping[0]. Traditional order means x is the east-ish axis.
    first_axis = crs.axis_info[mapping[0] - 1].direction if crs.axis_info else "east"
    return crs, first_axis.lower() in ("east", "west")


def _explode(geoms: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Split multi-part geometries and collections recursively into simple parts."""
    import shapely

    idx = np.arange(len(geoms))
    parts = geoms
    while True:
        types = shapely.get_type_id(parts)
        if not np.isin(types, (4, 5, 6, 7)).any():
            return parts, idx
        parts, sub = shapely.get_parts(parts, return_index=True)
        idx = idx[sub]


def _offsets(index: np.ndarray, n: int) -> np.ndarray:
    counts = np.bincount(index, minlength=n) if n else np.zeros(0, np.int64)
    return np.concatenate([[0], np.cumsum(counts)]).astype(np.uint32)


def _location(reason: str) -> list[float] | None:
    match = _LOCATION_RE.search(reason or "")
    return [float(match.group(1)), float(match.group(2))] if match else None


def _truncate(text: str, limit: int = WKT_LIMIT) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _display_transformer(crs: Any, traditional: bool):
    """Callable mapping (n,2) source coords to (n,2) lon/lat, or None for no CRS."""
    if crs is None:
        return None
    from pyproj import CRS, Transformer

    if crs == CRS.from_epsg(4326) and traditional:
        return lambda xy: xy
    tr = Transformer.from_crs(crs, "EPSG:4326", always_xy=traditional)

    def apply(xy: np.ndarray) -> np.ndarray:
        if not len(xy):
            return xy
        a, b = tr.transform(xy[:, 0], xy[:, 1])
        # always_xy=True gives lon/lat; authority order of EPSG:4326 is lat/lon
        return np.column_stack([a, b] if traditional else [b, a])

    return apply


def geometry_payload(
    geoms: Sequence[Any],
    name: str,
    *,
    title: str,
    crs: Any = None,
    traditional: bool = True,
    single: bool = False,
    extra_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    import shapely

    geoms = np.asarray(list(geoms) if not isinstance(geoms, np.ndarray) else geoms, dtype=object).ravel()
    n = len(geoms)
    present = np.array([g is not None for g in geoms], dtype=bool)
    safe = np.where(present, geoms, shapely.from_wkt("GEOMETRYCOLLECTION EMPTY"))
    project = _display_transformer(crs, traditional)

    def display(xy: np.ndarray) -> np.ndarray:
        xy = np.asarray(xy, dtype=np.float64).reshape(-1, 2)
        return project(xy) if project is not None else xy

    non_empty = safe[~shapely.is_empty(safe)]
    parts, feat = _explode(safe)
    keep = ~shapely.is_empty(parts)
    parts, feat = parts[keep], feat[keep]
    types = shapely.get_type_id(parts)

    pts = parts[types == 0]
    point_xy = display(shapely.get_coordinates(pts))
    point_feature = feat[types == 0]

    is_line = (types == 1) | (types == 2)
    lines = parts[is_line]
    line_xy, line_idx = shapely.get_coordinates(lines, return_index=True)
    line_xy = display(line_xy)
    line_feature = feat[is_line]

    polys = parts[types == 3]
    poly_feature = feat[types == 3]
    rings, ring_poly = shapely.get_rings(polys, return_index=True)
    ring_xy, ring_idx = shapely.get_coordinates(rings, return_index=True)
    ring_xy = display(ring_xy)

    all_xy = np.concatenate([point_xy, line_xy, ring_xy]) if n else np.zeros((0, 2))
    if len(all_xy):
        lo, hi = np.nanmin(all_xy, axis=0), np.nanmax(all_xy, axis=0)
        origin = (lo + hi) / 2
        display_bounds = [*lo.tolist(), *hi.tolist()]
    else:
        origin = np.zeros(2)
        display_bounds = None

    def rel(xy: np.ndarray) -> np.ndarray:
        return (np.asarray(xy, dtype=np.float64).reshape(-1, 2) - origin).astype(np.float32)

    # Per-feature metrics (in source CRS units).
    valid = shapely.is_valid(safe)
    areas = shapely.area(safe)
    lengths = shapely.length(safe)
    bounds = shapely.bounds(safe)
    centroids = shapely.centroid(safe)
    anchors = shapely.point_on_surface(safe)
    n_vertices = shapely.get_num_coordinates(safe)
    centroid_xy = shapely.get_coordinates(centroids, return_index=True)
    anchor_xy = shapely.get_coordinates(anchors, return_index=True)

    def per_feature(xy_idx: tuple[np.ndarray, np.ndarray]) -> np.ndarray:
        xy, idx = xy_idx
        out = np.full((n, 2), np.nan)
        out[idx] = display(xy)
        return out

    centroid_display = per_feature(centroid_xy)
    anchor_display = per_feature(anchor_xy)
    corners = np.stack(
        [bounds[:, [0, 1]], bounds[:, [2, 1]], bounds[:, [2, 3]], bounds[:, [0, 3]]], axis=1
    ).reshape(-1, 2)
    bbox_display = np.full((n * 4, 2), np.nan)
    finite = np.isfinite(corners).all(axis=1)
    bbox_display[finite] = display(corners[finite])

    invalid = []
    features = []
    for i in range(n):
        g = safe[i]
        reason = None if valid[i] else shapely.is_valid_reason(g)
        loc = _location(reason) if reason else None
        if reason:
            invalid.append(
                {
                    "feature": i,
                    "reason": reason,
                    "location": loc,
                    "display": (rel(display(np.array([loc])))[0].tolist() if loc else None),
                }
            )
        if i < MAX_FEATURE_META:
            features.append(
                {
                    "geom_type": g.geom_type if present[i] else None,
                    "is_valid": bool(valid[i]),
                    "reason": reason,
                    "location": loc,
                    "area": float(areas[i]),
                    "length": float(lengths[i]),
                    "bounds": bounds[i].tolist(),
                    "centroid": shapely.get_coordinates(centroids[i]).ravel().tolist() or None,
                    "n_vertices": int(n_vertices[i]),
                    "is_empty": bool(shapely.is_empty(g)),
                    "has_z": bool(shapely.has_z(g)),
                    "wkt": _truncate(shapely.to_wkt(g, rounding_precision=6, trim=True)) if i < 200 else None,
                }
            )

    total_bounds = (
        shapely.total_bounds(non_empty).tolist() if len(non_empty) else [None, None, None, None]
    )

    # Z travels in its own buffers, only when some geometry has it; 2D parts get NaN.
    has_z = bool(len(non_empty) and shapely.has_z(non_empty).any())
    z_data: dict[str, np.ndarray] = {}
    z_range = None
    if has_z:
        for key, geoms_ in (("points_z", pts), ("lines_z", lines), ("rings_z", rings)):
            z_data[key] = shapely.get_coordinates(geoms_, include_z=True)[:, 2].astype(np.float32)
        all_z = np.concatenate(list(z_data.values()))
        if np.isfinite(all_z).any():
            z_range = [float(np.nanmin(all_z)), float(np.nanmax(all_z))]
    meta = {
        "title": title,
        "single": single,
        "count": n,
        "origin": origin.tolist(),
        "crs": crs_summary(crs),
        "display_crs": "EPSG:4326" if crs is not None else None,
        "display_bounds": display_bounds,
        "bounds": total_bounds,
        "area": float(np.nansum(areas)),
        "length": float(np.nansum(lengths)),
        "n_vertices": int(n_vertices.sum()),
        "is_valid": bool(valid.all()),
        "invalid": invalid,
        "features": features,
        "geom_types": sorted({g.geom_type for g in safe[present]}),
        "has_z": has_z,
        "z_range": z_range,
    }
    if extra_meta:
        meta.update(extra_meta)

    data = {
        "points": rel(point_xy),
        "point_feature": point_feature.astype(np.uint32),
        "lines": rel(line_xy),
        "line_offsets": _offsets(line_idx, len(lines)),
        "line_feature": line_feature.astype(np.uint32),
        "rings": rel(ring_xy),
        "ring_offsets": _offsets(ring_idx, len(rings)),
        "polygon_rings": _offsets(ring_poly, len(polys)),
        "polygon_feature": poly_feature.astype(np.uint32),
        "centroids": rel(centroid_display),
        "anchors": rel(anchor_display),
        "bboxes": rel(bbox_display).reshape(n, 4, 2),
        **z_data,
    }
    return payload("geometry", name, data, meta)


def _wkb_hash(geoms: Sequence[Any]) -> str:
    import shapely

    h = hashlib.blake2b(digest_size=12)
    for g in geoms:
        sg = to_shapely(g)
        h.update(shapely.to_wkb(sg) if sg is not None else b"?")
        if sg is not None and type(g).__module__ == "osgeo.ogr":
            srs = g.GetSpatialReference()
            h.update((srs.ExportToWkt() if srs else "").encode())
    return h.hexdigest()


def _fingerprint_one(obj: Any) -> str:
    return _wkb_hash([obj])


def _fingerprint_many(obj: Any) -> str:
    seq = list(obj) if not isinstance(obj, np.ndarray) else obj.ravel().tolist()
    if len(seq) > 50_000:
        return f"{id(obj)}:{len(seq)}"
    if not seq or any(to_shapely(g) is None for g in seq[:1]):
        from backend.renderers.fallback import fingerprint_repr

        return fingerprint_repr(obj)
    try:
        return _wkb_hash(seq)
    except Exception:
        from backend.renderers.fallback import fingerprint_repr

        return fingerprint_repr(obj)


@register("shapely.geometry.base.BaseGeometry", fingerprint=_fingerprint_one)
def render_shapely(obj: Any, name: str) -> dict[str, Any]:
    return geometry_payload([obj], name, title=obj.geom_type, single=True)


@register("osgeo.ogr.Geometry", fingerprint=_fingerprint_one)
def render_ogr(obj: Any, name: str) -> dict[str, Any]:
    crs, traditional = ogr_crs(obj)
    geom = to_shapely(obj)
    return geometry_payload(
        [geom],
        name,
        title=f"ogr.Geometry · {geom.geom_type}",
        crs=crs,
        traditional=traditional,
        single=True,
        extra_meta={"source": "ogr", "axis_order": "x=east" if traditional else "authority (x=north)"},
    )


def geometries_in(seq: Sequence[Any]) -> list[Any] | None:
    """Shapely versions of every item, or None if any item is not a geometry."""
    if len(seq) == 0:
        return None
    out = []
    for item in seq:
        g = to_shapely(item)
        if g is None:
            return None
        out.append(g)
    return out


@register("builtins.list", "builtins.tuple", fingerprint=_fingerprint_many)
def render_sequence(obj: Sequence[Any], name: str) -> dict[str, Any] | None:
    geoms = geometries_in(obj)
    if geoms is None:
        return None
    crs, traditional = None, True
    ogr_items = [g for g in obj if type(g).__module__ == "osgeo.ogr"]
    if ogr_items and len(ogr_items) == len(obj):
        crss = [ogr_crs(g) for g in ogr_items]
        if all(c[0] is not None and c[0] == crss[0][0] and c[1] == crss[0][1] for c in crss):
            crs, traditional = crss[0]
    return geometry_payload(geoms, name, title=f"{type(obj).__name__}[{len(obj)}] of geometries", crs=crs, traditional=traditional)


def render_geometry_array(arr: np.ndarray, name: str) -> dict[str, Any] | None:
    """Object ndarray of geometries (what ``shapely.points(...)`` returns)."""
    import shapely

    flat = arr.ravel()
    if not len(flat) or not all(isinstance(g, shapely.Geometry) for g in flat):
        return None
    return geometry_payload(flat, name, title=f"ndarray{list(arr.shape)} of geometries")
