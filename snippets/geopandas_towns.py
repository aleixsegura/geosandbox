# GeoPandas — tables of geometries. With a CRS they go on the map;
# click a feature to see its attributes in the inspector.

# %% A few towns of the Segrià (lon/lat)
import geopandas as gpd
from shapely import Point

towns = gpd.GeoDataFrame(
    {
        "name": ["Lleida", "Alcarràs", "Alpicat", "Torrefarrera", "Almacelles"],
        "population": [140_000, 9_800, 6_600, 4_700, 6_900],
    },
    geometry=[Point(0.6206, 41.6176), Point(0.5245, 41.5641), Point(0.5560, 41.6680),
              Point(0.6070, 41.6740), Point(0.4400, 41.7330)],
    crs="EPSG:4326",
)

# %% Project to metres and buffer by population
towns_utm = towns.to_crs(25831)
areas = towns_utm.copy()
areas["geometry"] = towns_utm.buffer(towns_utm["population"] ** 0.5 * 12)
