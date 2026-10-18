"""H3 cells (h3-py v4): a cell id, or a list/tuple/set of them, drawn as hexagons.

Only active once the user has imported ``h3``; anything that is not entirely
valid cell ids (strings, or the integer form) is left to other renderers.
Cells become polygons in EPSG:4326 with their id, resolution, area and
whether they are pentagons as attributes, so they can be colored by area
(H3 cells are not equal-area) or resolution.
"""

from __future__ import annotations

import sys
from typing import Any

from backend.renderers import register
from backend.renderers.fallback import fingerprint_collection

MAX_CELLS = 100_000


def _cells(obj: Any) -> list[str] | None:
    """The items as string cell ids, or None unless every one is a valid cell."""
    h3 = sys.modules.get("h3")
    if h3 is None:
        return None
    items = [obj] if isinstance(obj, str) else list(obj)
    if not items or len(items) > MAX_CELLS:
        return None
    cells = []
    for item in items:
        if isinstance(item, int) and not isinstance(item, bool):
            item = h3.int_to_str(item) if item >= 0 else ""
        if not isinstance(item, str) or not h3.is_valid_cell(item):
            return None
        cells.append(item)
    return sorted(cells) if isinstance(obj, (set, frozenset)) else cells


@register("builtins.str", "builtins.list", "builtins.tuple")
@register("builtins.set", "builtins.frozenset", fingerprint=fingerprint_collection)
def render_cells(obj: Any, name: str) -> dict[str, Any] | None:
    cells = _cells(obj)
    if cells is None:
        return None
    import h3
    import pandas as pd
    from pyproj import CRS
    from shapely import Polygon

    from backend.renderers.geopandas_ import table_payload

    # cell_to_boundary gives (lat, lng) pairs; shapely wants x = lng.
    geoms = [Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in cells]
    attrs = pd.DataFrame(
        {
            "cell": cells,
            "resolution": [h3.get_resolution(c) for c in cells],
            "area_km2": [h3.cell_area(c, unit="km^2") for c in cells],
            "is_pentagon": [h3.is_pentagon(c) for c in cells],
        }
    )
    resolutions = sorted(set(attrs["resolution"]))
    res = f"res {resolutions[0]}" if len(resolutions) == 1 else f"res {resolutions[0]}–{resolutions[-1]}"
    kind = "H3 cell" if isinstance(obj, str) else f"H3 cells [{len(cells)}]"
    return table_payload(
        geoms,
        attrs,
        name,
        title=f"{kind} · {res}",
        crs=CRS.from_epsg(4326),
        extra_meta={"source": "h3", "resolutions": resolutions},
    )
