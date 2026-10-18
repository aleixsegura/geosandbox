import duckdb
import numpy as np
import pytest


@pytest.fixture(scope="module")
def con():
    con = duckdb.connect()
    try:
        con.load_extension("spatial")
    except duckdb.Error:
        try:
            con.install_extension("spatial")
            con.load_extension("spatial")
        except duckdb.Error:
            pytest.skip("DuckDB spatial extension not installed (needs internet once)")
    return con


def test_relation_with_crs_goes_on_the_map(rt, con):
    rel = con.sql(
        "SELECT i AS id, i * 10 AS depth, ST_SetCRS(ST_Point(300000 + i * 1000, 4610000), 'EPSG:25831') AS geom "
        "FROM range(3) t(i)"
    )
    out = rt(rel, "wells")
    m = out["meta"]
    assert out["kind"] == "geometry" and m["count"] == 3 and m["source"] == "duckdb"
    assert m["crs"]["epsg"] == 25831 and m["display_crs"] == "EPSG:4326"
    assert m["geometry_column"] == "geom" and "SELECT" in m["sql"]
    assert m["attributes"]["columns"] == ["id", "depth"]
    np.testing.assert_array_equal(out["data"]["columns"]["depth"], [0, 10, 20])
    lon, lat = out["data"]["points"][0] + m["origin"]
    assert 0.5 < lon < 0.7 and 41.5 < lat < 41.7


def test_geometry_without_crs_goes_on_graph_paper(rt, con):
    out = rt(con.sql("SELECT ST_Buffer(ST_Point(0, 0), 1) AS g"), "g")
    assert out["kind"] == "geometry" and out["meta"]["crs"] is None
    assert out["meta"]["features"][0]["geom_type"] == "Polygon"


def test_relation_without_geometry_is_a_table_preview(rt, con):
    out = rt(con.sql("SELECT 42 AS answer"), "q")
    assert out["kind"] == "repr" and out["meta"]["preformatted"]
    assert "answer" in out["meta"]["repr"] and "42" in out["meta"]["repr"]
    assert out["meta"]["column_types"] == [{"name": "answer", "type": "INTEGER"}]


def test_large_results_are_capped(rt, con, monkeypatch):
    from backend.renderers import duckdb_

    monkeypatch.setattr(duckdb_, "MAX_ROWS", 10)
    out = rt(con.sql("SELECT ST_Point(i, i) AS g FROM range(25) t(i)"), "many")
    assert out["meta"]["count"] == 10 and out["meta"]["truncated"] == 10
