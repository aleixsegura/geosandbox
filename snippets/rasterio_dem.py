# Rasterio — a synthetic DEM around Lleida in ETRS89 / UTM 31N.
# Change the colormap and stretch in the inspector: no re-run needed.
# Underscore names are helpers: they are not drawn.
# Toggle "3D" in the inspector for a relief view.

# %% Build a DEM as a numpy array
import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

width, height, pixel = 400, 300, 50.0  # 20 km x 15 km at 50 m
transform = from_origin(290_000, 4_625_000, pixel, pixel)

_cols, _rows = np.meshgrid(np.arange(width), np.arange(height))
_hills = (
    180 * np.exp(-(((_cols - 280) / 70) ** 2 + ((_rows - 90) / 60) ** 2))
    + 120 * np.exp(-(((_cols - 90) / 50) ** 2 + ((_rows - 210) / 80) ** 2))
)
_valley = -60 * np.exp(-(((_cols - _rows * 1.1 - 40) / 25) ** 2))  # the Segre river
elevation = (150 + _hills + _valley + 4 * np.sin(_cols / 7) * np.cos(_rows / 9)).astype("float32")
elevation[:20, :30] = -9999  # a nodata corner

# %% Write it to an in-memory GeoTIFF and open it like a file
memfile = MemoryFile()
with memfile.open(driver="GTiff", width=width, height=height, count=1, dtype="float32",
                  crs="EPSG:25831", transform=transform, nodata=-9999) as dst:
    dst.write(elevation, 1)
dem = memfile.open()
print(dem.profile)

# %% Derived products are plain numpy arrays (no CRS → pixel space)
z = dem.read(1, masked=True)
_dz_dy, _dz_dx = np.gradient(z.filled(np.nan), pixel)
slope_deg = np.degrees(np.arctan(np.hypot(_dz_dx, _dz_dy)))

# %% Hillshade
_azimuth, _altitude = np.radians(315), np.radians(45)
_aspect = np.arctan2(-_dz_dx, _dz_dy)
_slope = np.arctan(np.hypot(_dz_dx, _dz_dy))
hillshade = (np.sin(_altitude) * np.cos(_slope)
             + np.cos(_altitude) * np.sin(_slope) * np.cos(_azimuth - _aspect))
