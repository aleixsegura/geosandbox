# xarray — labelled N-D arrays. A DataArray with x/y coordinates and a
# CRS (via rioxarray) lands on the map; extra dimensions get sliders,
# and `time` can be played as an animation.

# %% A monthly NDVI-like cube over Lleida (ETRS89 / UTM 31N)
import numpy as np
import pandas as pd
import xarray as xr
import rioxarray  # noqa: F401  (adds the .rio accessor)

x = 296_000 + 100 * np.arange(120) + 50
y = 4_624_000 - 100 * np.arange(90) - 50
time = pd.date_range("2024-01-01", periods=12, freq="MS")

_xx, _yy = np.meshgrid(x, y)
_fields = np.sin((_xx - x.min()) / 1800) * np.cos((_yy - y.min()) / 1500)
_season = np.sin(np.linspace(0, 2 * np.pi, 12, endpoint=False) - np.pi / 2)

ndvi = xr.DataArray(
    0.45 + 0.25 * _fields[None] * (0.6 + 0.4 * _season[:, None, None]) + 0.2 * _season[:, None, None],
    dims=("time", "y", "x"),
    coords={"time": time, "y": y, "x": x},
    name="ndvi",
    attrs={"units": "1", "long_name": "Normalised difference vegetation index"},
).rio.write_crs("EPSG:25831")

# %% Reductions are DataArrays too: the annual mean is a 2D raster
annual_mean = ndvi.mean("time")
summer = ndvi.sel(time=slice("2024-06-01", "2024-08-31")).mean("time")

# %% A Dataset bundles variables that share dimensions
cube = xr.Dataset({"ndvi": ndvi, "anomaly": ndvi - annual_mean})
cube.attrs["title"] = "Synthetic vegetation cube"
