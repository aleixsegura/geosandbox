"""DuckDB relations: query results with a GEOMETRY column are drawn like GeoDataFrames.

A relation is lazy, so drawing it runs the query (with a LIMIT). The first
GEOMETRY column is drawn and the other columns become attributes, numeric ones
colorable. Since DuckDB 1.5 a CRS can be part of the column type
(``GEOMETRY('EPSG:25831')``, from ST_SetCRS, ST_Transform or GeoParquet): with
one the result goes on the map, without one on graph paper, like shapely.
Coordinates are read as x = east; DuckDB's ST_Transform to EPSG:4326 writes
lat/lon unless called with ``always_xy := true``.

Relations without geometry are listed with a text preview of their rows.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np

from backend.renderers import register

MAX_ROWS = 20_000
PREVIEW_ROWS = 20
PREVIEW_CHARS = 6000
_CRS_TYPE = re.compile(r"^GEOMETRY\('(.*)'\)$", re.S)


def _sql(rel: Any) -> str | None:
    try:
        return rel.sql_query()
    except Exception:
        return None


def _fingerprint(rel: Any) -> str:
    return f"{id(rel)}|{_sql(rel)}"


def _crs(type_name: str) -> Any:
    from pyproj import CRS

    match = _CRS_TYPE.match(type_name)
    if not match:
        return None
    try:
        return CRS.from_user_input(match.group(1))
    except Exception:
        return None


def _preview(rel: Any, name: str, columns: list[dict[str, str]]) -> dict[str, Any]:
    text = str(rel.limit(PREVIEW_ROWS))
    if len(text) > PREVIEW_CHARS:
        text = text[: PREVIEW_CHARS - 1] + "…"
    meta = {"type": "duckdb.DuckDBPyRelation", "repr": text, "preformatted": True, "sql": _sql(rel), "column_types": columns}
    return {"kind": "repr", "name": name, "data": {}, "meta": meta}


@register("_duckdb.DuckDBPyRelation", "duckdb.DuckDBPyRelation", "duckdb.duckdb.DuckDBPyRelation", fingerprint=_fingerprint)
def render_relation(rel: Any, name: str) -> dict[str, Any]:
    import shapely

    from backend.renderers.geopandas_ import table_payload

    names = list(rel.columns)
    types = [str(t) for t in rel.types]
    columns = [{"name": n, "type": t} for n, t in zip(names, types)]
    geometry = [n for n, t in zip(names, types) if t == "GEOMETRY" or t.startswith("GEOMETRY(")]
    if not geometry:
        return _preview(rel, name, columns)

    df = rel.limit(MAX_ROWS + 1).df()
    truncated = len(df) > MAX_ROWS
    df = df.iloc[:MAX_ROWS]
    column = geometry[0]
    wkb = np.array([bytes(b) if b is not None else None for b in df[column]], dtype=object)
    geoms = shapely.from_wkb(wkb)
    crs = _crs(types[names.index(column)])
    return table_payload(
        geoms,
        df.drop(columns=geometry),
        name,
        title=f"DuckDB relation [{len(df):,}{'+' if truncated else ''} × {len(names)}]",
        crs=crs,
        extra_meta={
            "source": "duckdb",
            "sql": _sql(rel),
            "column_types": columns,
            "geometry_column": column,
            "truncated": MAX_ROWS if truncated else None,
        },
    )
