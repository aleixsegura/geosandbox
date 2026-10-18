import os

import geopandas as gpd
import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from shapely import Point, box

from backend import renderers


@pytest.fixture
def towns():
    return gpd.GeoDataFrame(
        {"name": ["Lleida", "Alpicat"], "population_2024": [140_000, 6_600]},
        geometry=[Point(0.6206, 41.6176).buffer(0.01), box(0.55, 41.66, 0.56, 41.67)],
        crs="EPSG:4326",
    )


def _dem(path, **profile):
    # Wider than 1024 px: GDAL's COG validator only requires tiling above that.
    data = np.arange(1200 * 1600, dtype="float32").reshape(1200, 1600)
    with rasterio.open(
        path, "w", driver="GTiff", width=1600, height=1200, count=1, dtype="float32",
        crs="EPSG:25831", transform=from_origin(290_000, 4_625_000, 12.5, 12.5), **profile,
    ) as dst:
        dst.write(data, 1)
    return path


def test_missing_path_is_listed_not_drawn(rt, tmp_path):
    out = rt(tmp_path / "nope.geojson", "p")
    assert out["kind"] == "repr"


def test_geojson_file_draws_its_features_and_schema(rt, tmp_path, towns):
    path = tmp_path / "towns.geojson"
    towns.to_file(path)
    out = rt(path, "f")
    f = out["meta"]["file"]
    assert out["kind"] == "geometry" and out["meta"]["crs"]["epsg"] == 4326
    assert f["driver"] == "GeoJSON" and f["kind"] == "vector" and f["size"] == path.stat().st_size
    assert f["layers"] == [{"name": "towns", "geometry_type": "Polygon", "features": 2}]
    assert [c["name"] for c in f["fields"]] == ["name", "population_2024"]
    assert "population_2024" in out["data"]["columns"]  # colorable like a GeoDataFrame


def test_shapefile_truncates_field_names_and_lists_sidecars(rt, tmp_path, towns):
    path = tmp_path / "towns.shp"
    with pytest.warns(UserWarning):  # column names longer than 10 characters
        towns.to_file(path)
    f = rt(path, "f")["meta"]["file"]
    assert {s["name"] for s in f["sidecars"]} >= {"towns.shx", "towns.dbf", "towns.prj"}
    assert [c["name"] for c in f["fields"]] == ["name", "population"]


def test_kml_is_wgs84_and_turns_numbers_into_text(rt, tmp_path, towns):
    path = tmp_path / "towns.kml"
    towns.to_crs(25831).to_file(path, driver="LIBKML")
    out = rt(path, "f")
    f = out["meta"]["file"]
    assert f["driver"] == "LIBKML" and out["meta"]["crs"]["epsg"] == 4326
    pop = next(c for c in f["fields"] if c["name"] == "population_2024")
    assert pop["ogr_type"] == "OFTString"


def test_geoparquet_reports_row_groups_and_geo_metadata(rt, tmp_path, towns):
    path = tmp_path / "towns.parquet"
    towns.to_parquet(path, write_covering_bbox=True)
    f = rt(path, "f")["meta"]["file"]
    pq = f["parquet"]
    assert f["driver"] == "Parquet"
    assert pq["num_rows"] == 2 and pq["num_row_groups"] == 1
    assert pq["geo"]["primary_column"] == "geometry" and pq["geo"]["encoding"] == "WKB"
    assert pq["geo"]["covering"]["bbox"]["xmin"] == ["bbox", "xmin"]
    assert any(c["name"] == "bbox.xmin" for c in pq["columns"])


def test_striped_geotiff_is_not_a_cog(rt, tmp_path):
    out = rt(_dem(tmp_path / "dem.tif"), "f")
    f, layout = out["meta"]["file"], out["meta"]["layout"]
    assert out["kind"] == "raster" and f["driver"] == "GTiff"
    assert layout["organization"] == "strips" and layout["block"][0] == 1600
    assert f["cog"]["valid"] is False and "not tiled" in f["cog"]["errors"][0]


def test_cog_is_tiled_with_overviews_and_validates(rt, tmp_path):
    from osgeo import gdal

    src = _dem(tmp_path / "dem.tif")
    cog = tmp_path / "dem_cog.tif"
    with gdal.ExceptionMgr(useExceptions=True):
        gdal.Translate(str(cog), str(src), format="COG", creationOptions=["BLOCKSIZE=256", "COMPRESS=DEFLATE"])
    out = rt(cog, "f")
    f, layout = out["meta"]["file"], out["meta"]["layout"]
    assert f["cog"]["valid"] is True and layout["layout"] == "COG"
    assert layout["organization"] == "tiles" and layout["block"] == [256, 256] and layout["blocks"] == [7, 5]
    assert layout["compression"] == "deflate"
    assert [o["factor"] for o in layout["overviews"]] == [2, 4, 8]
    # Block grid: 8 column lines + 6 row lines, in lon/lat around Lleida.
    assert layout["grid"]["space"] == "lnglat"
    assert len(out["data"]["blocks"]["offsets"]) == 15
    lon, lat = out["data"]["blocks"]["lines"][0] + layout["grid"]["origin"]
    assert 0.4 < lon < 0.8 and 41.4 < lat < 41.8


def test_numpy_shaped_dataset_grid_is_in_pixels(rt):
    from rasterio.io import MemoryFile

    with MemoryFile() as mem:
        with mem.open(driver="GTiff", width=40, height=30, count=1, dtype="uint8", tiled=True,
                      blockxsize=16, blockysize=16) as dst:
            dst.write(np.ones((30, 40), "uint8"), 1)
        with mem.open() as ds:
            out = rt(ds, "ds")
    assert out["meta"]["layout"]["grid"]["space"] == "pixel"
    assert out["meta"]["layout"]["blocks"] == [3, 2]
    xy = out["data"]["blocks"]["lines"] + out["meta"]["layout"]["grid"]["origin"]
    assert xy.min() == 0 and xy[:, 0].max() == 40 and xy[:, 1].max() == 30


def test_rewriting_a_file_changes_the_fingerprint(tmp_path, towns):
    path = tmp_path / "towns.geojson"
    towns.to_file(path)
    before = renderers.fingerprint(path)
    towns.iloc[:1].to_file(path)
    os.utime(path, ns=(1, 1))
    assert renderers.fingerprint(path) != before
