import numpy as np
import pytest
import shapely
from shapely.geometry import LineString, MultiPolygon, Point, Polygon


def test_polygon_with_hole(rt):
    poly = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)], holes=[[(3, 3), (6, 3), (6, 6), (3, 6)]])
    out = rt(poly, "parcel")
    assert out["kind"] == "geometry" and out["name"] == "parcel"
    d, m = out["data"], out["meta"]
    assert d["rings"].dtype == np.float32 and d["rings"].shape == (10, 2)
    assert d["ring_offsets"].tolist() == [0, 5, 10]
    assert d["polygon_rings"].tolist() == [0, 2]
    assert m["origin"] == [5.0, 5.0]
    np.testing.assert_allclose(d["rings"][0] + m["origin"], [0, 0])
    assert m["features"][0]["area"] == pytest.approx(91)
    assert m["features"][0]["n_vertices"] == 10
    assert m["is_valid"] and m["crs"] is None
    assert m["features"][0]["wkt"].startswith("POLYGON ((0 0")


def test_invalid_bowtie_marks_location(rt):
    bowtie = Polygon([(0, 0), (2, 2), (2, 0), (0, 2)])
    m = rt(bowtie, "bad")["meta"]
    assert m["is_valid"] is False
    (inv,) = m["invalid"]
    assert inv["reason"].startswith("Self-intersection")
    assert inv["location"] == [1.0, 1.0]
    np.testing.assert_allclose(np.add(inv["display"], m["origin"]), [1, 1])


def test_mixed_list_and_collection(rt):
    items = [Point(0, 0), LineString([(0, 0), (1, 1), (2, 0)]),
             shapely.GeometryCollection([Point(5, 5), MultiPolygon([Polygon([(0, 0), (1, 0), (1, 1)])])])]
    out = rt(items, "things")
    d, m = out["data"], out["meta"]
    assert m["count"] == 3
    assert d["point_feature"].tolist() == [0, 2]
    assert d["line_offsets"].tolist() == [0, 3] and d["line_feature"].tolist() == [1]
    assert d["polygon_feature"].tolist() == [2]
    assert d["anchors"].shape == (3, 2) and d["bboxes"].shape == (3, 4, 2)


def test_non_geometry_list_falls_back(rt):
    assert rt([1, 2, 3], "nums")["kind"] == "repr"
    assert rt([], "empty")["kind"] == "repr"


def test_utm_precision_is_kept_with_origin(rt):
    p = Point(302_345.678, 4_612_345.321).buffer(1)
    out = rt(p, "utm")
    xy = out["data"]["rings"].astype(np.float64) + out["meta"]["origin"]
    assert np.abs(xy - shapely.get_coordinates(p)).max() < 1e-3


def test_ogr_geometry_with_srs_goes_to_lonlat(rt):
    from osgeo import ogr, osr

    srs = osr.SpatialReference()
    srs.ImportFromEPSG(25831)
    g = ogr.CreateGeometryFromWkt("POINT (302000 4611000)")
    g.AssignSpatialReference(srs)
    out = rt(g, "pt")
    m = out["meta"]
    assert m["crs"]["epsg"] == 25831 and m["display_crs"] == "EPSG:4326"
    lon, lat = np.add(out["data"]["points"][0], m["origin"])
    assert 0.5 < lon < 0.7 and 41.5 < lat < 41.7  # Lleida


def test_ogr_authority_axis_order_4326(rt):
    from osgeo import ogr, osr

    srs = osr.SpatialReference()
    srs.ImportFromEPSG(4326)  # GDAL 3 default: authority order, x = latitude
    g = ogr.CreateGeometryFromWkt("POINT (41.61 0.62)")
    g.AssignSpatialReference(srs)
    out = rt(g, "pt")
    lon, lat = np.add(out["data"]["points"][0], out["meta"]["origin"])
    assert lon == pytest.approx(0.62, abs=1e-5) and lat == pytest.approx(41.61, abs=1e-5)

