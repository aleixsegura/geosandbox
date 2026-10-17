# Shapely in 3D: geometries can carry a Z coordinate (height, depth…).
# Shapely keeps Z but measures in 2D: area, length and buffer ignore it.
# Run everything, then press the cube in the canvas toolbar (or 3).
# Drag to orbit; hover a vertex to read its x, y, z.

# %% Points with Z: boreholes, with depth as negative Z
import numpy as np
import shapely
from shapely import LineString, MultiPoint, Point, Polygon

boreholes = MultiPoint([(2, 2, -6), (8, 3, -11), (5, 8, -4)])
print(boreholes.has_z, [p.z for p in boreholes.geoms])

# %% A LineString Z: a trail climbing a hill
trail = LineString([(0, 0, 0), (3, 1, 2), (6, 3, 5), (8, 6, 7), (9, 9, 8)])
_xyz = shapely.get_coordinates(trail, include_z=True)
print("2D length:", round(trail.length, 2))  # Z is ignored
print("3D length:", round(np.linalg.norm(np.diff(_xyz, axis=0), axis=1).sum(), 2))

# %% A Polygon Z: a sloping roof (its area is the 2D footprint's)
roof = Polygon([(11, 0, 4), (16, 0, 4), (16, 5, 7), (11, 5, 7)])
print("area:", roof.area)

# %% Adding and dropping Z
footprint = shapely.force_2d(roof)  # drawn on the z = 0 plane
mast = shapely.force_3d(Point(13.5, 8), z=9)
print(roof.buffer(1).has_z)  # False: buffer returns a 2D result
