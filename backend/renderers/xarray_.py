"""xarray: 2D DataArrays as rasters, N-D ones as cubes with sliders, Datasets.

Spatial dims are recognised by name (``y/lat/latitude…``, ``x/lon/longitude…``),
otherwise the last two dims are used. A CRS comes from rioxarray (``.rio.crs``);
plain ``lat``/``lon`` coordinates are assumed to be EPSG:4326.
"""

from __future__ import annotations

import hashlib
import math
from typing import Any

import numpy as np

from backend.renderers import payload, register
from backend.renderers.fallback import short_repr
from backend.renderers.raster import block_mean, downsample_factor, raster_payload

Y_NAMES = ("y", "lat", "latitude", "northing", "row", "rows", "rlat")
X_NAMES = ("x", "lon", "longitude", "easting", "col", "cols", "column", "rlon")
MAX_CELLS = 16_000_000  # floats sent for a cube (~64 MB)
MAX_SLICES = 512
MAX_DATASET_VARS = 8


def spatial_dims(da: Any) -> tuple[str, str] | None:
    dims = list(da.dims)
    if len(dims) < 2:
        return None
    lower = {d.lower() if isinstance(d, str) else d: d for d in dims}
    y = next((lower[n] for n in Y_NAMES if n in lower), None)
    x = next((lower[n] for n in X_NAMES if n in lower), None)
    if y is None or x is None or y == x:
        y, x = dims[-2], dims[-1]
    return y, x


def _regular_transform(da: Any, y: str, x: str):
    from affine import Affine

    if x not in da.coords or y not in da.coords:
        return None
    xs = np.asarray(da.coords[x].values, dtype=np.float64)
    ys = np.asarray(da.coords[y].values, dtype=np.float64)
    if xs.ndim != 1 or ys.ndim != 1 or len(xs) < 2 or len(ys) < 2:
        return None
    dx, dy = np.diff(xs), np.diff(ys)
    if not (np.allclose(dx, dx[0], rtol=1e-4) and np.allclose(dy, dy[0], rtol=1e-4)):
        return None
    return Affine(dx[0], 0, xs[0] - dx[0] / 2, 0, dy[0], ys[0] - dy[0] / 2)


def _crs(da: Any, y: str, x: str) -> tuple[Any, bool]:
    """CRS from rioxarray, or EPSG:4326 assumed from lat/lon coords."""
    from pyproj import CRS

    try:
        import rioxarray  # noqa: F401  registers the .rio accessor

        rio_crs = da.rio.crs
        if rio_crs is not None:
            return CRS.from_wkt(rio_crs.to_wkt()), False
    except Exception:
        pass
    if str(y).lower() in ("lat", "latitude") and str(x).lower() in ("lon", "longitude") and x in da.coords:
        lat = np.asarray(da.coords[y].values, dtype=np.float64)
        lon = np.asarray(da.coords[x].values, dtype=np.float64)
        if np.all(np.abs(lat) <= 90) and np.all(np.abs(lon) <= 360):
            return CRS.from_epsg(4326), True
    return None, False


def _label(value: Any) -> str:
    if isinstance(value, np.datetime64):
        text = np.datetime_as_string(value, unit="m")
        return text.replace("T00:00", "")
    if isinstance(value, (float, np.floating)):
        return f"{value:.6g}"
    return str(value)


def _coord_labels(da: Any, dim: str) -> list[str]:
    if dim in da.coords:
        return [_label(v) for v in da.coords[dim].values]
    return [str(i) for i in range(da.sizes[dim])]


def _summary(obj: Any) -> dict[str, Any]:
    coords = []
    for name, c in obj.coords.items():
        vals = c.values.ravel()
        preview = " ".join(_label(v) for v in vals[:3]) + (" …" if vals.size > 3 else "")
        coords.append({"name": str(name), "dims": [str(d) for d in c.dims], "dtype": str(c.dtype), "preview": preview})
    return {
        "dims": {str(k): int(v) for k, v in obj.sizes.items()},
        "coords": coords,
        "attrs": {str(k): short_repr(v, 160) for k, v in obj.attrs.items()},
    }


