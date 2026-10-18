"""Files on disk: a ``pathlib.Path`` is opened and drawn with its file structure.

Vector files (GeoJSON, KML, GeoPackage, FlatGeobuf, Shapefile, GeoParquet…)
are read with pyogrio and drawn like a GeoDataFrame; raster files (GeoTIFF,
COG…) are opened with rasterio and drawn like a dataset; multidimensional
ones (NetCDF, Zarr) are opened with xarray and drawn like an xarray Dataset.
Either way ``meta.file`` describes the container itself: driver, size on disk,
layers and schema, sidecar files, Parquet row groups and GeoParquet metadata,
whether a GeoTIFF is a valid Cloud Optimized GeoTIFF, or the NetCDF/Zarr
format with each variable's chunks and codecs.

The fingerprint includes the modification time, so rewriting the file and
re-running the cell redraws it even though the ``Path`` did not change.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.renderers import register

MAX_FILE_FEATURES = 20_000
MAX_LAYERS = 20
MAX_ROW_GROUPS = 64
TIFF_SUFFIXES = (".tif", ".tiff", ".gtiff")
FOLDER_FORMATS = (".gdb", ".zarr")  # Esri File Geodatabase, Zarr store
NETCDF_SUFFIXES = (".nc", ".nc4", ".cdf", ".netcdf")
SHAPEFILE_SIDECARS = (".shx", ".dbf", ".prj", ".cpg", ".qix", ".sbn", ".sbx")
APPENDED_SIDECARS = (".aux.xml", ".ovr", ".msk", "-wal", "-shm")  # GDAL PAM, external overviews, SQLite journal


def _fingerprint(path: Path) -> str:
    try:
        st = path.stat()
    except OSError:
        return f"{path}|missing"
    return f"{path}|{st.st_mtime_ns}|{st.st_size}"


def _size(path: Path) -> int:
    if path.is_dir():
        return sum(p.stat().st_size for p in path.rglob("*") if p.is_file())
    return path.stat().st_size


def _sidecars(path: Path) -> list[dict[str, Any]]:
    """Other files that belong to this one (a Shapefile is .shp + .shx + .dbf + .prj…)."""
    if not path.is_file():
        return []
    candidates = [path.with_name(path.name + s) for s in APPENDED_SIDECARS]
    if path.suffix.lower() == ".shp":
        candidates += [path.with_suffix(s) for s in SHAPEFILE_SIDECARS]
    return [{"name": p.name, "size": p.stat().st_size} for p in candidates if p.is_file()]


def _file_meta(path: Path, kind: str, driver: str | None) -> dict[str, Any]:
    return {
        "path": str(path),
        "name": path.name,
        "kind": kind,
        "driver": driver,
        "size": _size(path),
        "sidecars": _sidecars(path),
    }


# ---------------------------------------------------------------------------- vector
def _layers(path: Path) -> list[list[str]] | None:
    import pyogrio

    try:
        layers = pyogrio.list_layers(path)
    except Exception:
        return None
    return [[str(name), str(geom)] for name, geom in layers] or None


def _parquet_meta(path: Path) -> dict[str, Any] | None:
    try:
        import pyarrow.parquet as pq
    except ImportError:
        return None
    md = pq.ParquetFile(path).metadata
    geo = json.loads((md.metadata or {}).get(b"geo", b"null") or "null")
    groups = []
    for i in range(min(md.num_row_groups, MAX_ROW_GROUPS)):
        rg = md.row_group(i)
        groups.append({"rows": rg.num_rows, "bytes": rg.total_byte_size})
    columns = []
    if md.num_row_groups:
        rg = md.row_group(0)
        for j in range(rg.num_columns):
            col = rg.column(j)
            columns.append(
                {"name": col.path_in_schema, "type": str(col.physical_type), "compression": str(col.compression)}
            )
    geo_summary = None
    if geo:
        primary = geo.get("primary_column")
        spec = geo.get("columns", {}).get(primary, {})
        crs = spec.get("crs")
        geo_summary = {
            "version": geo.get("version"),
            "primary_column": primary,
            "encoding": spec.get("encoding"),
            "geometry_types": spec.get("geometry_types"),
            "bbox": spec.get("bbox"),
            "covering": spec.get("covering"),
            "crs": (crs.get("name") if isinstance(crs, dict) else crs) if "crs" in spec else "OGC:CRS84 (default)",
        }
    return {
        "num_rows": md.num_rows,
        "num_row_groups": md.num_row_groups,
        "row_groups": groups,
        "columns": columns,
        "created_by": md.created_by,
        "geo": geo_summary,
    }


def render_vector_file(path: Path, layers: list[list[str]], name: str) -> dict[str, Any]:
    import geopandas as gpd
    import pyogrio

    from backend.renderers.geopandas_ import render_geodataframe

    layer = layers[0][0]
    info = pyogrio.read_info(path, layer=layer)
    df = gpd.read_file(path, layer=layer, max_features=MAX_FILE_FEATURES, engine="pyogrio")
    out = render_geodataframe(df, name)
    meta = _file_meta(path, "vector", info.get("driver"))
    layer_rows = []
    for lname, geom in layers[:MAX_LAYERS]:
        try:
            count = pyogrio.read_info(path, layer=lname).get("features")
        except Exception:
            count = None
        layer_rows.append({"name": lname, "geometry_type": geom, "features": count})
    meta.update(
        {
            "layers": layer_rows,
            "hidden_layers": max(0, len(layers) - MAX_LAYERS),
            "layer": layer,
            "features": info.get("features"),
            "features_shown": len(df),
            "fields": [
                {"name": str(f), "dtype": str(d), "ogr_type": str(o)}
                for f, d, o in zip(info["fields"], info["dtypes"], info.get("ogr_types", [""] * len(info["fields"])))
            ],
            "geometry_type": info.get("geometry_type"),
            "geometry_name": info.get("geometry_name") or None,
            "fid_column": info.get("fid_column") or None,
            "encoding": info.get("encoding"),
            "crs": info.get("crs"),
            "capabilities": info.get("capabilities"),
        }
    )
    if path.suffix.lower() in (".parquet", ".geoparquet"):
        meta["parquet"] = _parquet_meta(path)
    out["meta"]["file"] = meta
    out["meta"]["title"] = f"{path.name} · {meta['driver']}"
    return out


# ---------------------------------------------------------------------------- raster
def _cog_check(path: Path) -> dict[str, Any] | None:
    if path.suffix.lower() not in TIFF_SUFFIXES:
        return None
    try:
        from osgeo import gdal
        from osgeo_utils.samples import validate_cloud_optimized_geotiff as cog

        with gdal.ExceptionMgr(useExceptions=True):
            warnings, errors, details = cog.validate(str(path), full_check=True)
    except Exception as exc:
        return {"valid": False, "errors": [str(exc)], "warnings": []}
    return {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        # Byte offset of each image's directory (IFD): a COG keeps them all in the header.
        "ifd_offsets": (details or {}).get("ifd_offsets"),
        "data_offsets": (details or {}).get("data_offsets"),
    }


def render_raster_file(path: Path, name: str) -> dict[str, Any] | None:
    import rasterio

    from backend.renderers.raster import render_rasterio

    try:
        ds = rasterio.open(path)
    except Exception:
        return None
    with ds:
        out = render_rasterio(ds, name)
        if out is None:
            return None
        meta = _file_meta(path, "raster", ds.driver)
        meta["cog"] = _cog_check(path)
        meta["profile"] = {k: str(v) for k, v in ds.profile.items() if k not in ("crs", "transform")}
    out["meta"]["file"] = meta
    out["meta"]["title"] = f"{path.name} · {ds.driver}"
    return out


# ---------------------------------------------------------------------------- multidimensional
def _netcdf_meta(path: Path) -> dict[str, Any]:
    import netCDF4

    with netCDF4.Dataset(path) as nc:
        return {
            "format": nc.data_model,
            "groups": list(nc.groups),
            "unlimited_dims": [name for name, dim in nc.dimensions.items() if dim.isunlimited()],
        }


def _zarr_meta(path: Path) -> dict[str, Any]:
    import zarr

    group = zarr.open_group(path, mode="r")
    return {
        "format": f"Zarr v{group.metadata.zarr_format}",
        "groups": [name for name, _ in group.groups()],
        "consolidated": (path / "zarr.json").is_file() and "consolidated_metadata" in (path / "zarr.json").read_text()
        or (path / ".zmetadata").is_file(),
        "objects": sum(1 for p in path.rglob("*") if p.is_file()),
        "stored_chunks": {name: int(arr.nchunks_initialized) for name, arr in group.arrays()},
    }


def render_multidim_file(path: Path, name: str) -> dict[str, Any] | None:
    import xarray as xr

    from backend.renderers.xarray_ import compression, render_dataset

    is_zarr = path.suffix.lower() == ".zarr"
    try:
        ds = xr.open_dataset(path, engine="zarr" if is_zarr else "netcdf4")
    except Exception:
        return None
    with ds:
        out = render_dataset(ds, name)
        variables = []
        for var_name, da in ds.data_vars.items():
            enc = da.encoding
            chunks = enc.get("preferred_chunks")
            variables.append(
                {
                    "name": str(var_name),
                    "dims": [str(d) for d in da.dims],
                    "shape": list(da.shape),
                    "disk_dtype": str(enc["dtype"]) if "dtype" in enc else None,
                    "dtype": str(da.dtype),
                    "chunks": [int(chunks[d]) for d in da.dims] if chunks else None,
                    "compression": compression(enc),
                    "packed": "scale_factor" in enc or "add_offset" in enc,
                }
            )
    meta = _file_meta(path, "multidim", "Zarr" if is_zarr else "netCDF")
    meta.update(_zarr_meta(path) if is_zarr else _netcdf_meta(path))
    meta["variables"] = variables
    out["meta"]["file"] = meta
    out["meta"]["title"] = f"{path.name} · {meta['format']}"
    return out


@register("pathlib.Path", "pathlib._local.Path", fingerprint=_fingerprint)
def render_path(path: Path, name: str) -> dict[str, Any] | None:
    # Folders are only datasets in a few formats; GDAL would read any folder of Shapefiles as one.
    if not path.exists() or (path.is_dir() and path.suffix.lower() not in FOLDER_FORMATS):
        return None
    if path.suffix.lower() in (*NETCDF_SUFFIXES, ".zarr"):
        return render_multidim_file(path, name)
    layers = _layers(path)
    if layers:
        return render_vector_file(path, layers, name)
    if path.is_file():
        return render_raster_file(path, name)
    return None
