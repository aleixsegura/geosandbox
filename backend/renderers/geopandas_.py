"""GeoPandas: GeoSeries and GeoDataFrame as geometry collections.

With a CRS they are reprojected to lon/lat and placed on the map; without one
they go on the graph paper like plain shapely geometries. The first attribute
columns travel with the payload so the inspector can show the clicked row, and
numeric columns travel whole as Float32 so the frontend can color features by
them (choropleth) on the GPU without re-running code.
"""

from __future__ import annotations

import hashlib
from typing import Any

import numpy as np

from backend.renderers import register
from backend.renderers.fallback import short_repr
from backend.renderers.geometry import MAX_FEATURE_META, geometry_payload

MAX_COLUMNS = 8
MAX_NUMERIC_COLUMNS = 16


def _fingerprint(obj: Any) -> str:
    import pandas as pd
    import shapely

    h = hashlib.blake2b(digest_size=12)
    h.update(f"{type(obj).__name__}|{obj.shape}|{obj.crs}".encode())
    geoms = np.asarray(obj.geometry.array if hasattr(obj, "geometry") else obj.array, dtype=object)
    h.update(b"".join(b if b is not None else b"-" for b in shapely.to_wkb(geoms)))
    if isinstance(obj, pd.DataFrame):
        attrs = obj.drop(columns=obj.geometry.name)
        h.update(str(list(attrs.columns)).encode())
        try:
            h.update(pd.util.hash_pandas_object(attrs, index=True).values.tobytes())
        except TypeError:  # unhashable cells (lists, dicts)
            h.update(short_repr(attrs, 4096).encode())
    return h.hexdigest()


def _cell(v: Any) -> str:
    if isinstance(v, str):
        return v if len(v) <= 80 else v[:79] + "…"
    return short_repr(v, 80)


def attributes_meta(attrs: Any, index: Any = None) -> dict[str, Any]:
    """Columns, dtypes and the first rows of a pandas DataFrame, as strings."""
    columns = [str(c) for c in attrs.columns[:MAX_COLUMNS]]
    rows = [[_cell(v) for v in row] for row in attrs.iloc[:MAX_FEATURE_META, :MAX_COLUMNS].itertuples(index=False)]
    index = attrs.index if index is None else index
    return {
        "columns": columns,
        "dtypes": [str(t) for t in attrs.dtypes.iloc[:MAX_COLUMNS]],
        "rows": rows,
        "index": [short_repr(i, 40) for i in index[:MAX_FEATURE_META]],
        "hidden_columns": max(0, attrs.shape[1] - MAX_COLUMNS),
    }


def numeric_columns(attrs: Any) -> tuple[dict[str, np.ndarray], list[dict[str, Any]]]:
    """Float32 values of every numeric column (NaN for missing) and their stats."""
    import pandas as pd

    values: dict[str, np.ndarray] = {}
    stats: list[dict[str, Any]] = []
    for col in attrs.columns:
        s = attrs[col]
        if len(values) >= MAX_NUMERIC_COLUMNS:
            break
        if pd.api.types.is_bool_dtype(s) or not pd.api.types.is_numeric_dtype(s):
            continue
        v = pd.to_numeric(s, errors="coerce").to_numpy(dtype=np.float64, na_value=np.nan, copy=True)
        v[~np.isfinite(v)] = np.nan
        finite = v[np.isfinite(v)]
        if not finite.size:
            continue
        p2, p98 = np.percentile(finite, [2, 98])
        values[str(col)] = v.astype(np.float32)
        stats.append(
            {
                "name": str(col),
                "dtype": str(s.dtype),
                "min": float(finite.min()),
                "max": float(finite.max()),
                "p2": float(p2),
                "p98": float(p98),
                "missing": int(v.size - finite.size),
            }
        )
    return values, stats


def table_payload(
    geoms: Any,
    attrs: Any,
    name: str,
    *,
    title: str,
    crs: Any = None,
    index: Any = None,
    extra_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Geometry payload for a table: one feature per row, plus its attribute columns."""
    values, stats = numeric_columns(attrs)
    out = geometry_payload(
        geoms,
        name,
        title=title,
        crs=crs,
        extra_meta={"attributes": attributes_meta(attrs, index), "numeric": stats, **(extra_meta or {})},
    )
    out["data"]["columns"] = values
    return out


@register("geopandas.geoseries.GeoSeries", fingerprint=_fingerprint)
def render_geoseries(gs: Any, name: str) -> dict[str, Any]:
    geoms = np.asarray(gs.array, dtype=object)
    return geometry_payload(
        geoms,
        name,
        title=f"GeoSeries [{len(gs)}]",
        crs=gs.crs,
        extra_meta={"source": "geopandas", "index": [short_repr(i, 40) for i in gs.index[:MAX_FEATURE_META]]},
    )


@register("geopandas.geodataframe.GeoDataFrame", fingerprint=_fingerprint)
def render_geodataframe(df: Any, name: str) -> dict[str, Any] | None:
    if df._geometry_column_name not in df.columns:
        return None
    geoms = np.asarray(df.geometry.array, dtype=object)
    return table_payload(
        geoms,
        df.drop(columns=df.geometry.name),
        name,
        title=f"GeoDataFrame [{df.shape[0]} × {df.shape[1]}]",
        crs=df.crs,
        extra_meta={"source": "geopandas"},
    )
