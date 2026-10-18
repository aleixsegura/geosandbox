import h3  # importing h3 is what turns the renderer on
import numpy as np
import pytest

from backend import renderers

LLEIDA = h3.latlng_to_cell(41.6176, 0.6206, 8)


def test_one_cell_is_a_hexagon_on_the_map(rt):
    out = rt(LLEIDA, "c")
    m = out["meta"]
    assert out["kind"] == "geometry" and m["title"] == "H3 cell · res 8"
    assert m["crs"]["epsg"] == 4326 and m["features"][0]["n_vertices"] == 7  # 6 corners + closing
    lon, lat = np.asarray(m["features"][0]["centroid"])
    assert lon == pytest.approx(0.6206, abs=0.01) and lat == pytest.approx(41.6176, abs=0.01)
    assert m["attributes"]["rows"][0][:2] == [LLEIDA, "8"]


def test_disk_of_cells_with_area_to_color_by(rt):
    disk = h3.grid_disk(LLEIDA, 2)
    out = rt(disk, "disk")
    assert out["meta"]["count"] == 19 and out["meta"]["resolutions"] == [8]
    assert {s["name"] for s in out["meta"]["numeric"]} == {"resolution", "area_km2"}
    assert out["data"]["columns"]["area_km2"].dtype == np.float32


def test_sets_and_integer_ids_and_mixed_resolutions(rt):
    cells = {h3.str_to_int(LLEIDA), h3.str_to_int(h3.cell_to_parent(LLEIDA, 6))}
    out = rt(cells, "mixed")
    assert out["meta"]["title"] == "H3 cells [2] · res 6–8"


def test_other_strings_and_lists_are_untouched(rt):
    assert rt("hello", "s")["kind"] == "repr"
    assert rt(["8a1fb4662", LLEIDA], "l")["kind"] == "repr"
    assert rt([1, 2, 3], "ints")["kind"] == "repr"


def test_growing_a_disk_changes_the_fingerprint():
    small, big = h3.grid_disk(LLEIDA, 2), h3.grid_disk(LLEIDA, 3)
    assert renderers.fingerprint(sorted(small)) != renderers.fingerprint(sorted(big))
    assert renderers.fingerprint(set(small)) != renderers.fingerprint(set(big))
