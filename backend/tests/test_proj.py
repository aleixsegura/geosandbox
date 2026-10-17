import numpy as np
import pytest
from pyproj import CRS, Transformer

from backend.renderers.proj import TransformRecord

LLEIDA_LONLAT = (0.6206, 41.6176)


def test_crs_card_with_area_of_use(rt):
    out = rt(CRS.from_epsg(25831), "utm")
    assert out["kind"] == "crs"
    card = out["meta"]["card"]
    assert card["epsg"] == 25831 and card["type"] == "Projected CRS"
    assert card["units"] == "metre" and card["datum"].startswith("European Terrestrial")
    w, s, e, n = card["area_of_use"]["bounds"]
    assert w == pytest.approx(0) and e == pytest.approx(6.01)
    assert out["data"]["rings"].shape == (5, 2)
    assert out["meta"]["display_crs"] == "EPSG:4326"


def test_geographic_crs(rt):
    card = rt(CRS.from_epsg(4326), "wgs84")["meta"]["card"]
    assert card["is_geographic"] and not card["is_projected"]
    assert [a["abbrev"] for a in card["axes"]] == ["Lat", "Lon"]


def test_transformer_card(rt):
    t = Transformer.from_crs(4326, 25831, always_xy=True)
    out = rt(t, "t")
    card = out["meta"]["card"]
    assert out["kind"] == "transformer"
    assert card["definition"].startswith("proj=pipeline")
    assert card["target"]["epsg"] == 25831
    assert out["meta"]["title"].endswith("EPSG:25831")


def _record(always_xy, xx, yy):
    t = Transformer.from_crs(4326, 25831, always_xy=always_xy)
    rec = TransformRecord(t, always_xy)
    rec.add(xx, yy, t.transform(xx, yy))
    return rec


def test_correct_transform_places_both_points_together(rt):
    out = rt(_record(True, *LLEIDA_LONLAT), "tr")
    m, d = out["meta"], out["data"]
    assert out["kind"] == "transform" and m["placed"]
    assert m["max_offset_m"] < 0.01 and m["warnings"] == []
    lon, lat = d["src"][0] + m["origin"]
    assert lon == pytest.approx(0.6206, abs=1e-4) and lat == pytest.approx(41.6176, abs=1e-4)
    assert m["labels"][0]["dst"].startswith("30")  # ~300 km easting


def test_authority_order_without_always_xy(rt):
    # EPSG:4326 authority order is (lat, lon)
    out = rt(_record(False, LLEIDA_LONLAT[1], LLEIDA_LONLAT[0]), "tr")
    lon, lat = out["data"]["src"][0] + out["meta"]["origin"]
    assert lon == pytest.approx(0.6206, abs=1e-4) and out["meta"]["warnings"] == []


def test_swapped_axes_are_flagged(rt):
    # lon/lat passed to an authority-order transformer → point lands near Somalia
    out = rt(_record(False, *LLEIDA_LONLAT), "tr")
    assert any("area of use" in w for w in out["meta"]["warnings"])
    assert out["data"]["flags"].tolist() == [0]


def test_transform_calls_are_logged_in_the_kernel():
    import asyncio

    from backend.kernel import KernelSession
    from backend.tests.kernel_harness import Recorder, run

    async def go():
        rec = Recorder()
        session = KernelSession(rec)
        await session.start()
        try:
            await run(session, rec, "from pyproj import Transformer\n"
                      "t = Transformer.from_crs('EPSG:4326', 'EPSG:25831', always_xy=True)\n"
                      "x, y = t.transform([0.62, 0.63], [41.61, 41.62])\n"
                      "Transformer.from_crs(4326, 25831).transform(41.6, 0.6)\n"
                      "import geopandas as gpd\nfrom shapely import Point\n"
                      "g = gpd.GeoSeries([Point(0.6, 41.6)], crs=4326).to_crs(25831)")
            return rec.frames()
        finally:
            await session.stop()

    frames = asyncio.run(go())
    by_name = {h["name"]: h for h, _ in frames}
    assert by_name["t"]["kind"] == "transformer"
    assert by_name["t.transform()"]["meta"]["count"] == 2
    assert by_name["x"]["kind"] == "repr"  # 1-D arrays are listed, not drawn
    # an anonymous transformer with the same CRS pair gets its own record
    assert by_name["transform EPSG:4326 → EPSG:25831"]["meta"]["count"] == 1
    # library-internal calls (GeoPandas' to_crs) are not logged
    assert len([h for h in by_name.values() if h["kind"] == "transform"]) == 2
