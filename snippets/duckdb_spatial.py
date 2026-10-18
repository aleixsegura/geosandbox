# DuckDB spatial — SQL on geometries, in process: no server to run.
# A relation whose result has a GEOMETRY column is drawn like a GeoDataFrame;
# its SQL and column types are in the inspector. With a CRS in the column type
# (GEOMETRY('EPSG:25831'), set with ST_SetCRS) it goes on the map; without one
# on graph paper, like shapely. Relations without geometry show their rows.
# The spatial extension is downloaded once: the first run needs internet.

# %% Connect and load the spatial extension
import tempfile
from pathlib import Path

import duckdb

con = duckdb.connect()
con.install_extension("spatial")
con.load_extension("spatial")

# %% Wells: 400 random points around Lleida, in ETRS89 / UTM 31N
con.sql("SELECT setseed(0.42)")
con.sql("""
    CREATE OR REPLACE TABLE wells AS
    SELECT i AS id,
           ST_SetCRS(ST_Point(290000 + random() * 24000, 4600000 + random() * 24000), 'EPSG:25831') AS geom,
           round(5 + random() * 60, 1) AS depth_m
    FROM range(400) t(i)
""")
wells = con.sql("SELECT * FROM wells")

# %% Parcels: a 2 km grid built in SQL
con.sql("""
    CREATE OR REPLACE TABLE parcels AS
    SELECT row_number() OVER () AS parcel_id,
           ST_SetCRS(ST_MakeEnvelope(x, y, x + 2000, y + 2000), 'EPSG:25831') AS geom
    FROM range(290000, 314000, 2000) a(x), range(4600000, 4624000, 2000) b(y)
""")

# %% Spatial join: wells per parcel (select it and "Color by → wells")
per_parcel = con.sql("""
    SELECT p.parcel_id, count(w.id) AS wells, round(avg(w.depth_m), 1) AS mean_depth, p.geom
    FROM parcels p LEFT JOIN wells w ON ST_Intersects(p.geom, w.geom)
    GROUP BY p.parcel_id, p.geom
""")

# %% Distance queries: wells within 1 km of the river, and a plain table
# DuckDB can query Python variables by name: `river` and `near_river` are the relations above.
river = con.sql("""
    SELECT ST_SetCRS(ST_GeomFromText(
        'LINESTRING (290000 4606000, 297000 4609500, 302600 4611000, 308000 4615500, 314000 4617000)'),
        'EPSG:25831') AS geom
""")
near_river = con.sql("""
    SELECT w.* FROM wells w, river r WHERE ST_DWithin(w.geom, r.geom, 1000)
""")
summary = con.sql("""
    SELECT count(*) AS wells, round(avg(depth_m), 1) AS mean_depth,
           count(*) FILTER (WHERE id IN (SELECT id FROM near_river)) AS near_river
    FROM wells
""")

# %% The axis-order trap: by authority, EPSG:4326 is (lat, lon)
print(con.sql("SELECT ST_AsText(ST_Transform(geom, 'EPSG:4326')) AS authority FROM wells LIMIT 1").fetchone())
print(con.sql("SELECT ST_AsText(ST_Transform(geom, 'EPSG:4326', always_xy := true)) AS lon_lat FROM wells LIMIT 1").fetchone())
wells_wgs84 = con.sql("SELECT id, ST_Transform(geom, 'EPSG:4326', always_xy := true) AS geom FROM wells")

# %% GeoParquet round trip: COPY writes the "geo" metadata, read_parquet brings the CRS back
parcels_file = Path(tempfile.mkdtemp(prefix="geo-sandbox-"), "per_parcel.parquet")
con.sql(f"COPY ({per_parcel.sql_query()}) TO '{parcels_file}' (FORMAT parquet)")
from_parquet = con.sql(f"SELECT * FROM read_parquet('{parcels_file}') WHERE wells >= 3")
