# Shapely basics — geometries live on a Cartesian plane (no CRS),
# so they are drawn on graph paper. Run everything with Shift+Enter,
# or one cell with Ctrl+Enter.

# %% A polygon with a hole
from shapely import Point, LineString, Polygon, MultiPoint
from shapely.validation import explain_validity

parcel = Polygon(
    shell=[(0, 0), (12, 0), (12, 8), (0, 8)],
    holes=[[(3, 2), (6, 2), (6, 5), (3, 5)]],
)
print(parcel.area, parcel.is_valid)

# %% Lines have a direction (see the small arrows)
river = LineString([(-3, 10), (3, 6.5), (8, 7.5), (13, 3.5), (19, 5)])
wells = MultiPoint([(15.5, -1.5), (18, 0.5), (20, -2)])

# %% An invalid "bow-tie" polygon: drawn in red, the problem is marked
bowtie = Polygon([(23, 3), (29, 9), (29, 3), (23, 9)])
print(explain_validity(bowtie))

# %% Buffer: change the distance and re-run this cell to see the ghost
well = Point(17.5, -0.5)
buffer_zone = well.buffer(2.5)

# %% Difference: the parcel minus the river corridor
corridor = river.buffer(1.2)
dry_land = parcel.difference(corridor)

# %% show() renders intermediate results that are not stored in a variable
show(parcel.envelope.boundary)
show(bowtie.buffer(0), label="bowtie repaired")
