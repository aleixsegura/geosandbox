# File formats (vector) — the same table written to six formats.
# Assign a pathlib.Path to draw a file. Select each one and compare the File
# and Schema sections: driver, size on disk, companion files, field types,
# what each format can do and, for GeoParquet, its row groups and "geo"
# metadata. Files go to a temporary folder.

# %% 3000 made-up municipalities around Lleida (ETRS89 / UTM 31N)
import tempfile
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely

_rng = np.random.default_rng(7)
_frame = shapely.box(290_000, 4_600_000, 314_000, 4_624_000)
_seeds = shapely.multipoints(_rng.uniform((290_000, 4_600_000), (314_000, 4_624_000), (3000, 2)))
_cells = shapely.intersection(shapely.get_parts(shapely.voronoi_polygons(_seeds, extend_to=_frame)), _frame)
municipalities = gpd.GeoDataFrame(
    {
        "name": [f"M{i:04d}" for i in range(len(_cells))],
        "population_2024": _rng.integers(500, 20_000, len(_cells)),
        "irrigated_share": _rng.random(len(_cells)).round(2),
    },
    geometry=_cells,
    crs="EPSG:25831",
)

# %% Write it to every format
folder = str(Path(tempfile.mkdtemp(prefix="geo-sandbox-")))
_stem = Path(folder, "municipalities")
municipalities.to_file(_stem.with_suffix(".geojson"))
municipalities.to_file(_stem.with_suffix(".gpkg"), layer="municipalities")
municipalities.to_file(_stem.with_suffix(".fgb"))
municipalities.to_file(_stem.with_suffix(".shp"))  # warns: field names longer than 10 characters
municipalities.to_file(_stem.with_suffix(".kml"), driver="LIBKML")
municipalities.to_parquet(_stem.with_suffix(".parquet"), write_covering_bbox=True)

# %% Draw some of them and compare their inspectors
geojson = _stem.with_suffix(".geojson")  # text; GDAL keeps UTM, RFC 7946 would require WGS 84
shapefile = _stem.with_suffix(".shp")  # four files; "population_2024" is cut to "population"
kml = _stem.with_suffix(".kml")  # always WGS 84; numbers come back as text
geoparquet = _stem.with_suffix(".parquet")  # columnar, compressed, with a bbox per row

# %% Size on disk and time to read everything back (best of three)
_sidecars = (".shx", ".dbf", ".prj", ".cpg")
for _p in sorted(Path(folder).iterdir()):
    if _p.suffix in _sidecars:
        continue
    _size = _p.stat().st_size
    if _p.suffix == ".shp":
        _size += sum(_p.with_suffix(s).stat().st_size for s in _sidecars if _p.with_suffix(s).exists())
    _ms = []
    for _ in range(3):
        _t = time.perf_counter()
        _df = gpd.read_parquet(_p) if _p.suffix == ".parquet" else gpd.read_file(_p)
        _ms.append((time.perf_counter() - _t) * 1000)
    print(f"{_p.suffix:9} {_size / 1024:6.1f} KB {min(_ms):6.1f} ms  EPSG:{_df.crs.to_epsg()}  {list(_df.columns)[:3]}")
# GeoParquet is the smallest file, but its time here is mostly a fixed cost
# (pyproj parsing its PROJJSON CRS, ~50 ms) that stops mattering with millions of rows.
