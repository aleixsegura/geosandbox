# Pyproj — coordinate reference systems and transformations.
# CRS objects become cards (their area of use is drawn on the map);
# every Transformer.transform() call is plotted: source and target
# points should coincide when the transformation is right.

# %% Two CRS: geographic WGS 84 and projected ETRS89 / UTM 31N
from pyproj import CRS, Transformer

wgs84 = CRS.from_epsg(4326)
utm31 = CRS.from_epsg(25831)
print(wgs84.axis_info)

# %% A transformer from lon/lat to UTM (always_xy keeps x=lon, y=lat)
to_utm = Transformer.from_crs(wgs84, utm31, always_xy=True)

# Some places around Lleida (lon, lat)
lons = [0.6206, 0.6331, 0.5940, 0.6540]
lats = [41.6176, 41.6145, 41.6300, 41.6020]
easting, northing = to_utm.transform(lons, lats)
for e, n in zip(easting, northing):
    print(f"{e:12.2f} {n:12.2f}")

# %% The classic mistake: authority axis order is (lat, lon) for EPSG:4326
strict = Transformer.from_crs(4326, 25831)  # always_xy=False
wrong_e, wrong_n = strict.transform(lons, lats)  # lon/lat passed as lat/lon!
right_e, right_n = strict.transform(lats, lons)
print(wrong_e[0], right_e[0])
