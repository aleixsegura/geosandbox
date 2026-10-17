import numpy as np
import pytest
import shapely
from affine import Affine

LLEIDA = Affine(30.0, 0, 300_000, 0, -30.0, 4_620_000)


def test_2d_array_in_pixel_space(rt):
    a = np.arange(12 * 20, dtype=np.int16).reshape(12, 20)
    out = rt(a, "dem")
    d, m = out["data"], out["meta"]
    assert out["kind"] == "raster"
    assert d["values"].dtype == np.float32 and d["values"].shape == (1, 12, 20)
    assert d["mask"].dtype == np.uint8 and d["mask"].shape == (1, 12, 20)
    assert m["display"] == {"mode": "pixel", "width": 20, "height": 12}
    assert m["shape"] == [12, 20] and m["dtype"] == "int16" and m["crs"] is None
    s = m["stats"][0]
    assert s["min"] == 0 and s["max"] == 239 and s["p2"] < s["p98"]
    assert d["histograms"].shape == (1, 64) and d["histograms"].sum() == 240


def test_nan_and_masked_arrays_produce_mask(rt):
    a = np.ones((5, 5), np.float64)
    a[0, 0] = np.nan
    out = rt(a, "a")
    assert out["data"]["mask"][0, 0, 0] == 0 and out["data"]["mask"].sum() == 24
    ma = np.ma.masked_less(np.arange(25).reshape(5, 5), 3)
    out = rt(ma, "ma")
    assert out["data"]["mask"].sum() == 22 and out["meta"]["nodata"] == "masked"


def test_large_array_is_downsampled(rt):
    a = np.random.default_rng(0).random((3000, 5000), dtype=np.float32)
    out = rt(a, "big")
    _, h, w = out["data"]["values"].shape
    assert max(h, w) <= 2048
    assert out["meta"]["downsampled_from"] == [3000, 5000]


def test_downsampled_rasterio_reports_original_transform(rt):
    data = np.zeros((3000, 2500), np.float32)
    _mem, ds = _memfile(data)
    m = rt(ds, "big")["meta"]
    assert m["transform"][0] == [30.0, 0.0, 300_000.0]
    assert m["grid_transform"][0][0] == pytest.approx(30.0 * 2500 / m["display"]["width"], rel=0.5)
    assert m["res"] == [30.0, 30.0]


def test_rgb_image_hwc_is_transposed(rt):
    img = np.zeros((10, 12, 3), np.uint8)
    out = rt(img, "img")
    assert out["data"]["values"].shape == (3, 10, 12)
    assert len(out["meta"]["band_names"]) == 3


def test_coordinate_arrays_are_not_rasters(rt):
    assert rt(np.zeros((100, 2)), "coords")["kind"] == "repr"
    assert rt(np.arange(10), "vec")["kind"] == "repr"


def _memfile(data, nodata=None):
    from rasterio.io import MemoryFile

    mem = MemoryFile()
    ds = mem.open(driver="GTiff", width=data.shape[1], height=data.shape[0], count=1, dtype=data.dtype,
                  crs="EPSG:25831", transform=LLEIDA, nodata=nodata)
    ds.write(data, 1)
    ds.close()
    return mem, mem.open()


def test_rasterio_memoryfile_with_crs_goes_on_map(rt):
    data = np.linspace(100, 500, 40 * 50, dtype=np.float32).reshape(40, 50)
    data[0, :5] = -9999
    _mem, ds = _memfile(data, nodata=-9999)
    out = rt(ds, "dem")
    m = out["meta"]
    assert m["crs"]["epsg"] == 25831 and m["nodata"] == -9999
    assert m["display"]["mode"] == "map"
    l, b, r, t = m["display"]["bounds3857"]
    assert 60_000 < l < r < 80_000 and 5_090_000 < b < t < 5_120_000  # ~0.6E 41.6N in mercator
    assert m["transform"][0] == [30.0, 0.0, 300_000.0]
    assert m["res"] == [30.0, 30.0]
    assert m["stats"][0]["min"] == pytest.approx(data[data > -9999].min())
    assert out["data"]["mask"].min() == 0  # nodata pixels masked after the warp


def test_closed_rasterio_dataset_is_repr(rt):
    _mem, ds = _memfile(np.ones((4, 4), np.float32))
    ds.close()
    assert rt(ds, "ds")["kind"] == "repr"


def test_gdal_dataset(rt):
    from osgeo import gdal, osr

    gdal.UseExceptions()
    ds = gdal.GetDriverByName("MEM").Create("", 30, 20, 2, gdal.GDT_Float32)
    ds.SetGeoTransform(LLEIDA.to_gdal())
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(25831)
    ds.SetProjection(srs.ExportToWkt())
    for i in (1, 2):
        band = ds.GetRasterBand(i)
        band.WriteArray(np.full((20, 30), i, np.float32))
        band.SetNoDataValue(0)
    out = rt(ds, "g")
    m = out["meta"]
    assert m["source"] == "gdal" and m["shape"] == [2, 20, 30] and m["dtype"] == "Float32"
    assert m["crs"]["epsg"] == 25831 and m["display"]["mode"] == "map"
    assert [s["mean"] for s in m["stats"]] == [1, 2]


def test_gdal_dataset_without_georef_uses_pixel_space(rt):
    from osgeo import gdal

    ds = gdal.GetDriverByName("MEM").Create("", 8, 6, 1, gdal.GDT_Byte)
    out = rt(ds, "g")
    assert out["meta"]["display"]["mode"] == "pixel" and out["meta"]["transform"] is None



def test_ndarray_of_points(rt):
    arr = shapely.points(np.arange(10).reshape(5, 2))
    out = rt(arr, "pts")
    assert out["kind"] == "geometry" and len(out["data"]["points"]) == 5
