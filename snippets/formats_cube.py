# File formats (cubes) — one NDVI cube (time × lat × lon) stored four ways.
# Assign a pathlib.Path to draw a NetCDF file or a Zarr store: the inspector
# shows its format, each variable's chunks and codecs, and "Internal layout"
# says how many chunks one map or one pixel's time series has to read.
# "show blocks" draws the spatial chunk grid. Files go to a temporary folder.

# %% 36 months of NDVI around Lleida
import tempfile
import time
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

_t = np.arange(36)[:, None, None]
_lat = np.linspace(41.75, 41.45, 300)
_lon = np.linspace(0.35, 0.85, 400)
_irrigated = np.exp(-(((_lon[None, :] - 0.6) / 0.12) ** 2 + ((_lat[:, None] - 41.6) / 0.08) ** 2))
_ndvi = 0.2 + _irrigated * (0.25 + 0.35 * (0.5 + 0.5 * np.sin(2 * np.pi * (_t - 3) / 12)))  # peaks in July
_ndvi += np.random.default_rng(1).normal(0, 0.02, _ndvi.shape)
cube = xr.Dataset(
    {"ndvi": (("time", "lat", "lon"), _ndvi.astype("float32"), {"long_name": "NDVI", "units": "1"})},
    coords={"time": pd.date_range("2022-01-01", periods=36, freq="MS"), "lat": _lat, "lon": _lon},
)
folder = str(Path(tempfile.mkdtemp(prefix="geo-sandbox-")))

# %% 1. NetCDF3 classic: no chunks, no compression (one contiguous block)
classic = Path(folder, "ndvi_classic.nc")
cube.to_netcdf(classic, format="NETCDF3_CLASSIC")

# %% 2. NetCDF4 (HDF5) chunked for maps: one chunk per date, compressed
maps = Path(folder, "ndvi_maps.nc")
cube.to_netcdf(maps, encoding={"ndvi": {"chunksizes": (1, 300, 400), "zlib": True, "complevel": 4}})

# %% 3. NetCDF4 chunked for time series: every date of a 50 × 50 patch per chunk
series = Path(folder, "ndvi_series.nc")
cube.to_netcdf(series, encoding={"ndvi": {"chunksizes": (36, 50, 50), "zlib": True, "complevel": 4}})

# %% 4. Zarr: a folder with one object per chunk, values packed as int16
# Zarr v2, what most public cloud cubes use today; v3 adds sharding (many chunks per object).
store = Path(folder, "ndvi.zarr")
cube.to_zarr(store, zarr_format=2, encoding={"ndvi": {"chunks": (12, 100, 100), "dtype": "int16",
                                                      "scale_factor": 1e-4, "_FillValue": -32768}})
for _p in (classic, maps, series, store):
    _size = sum(f.stat().st_size for f in _p.rglob("*")) if _p.is_dir() else _p.stat().st_size
    print(f"{_p.name:18} {_size / 1e6:5.1f} MB")

# %% One map or one pixel's history? The chunk shape decides which is cheap
def _best_ms(path, **index):
    times = []
    for _ in range(3):
        _start = time.perf_counter()
        with xr.open_dataset(path) as _ds:  # reopen: no chunk cache carried over
            _ds.ndvi.isel(**index).values
        times.append((time.perf_counter() - _start) * 1000)
    return min(times)

for _p in (classic, maps, series, store):
    print(f"{_p.name:18} one map {_best_ms(_p, time=20):6.1f} ms | "
          f"one pixel's series {_best_ms(_p, lat=150, lon=200):6.1f} ms")
# The classic file is fast both ways only because it is small, uncompressed and
# already in the OS file cache; from object storage it would be read whole.