def dataarray_payload(da: Any, name: str) -> dict[str, Any] | None:
    if da.ndim < 2 or da.dtype.kind not in "biuf":
        return None
    y, x = spatial_dims(da)
    extra = [d for d in da.dims if d not in (y, x)]
    da = da.transpose(*extra, y, x)
    h, w = da.sizes[y], da.sizes[x]
    if min(h, w) < 2:
        return None
    sizes = [da.sizes[d] for d in extra]
    n_slices = int(np.prod(sizes)) if extra else 1

    truncated = None
    if n_slices > MAX_SLICES and extra:
        # Keep the first MAX_SLICES along the leading extra dim.
        keep = max(1, MAX_SLICES // (n_slices // sizes[0]))
        da = da.isel({extra[0]: slice(0, keep)})
        truncated = {"dim": str(extra[0]), "kept": keep, "of": sizes[0]}
        sizes[0] = keep
        n_slices = int(np.prod(sizes))

    factor = downsample_factor(h, w)
    if n_slices * h * w / factor**2 > MAX_CELLS:
        factor = max(factor, math.ceil(math.sqrt(n_slices * h * w / MAX_CELLS)))

    values = np.asarray(da.values, dtype=np.float32).reshape(n_slices, h, w)
    valid = np.isfinite(values)
    nodata = None
    try:
        import rioxarray  # noqa: F401

        nodata = da.rio.nodata
    except Exception:
        nodata = da.attrs.get("_FillValue")
    if nodata is not None and np.isfinite(nodata):
        valid &= values != np.float32(nodata)
    if factor > 1:
        values, valid = block_mean(values, valid, factor)

    transform = _regular_transform(da, y, x)
    crs, assumed = _crs(da, y, x)
    if transform is not None and factor > 1:
        from affine import Affine

        transform = transform * Affine.scale(w / values.shape[2], h / values.shape[1])

    cube = None
    if extra:
        cube = {
            "dims": [
                {
                    "name": str(d),
                    "size": s,
                    "labels": _coord_labels(da, d),
                    "is_time": np.issubdtype(da.coords[d].dtype, np.datetime64) if d in da.coords else str(d).lower() == "time",
                }
                for d, s in zip(extra, sizes)
            ],
            "truncated": truncated,
        }
    units = da.attrs.get("units")
    return raster_payload(
        name,
        values,
        valid,
        title=f"DataArray ({', '.join(str(d) for d in da.dims)})",
        dtype=str(da.dtype),
        full_shape=(*sizes, h, w),
        nodata=nodata,
        crs=crs,
        transform=transform,
        downsampled_from=[h, w] if factor > 1 else None,
        band_names=None,
        cube=cube,
        extra_meta={
            "source": "xarray",
            "var_name": str(da.name) if da.name is not None else None,
            "units": str(units) if units is not None else None,
            "long_name": da.attrs.get("long_name"),
            "spatial_dims": [str(y), str(x)],
            "crs_assumed": assumed,
            "summary": _summary(da),
        },
    )


def _fingerprint_dataarray(da: Any) -> str:
    h = hashlib.blake2b(digest_size=12)
    h.update(f"{da.name}|{da.dims}|{da.shape}|{da.dtype}|{sorted(map(str, da.coords))}|{short_repr(da.attrs, 500)}".encode())
    data = da.variable._data
    if isinstance(data, np.ndarray) and data.dtype.kind in "biuf" and data.size:
        flat = data.reshape(-1)
        step = max(1, flat.size // 16384)
        h.update(np.ascontiguousarray(flat[::step]).tobytes())
    else:
        h.update(str(id(data)).encode())
    return h.hexdigest()


@register("xarray.core.dataarray.DataArray", fingerprint=_fingerprint_dataarray)
def render_dataarray(da: Any, name: str) -> dict[str, Any] | None:
    return dataarray_payload(da, name)


def _fingerprint_dataset(ds: Any) -> str:
    parts = [_fingerprint_dataarray(ds[v]) for v in ds.data_vars]
    return hashlib.blake2b("|".join(parts + [short_repr(ds.attrs, 500)]).encode(), digest_size=12).hexdigest()


@register("xarray.core.dataset.Dataset", fingerprint=_fingerprint_dataset)
def render_dataset(ds: Any, name: str) -> dict[str, Any]:
    variables: dict[str, Any] = {}
    listing = []
    for var_name, da in ds.data_vars.items():
        child = None
        if len(variables) < MAX_DATASET_VARS:
            try:
                child = dataarray_payload(da, f"{name}.{var_name}")
            except Exception:
                child = None
        if child is not None:
            variables[str(var_name)] = {"data": child["data"], "meta": child["meta"]}
        listing.append(
            {
                "name": str(var_name),
                "dims": [str(d) for d in da.dims],
                "shape": list(da.shape),
                "dtype": str(da.dtype),
                "units": str(da.attrs["units"]) if "units" in da.attrs else None,
                "renderable": child is not None,
            }
        )
    meta = {"title": f"Dataset ({len(listing)} variables)", "summary": _summary(ds), "data_vars": listing}
    return payload("dataset", name, {"variables": variables}, meta)
