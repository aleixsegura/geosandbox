# File formats (raster) — one DEM written as three GeoTIFFs.
# Assign a pathlib.Path to draw a file. Select each one and compare the
# "Internal layout" section: "show blocks" draws the strips or tiles GDAL
# reads, and the COG section explains why a Cloud Optimized GeoTIFF can be
# read over HTTP a few blocks at a time. Files go to a temporary folder.

# %% A 2048 × 1536 DEM at 10 m around Lleida
import tempfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from osgeo import gdal
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.windows import Window, bounds
from shapely import box

gdal.UseExceptions()
_w, _h = 2048, 1536
_cols, _rows = np.meshgrid(np.arange(_w) / 5, np.arange(_h) / 5)
_elevation = (
    150
    + 180 * np.exp(-(((_cols - 280) / 70) ** 2 + ((_rows - 90) / 60) ** 2))
    + 120 * np.exp(-(((_cols - 90) / 50) ** 2 + ((_rows - 210) / 80) ** 2))
    - 60 * np.exp(-(((_cols - _rows * 1.1 - 40) / 25) ** 2))
).astype("float32")
_profile = dict(driver="GTiff", width=_w, height=_h, count=1, dtype="float32",
                crs="EPSG:25831", transform=from_origin(290_000, 4_625_000, 10, 10))
folder = str(Path(tempfile.mkdtemp(prefix="geo-sandbox-")))

# %% 1. A plain GeoTIFF: GDAL's defaults are strips, no compression, no overviews
striped = Path(folder, "dem_striped.tif")
with rasterio.open(striped, "w", **_profile) as _dst:
    _dst.write(_elevation, 1)

# %% 2. Tiled and compressed, overviews added afterwards: still not a COG
tiled = Path(folder, "dem_tiled.tif")
with rasterio.open(tiled, "w", **_profile, tiled=True, blockxsize=256, blockysize=256,
                   compress="deflate", predictor=3) as _dst:
    _dst.write(_elevation, 1)
    _dst.build_overviews([2, 4, 8], Resampling.average)  # written after the full-resolution blocks

# %% 3. A COG: GDAL's COG driver puts the headers first and the overviews before the data
cog = Path(folder, "dem_cog.tif")
gdal.Translate(str(cog), str(striped), format="COG",
               creationOptions=["COMPRESS=DEFLATE", "PREDICTOR=YES", "BLOCKSIZE=256", "OVERVIEW_RESAMPLING=AVERAGE"])
for _p in (striped, tiled, cog):
    print(f"{_p.name:16} {_p.stat().st_size / 1e6:5.1f} MB")

# %% Reading a small window: how many blocks does each layout touch?
# Over HTTP every block is a range request: strips need one per row.
window = Window(col_off=900, row_off=700, width=300, height=200)
window_area = gpd.GeoSeries([box(*bounds(window, _profile["transform"]))], crs=25831)
for _p in (striped, tiled, cog):
    with rasterio.open(_p) as _src:
        _bh, _bw = _src.block_shapes[0]
        _n = ((window.col_off + window.width - 1) // _bw - window.col_off // _bw + 1) * (
            (window.row_off + window.height - 1) // _bh - window.row_off // _bh + 1)
        print(f"{_p.name:16} blocks {_bw}×{_bh}: {_n:3} block(s), "
              f"{_n * _bw * _bh / (window.width * window.height):.1f}× the pixels it needs")

# %% Overviews: a quick look reads a reduced copy instead of every pixel
overview = rasterio.open(cog, overview_level=1)  # 1/4 resolution, already in the file
print(overview.width, overview.height)
