# GDAL / OGR — the classic osgeo bindings.
# A gdal.Dataset with a geotransform and projection goes on the map;
# ogr geometries with a spatial reference too.

# %% A raster in GDAL's in-memory driver
import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()
srs = osr.SpatialReference()
srs.ImportFromEPSG(25831)

ds = gdal.GetDriverByName("MEM").Create("", 200, 150, 1, gdal.GDT_Float32)
ds.SetGeoTransform((296_000, 60, 0, 4_621_000, 0, -60))  # origin x, pixel w, 0, origin y, 0, -pixel h
ds.SetProjection(srs.ExportToWkt())
_cols, _rows = np.meshgrid(np.arange(200), np.arange(150))
band = ds.GetRasterBand(1)
band.WriteArray((np.hypot(_cols - 100, _rows - 75) * 2).astype("float32"))
band.SetNoDataValue(-1)
print(gdal.Info(ds).splitlines()[:6])

# %% OGR geometries with a spatial reference
seu_vella = ogr.CreateGeometryFromWkt("POINT (302180 4611450)")  # La Seu Vella
seu_vella.AssignSpatialReference(srs)
walk = seu_vella.Buffer(800, 24)

# %% Geometry operations work the same way as in shapely
river = ogr.CreateGeometryFromWkt(
    "LINESTRING (299000 4609000, 301000 4610600, 302600 4611000, 304500 4613500)", srs
)
river_zone = river.Buffer(250)
walk_dry = walk.Difference(river_zone)
print(walk_dry.GetArea())
