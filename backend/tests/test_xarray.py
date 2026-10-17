import numpy as np
import pandas as pd
import pytest
import xarray as xr


def _grid(nt=0):
    x = 300_000 + 30 * np.arange(40) + 15
    y = 4_620_000 - 30 * np.arange(30) - 15
    shape = (nt, 30, 40) if nt else (30, 40)
    dims = ("time", "y", "x") if nt else ("y", "x")
    coords = {"y": y, "x": x}
    if nt:
        coords["time"] = pd.date_range("2024-01-01", periods=nt, freq="MS")
    return xr.DataArray(np.random.default_rng(1).random(shape), dims=dims, coords=coords, name="ndvi",
                        attrs={"units": "1"})


def test_2d_dataarray_without_crs_is_pixel_raster(rt):
    out = rt(_grid(), "da")
    m = out["meta"]
    assert out["kind"] == "raster" and m["cube"] is None
    assert m["display"]["mode"] == "pixel"
    assert m["transform"][0] == [30.0, 0.0, 300_000.0]
    assert m["summary"]["dims"] == {"y": 30, "x": 40}
    assert m["units"] == "1"


def test_rioxarray_crs_goes_on_map(rt):
    import rioxarray  # noqa: F401

    da = _grid().rio.write_crs("EPSG:25831")
    m = rt(da, "da")["meta"]
    assert m["crs"]["epsg"] == 25831 and m["display"]["mode"] == "map"


def test_time_cube_has_slider_dims_and_global_stats(rt):
    import rioxarray  # noqa: F401

    da = _grid(nt=6).rio.write_crs("EPSG:25831")
    out = rt(da, "cube")
    d, m = out["data"], out["meta"]
    assert d["values"].shape[0] == 6
    (dim,) = m["cube"]["dims"]
    assert dim["name"] == "time" and dim["is_time"] and dim["labels"][1] == "2024-02-01"
    assert m["stats_global"]["count"] > 0


def test_dims_are_reordered_to_y_x(rt):
    da = _grid(nt=3).transpose("x", "time", "y")
    out = rt(da, "t")
    assert out["data"]["values"].shape[1:] == out["data"]["mask"].shape[1:]
    assert out["meta"]["spatial_dims"] == ["y", "x"]


def test_lat_lon_coords_assume_wgs84(rt):
    da = xr.DataArray(np.ones((10, 20)), dims=("lat", "lon"),
                      coords={"lat": np.linspace(42, 41, 10), "lon": np.linspace(0, 1, 20)})
    m = rt(da, "t")["meta"]
    assert m["crs"]["epsg"] == 4326 and m["crs_assumed"]


def test_1d_dataarray_is_repr(rt):
    assert rt(xr.DataArray(np.arange(5)), "v")["kind"] == "repr"


def test_dataset_summary_and_children(rt):
    ds = xr.Dataset({"ndvi": _grid(nt=2), "label": ("time", ["a", "b"])})
    ds.attrs["title"] = "demo"
    out = rt(ds, "ds")
    m = out["meta"]
    assert out["kind"] == "dataset"
    assert [v["name"] for v in m["data_vars"]] == ["ndvi", "label"]
    assert [v["renderable"] for v in m["data_vars"]] == [True, False]
    assert m["summary"]["attrs"]["title"] == "'demo'"
    child = out["data"]["variables"]["ndvi"]
    assert child["data"]["values"].dtype == np.float32 and child["meta"]["cube"]["dims"][0]["size"] == 2
