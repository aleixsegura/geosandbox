# H3 — a hierarchical grid of hexagons (h3-py v4). Cell ids are plain strings:
# once h3 is imported, a cell id, or a list or set of them, is drawn as hexagons
# with their id, resolution and area as attributes.
# Select a group of cells and try "Color by → area_km2" or "→ resolution".

# %% The cell that contains Lleida, its parent and its children
import geopandas as gpd
import h3
import numpy as np
import pandas as pd
from shapely import Polygon
from shapely.geometry import shape

lleida = h3.latlng_to_cell(41.6176, 0.6206, 7)  # note the order: lat, lng
parent = h3.cell_to_parent(lleida, 6)
children = h3.cell_to_children(lleida, 8)  # 7 children that do not tile the parent exactly
print(lleida, h3.get_resolution(lleida), f"{h3.cell_area(lleida, unit='km^2'):.2f} km²")

# %% Neighbourhoods: a disk and a ring, in grid steps
disk = h3.grid_disk(lleida, 2)  # 1 + 6 + 12 cells
ring = h3.grid_ring(lleida, 3)  # only the cells exactly 3 steps away
print(len(disk), len(ring), h3.grid_distance(lleida, ring[0]))

# %% Points → cells → counts: wells aggregated into hexagons ("Color by → wells")
_rng = np.random.default_rng(11)
_lat = 41.62 + _rng.normal(0, 0.04, 2000)
_lng = 0.62 + _rng.normal(0, 0.06, 2000)
_counts = pd.Series([h3.latlng_to_cell(la, lo, 8) for la, lo in zip(_lat, _lng)]).value_counts()
wells_per_cell = gpd.GeoDataFrame(
    {"cell": _counts.index, "wells": _counts.values},
    # cell_to_boundary gives (lat, lng) pairs: swap them for shapely's (x, y)
    geometry=[Polygon([(lng, lat) for lat, lng in h3.cell_to_boundary(c)]) for c in _counts.index],
    crs="EPSG:4326",
)

# %% Polygon → cells → compact: the same area with fewer, mixed-resolution cells
_field = h3.LatLngPoly([(41.56, 0.50), (41.58, 0.58), (41.55, 0.64), (41.51, 0.60), (41.52, 0.52)])
covered = h3.h3shape_to_cells(_field, 9)  # cells whose centre is inside
compacted = h3.compact_cells(covered)  # children replaced by their parent wherever all 7 are present
field_outline = gpd.GeoSeries([shape(h3.cells_to_h3shape(covered))], crs="EPSG:4326")
print(len(covered), "cells at res 9 →", len(compacted), "after compacting")

# %% H3 cells are not equal-area, and latitude is not the reason:
# the size depends on where a cell falls on the icosahedron H3 is built on.
for _name, _lat_lng in [("Quito", (-0.18, -78.47)), ("0°, 0°", (0, 0)), ("Lleida", (41.6, 0.6)), ("Tromsø", (69.65, 18.96))]:
    print(f"{_name:7} res 7: {h3.cell_area(h3.latlng_to_cell(*_lat_lng, 7), unit='km^2'):.2f} km²")
