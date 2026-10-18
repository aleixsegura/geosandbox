# Zonal statistics with exactextract — raster values summarised per polygon.
# exactextract weighs every pixel by the fraction of it that each polygon
# covers, so small or thin polygons still get exact answers. Its output is a
# GeoDataFrame: select `elevation_stats` and pick "Color by → mean".

# %% A DEM (50 m, ETRS89 / UTM 31N) and made-up municipalities over it
import geopandas as gpd
import numpy as np
import shapely
from exactextract import exact_extract
from rasterio.io import MemoryFile
from rasterio.mask import mask
from rasterio.transform import from_origin

_cols, _rows = np.meshgrid(np.arange(400), np.arange(300))
_elevation = (
    150
    + 180 * np.exp(-(((_cols - 280) / 70) ** 2 + ((_rows - 90) / 60) ** 2))
    + 120 * np.exp(-(((_cols - 90) / 50) ** 2 + ((_rows - 210) / 80) ** 2))
    - 60 * np.exp(-(((_cols - _rows * 1.1 - 40) / 25) ** 2))
).astype("float32")
_elevation[:20, :30] = -9999  # a nodata corner: exactextract skips it
_file = MemoryFile()
with _file.open(driver="GTiff", width=400, height=300, count=1, dtype="float32", crs="EPSG:25831",
                transform=from_origin(290_000, 4_625_000, 50, 50), nodata=-9999) as _dst:
    _dst.write(_elevation, 1)
dem = _file.open()

_rng = np.random.default_rng(3)
_frame = shapely.box(*dem.bounds)
_seeds = shapely.multipoints(_rng.uniform(dem.bounds[:2], dem.bounds[2:], (30, 2)))
municipalities = gpd.GeoDataFrame(
    {"name": [f"M{i:02d}" for i in range(30)]},
    geometry=shapely.intersection(shapely.get_parts(shapely.voronoi_polygons(_seeds, extend_to=_frame)), _frame),
    crs=dem.crs,
)

# %% Mean, min, max, standard deviation and pixel count per municipality
elevation_stats = exact_extract(dem, municipalities, ["mean", "min", "max", "stdev", "count"],
                                include_cols=["name"], include_geom=True, output="pandas")
print(elevation_stats.drop(columns="geometry").head())

# %% Plots smaller than a pixel: covered fraction vs pixel centres
plots = gpd.GeoDataFrame(
    {"plot": list("ABCDEF")},
    geometry=gpd.points_from_xy(_rng.uniform(292_000, 308_000, 6), _rng.uniform(4_612_000, 4_623_000, 6)).buffer(20),
    crs=dem.crs,
)
_exact = exact_extract(dem, plots, ["mean", "count"], include_cols=["plot"], output="pandas")
for _plot, _geom, _mean, _count in zip(plots["plot"], plots.geometry, _exact["mean"], _exact["count"]):
    # rasterio.mask (like most zonal tools) keeps only pixels whose centre is inside the polygon.
    _centres = mask(dem, [_geom], crop=True, filled=False)[0].count()
    print(f"plot {_plot}: exactextract {_count:.2f} pixels → mean {_mean:6.1f} m | pixel centres inside: {_centres}")
