import geopandas as gpd
import numpy as np
from shapely import Point, Polygon


def test_geodataframe_with_crs_goes_to_lonlat(rt):
    gdf = gpd.GeoDataFrame(
        {"name": ["a", "b"], "pop": [10, 20]},
        geometry=[Point(302_000, 4_611_000), Polygon([(302_000, 4_611_000), (303_000, 4_611_000), (303_000, 4_612_000)])],
        crs="EPSG:25831",
    )
    out = rt(gdf, "towns")
    m = out["meta"]
    assert out["kind"] == "geometry" and m["count"] == 2
    assert m["crs"]["epsg"] == 25831 and m["display_crs"] == "EPSG:4326"
    assert m["attributes"]["columns"] == ["name", "pop"]
    assert m["attributes"]["rows"][1] == ["b", "20"]
    lon, lat = out["data"]["points"][0] + m["origin"]
    assert 0.5 < lon < 0.7 and 41.5 < lat < 41.7
    assert m["features"][1]["area"] == 500_000  # metrics stay in source units


def test_geoseries_without_crs_and_missing_geometry(rt):
    gs = gpd.GeoSeries([Point(0, 0), None, Point(1, 1)])
    out = rt(gs, "gs")
    m = out["meta"]
    assert m["crs"] is None and m["count"] == 3
    assert out["data"]["point_feature"].tolist() == [0, 2]
    assert m["features"][1]["geom_type"] is None


def test_numeric_columns_travel_as_float32_for_coloring(rt):
    gdf = gpd.GeoDataFrame(
        {"name": ["a", "b", "c"], "pop": [10, None, 30], "ok": [True, False, True], "share": [0.5, 0.25, np.inf]},
        geometry=[Point(0, 0), Point(1, 1), Point(2, 2)],
    )
    out = rt(gdf, "t")
    cols, stats = out["data"]["columns"], out["meta"]["numeric"]
    assert set(cols) == {"pop", "share"}  # strings and booleans are not colorable
    assert cols["pop"].dtype == np.float32 and np.isnan(cols["pop"][1])
    assert np.isnan(cols["share"][2])  # infinities count as missing
    pop = next(s for s in stats if s["name"] == "pop")
    assert pop["min"] == 10 and pop["max"] == 30 and pop["missing"] == 1
