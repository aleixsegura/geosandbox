"""GeoPandas: GeoSeries and GeoDataFrame as geometry collections.

With a CRS they are reprojected to lon/lat and placed on the map; without one
they go on the graph paper like plain shapely geometries. The first attribute
columns travel with the payload so the inspector can show the clicked row.
"""

from __future__ import annotations

import hashlib
from typing import Any

import numpy as np

from backend.renderers import register
from backend.renderers.fallback import short_repr
from backend.renderers.geometry import MAX_FEATURE_META, geometry_payload

MAX_COLUMNS = 8


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


def _attributes(df: Any) -> dict[str, Any]:
    attrs = df.drop(columns=df.geometry.name)
    columns = [str(c) for c in attrs.columns[:MAX_COLUMNS]]
    rows = [
        [short_repr(v, 80) if not isinstance(v, str) else (v if len(v) <= 80 else v[:79] + "…") for v in row]
        for row in attrs.iloc[:MAX_FEATURE_META, :MAX_COLUMNS].itertuples(index=False)
    ]
    return {
        "columns": columns,
        "dtypes": [str(t) for t in attrs.dtypes.iloc[:MAX_COLUMNS]],
        "rows": rows,
        "index": [short_repr(i, 40) for i in df.index[:MAX_FEATURE_META]],
        "hidden_columns": max(0, attrs.shape[1] - MAX_COLUMNS),
    }


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
    return geometry_payload(
        geoms,
        name,
        title=f"GeoDataFrame [{df.shape[0]} × {df.shape[1]}]",
        crs=df.crs,
        extra_meta={"source": "geopandas", "attributes": _attributes(df)},
    )
