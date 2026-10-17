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
river = LineString([(-4, 10), (2, 12), (8, 10.5), (14, 13), (18, 11)])
wells = MultiPoint([(15, 2), (17, 4), (16, 6.5)])

# %% An invalid "bow-tie" polygon: drawn in red, the problem is marked
bowtie = Polygon([(20, 0), (26, 6), (26, 0), (20, 6)])
print(explain_validity(bowtie))

# %% Buffer: change the distance and re-run this cell to see the ghost
well = Point(16, 4)
buffer_zone = well.buffer(2.5)

# %% Difference: the parcel minus the river corridor
corridor = river.buffer(1.2)
dry_land = parcel.difference(corridor)

# %% show() renders intermediate results that are not stored in a variable
show(parcel.envelope.boundary)
show(bowtie.buffer(0), label="bowtie repaired")
