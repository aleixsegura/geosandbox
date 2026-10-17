"""Rasters: 2D/3D numpy arrays, rasterio datasets and ``gdal.Dataset``.

The payload carries raw Float32 values plus a Uint8 validity mask. Colormap and
stretch are applied on the GPU, so the frontend can change them without
re-running code. Rasters larger than ``MAX_SIDE`` are downsampled here.

Georeferenced rasters are warped (nearest neighbour, values preserved) to
EPSG:3857 so they sit exactly on the web map; everything else is drawn in
pixel space on the graph-paper canvas.
"""

from __future__ import annotations

import hashlib
import math
import warnings
from typing import Any

import numpy as np

from backend.renderers import payload, register
from backend.renderers.geometry import crs_summary, render_geometry_array

MAX_SIDE = 2048
MAX_BANDS = 64
HIST_BINS = 64
STATS_SAMPLE = 1_000_000
WARP_CELLS = 16_000_000  # floats in a warped multi-band/cube grid


# ---------------------------------------------------------------------------- core
def block_mean(values: np.ndarray, valid: np.ndarray, factor: int) -> tuple[np.ndarray, np.ndarray]:
    """Downsample ``[b,h,w]`` by ``factor`` averaging only valid pixels."""
    b, h, w = values.shape
    oh, ow = math.ceil(h / factor), math.ceil(w / factor)
    v = np.zeros((b, oh * factor, ow * factor), np.float64)
    m = np.zeros((b, oh * factor, ow * factor), bool)
    v[:, :h, :w] = np.where(valid, values, 0)
    m[:, :h, :w] = valid
    v = v.reshape(b, oh, factor, ow, factor)
    m = m.reshape(b, oh, factor, ow, factor)
    count = m.sum(axis=(2, 4))
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = v.sum(axis=(2, 4)) / count
    return mean.astype(np.float32), count > 0


def _sample(v: np.ndarray) -> np.ndarray:
    if v.size <= STATS_SAMPLE:
        return v
    return v[:: v.size // STATS_SAMPLE + 1]


def band_stats(values: np.ndarray, valid: np.ndarray) -> tuple[dict[str, Any] | None, np.ndarray]:
    v = values[valid]
    if v.size == 0:
        return None, np.zeros(HIST_BINS, np.float32)
    v = v.astype(np.float64, copy=False)
    lo, hi = float(v.min()), float(v.max())
    s = _sample(v)
    p2, p98 = np.percentile(s, [2, 98])
    hist, _ = np.histogram(s, bins=HIST_BINS, range=(lo, hi if hi > lo else lo + 1))
    stats = {
        "min": lo,
        "max": hi,
        "mean": float(v.mean()),
        "std": float(v.std()),
        "p2": float(p2),
        "p98": float(p98),
        "count": int(v.size),
    }
    return stats, hist.astype(np.float32)


def _rio_crs(crs: Any):
    from rasterio.crs import CRS as RioCRS

    return RioCRS.from_wkt(crs.to_wkt())


def warp_to_3857(values: np.ndarray, valid: np.ndarray, transform: Any, crs: Any) -> dict[str, Any]:
    """Nearest-neighbour warp of ``[b,h,w]`` to Web Mercator, capped at MAX_SIDE."""
    from affine import Affine
    from rasterio.transform import array_bounds
    from rasterio.warp import Resampling, calculate_default_transform, reproject

    b, h, w = values.shape
    src_crs = _rio_crs(crs)
    left, bottom, right, top = _bounds(h, w, transform)
    dst_transform, dw, dh = calculate_default_transform(src_crs, "EPSG:3857", w, h, left, bottom, right, top)
    # Small grids are warped at a finer resolution so rotated edges do not stair-step;
    # values are still nearest-neighbour copies of source pixels.
    side = max(dw, dh)
    upsampled = min(side * 4, 1024 if b <= 4 else 384)
    goal = min(max(side, upsampled), MAX_SIDE, int(math.sqrt(WARP_CELLS / b)))
    scale = side / goal
    if scale != 1:
        dw, dh = max(1, math.ceil(dw / scale)), max(1, math.ceil(dh / scale))
        dst_transform = dst_transform * Affine.scale(scale)
    src = np.where(valid, values, np.nan).astype(np.float32)
    dst = np.full((b, dh, dw), np.nan, np.float32)
    reproject(
        src,
        dst,
        src_transform=transform,
        src_crs=src_crs,
        src_nodata=np.nan,
        dst_transform=dst_transform,
        dst_crs="EPSG:3857",
        dst_nodata=np.nan,
        resampling=Resampling.nearest,
    )
    return {"values": dst, "valid": ~np.isnan(dst), "bounds": list(array_bounds(dh, dw, dst_transform))}


def _bounds(h: int, w: int, transform: Any) -> tuple[float, float, float, float]:
    from rasterio.transform import array_bounds

    return array_bounds(h, w, transform)


def _matrix(transform: Any) -> list[list[float]] | None:
    if transform is None:
        return None
    t = transform
    return [[t.a, t.b, t.c], [t.d, t.e, t.f], [0.0, 0.0, 1.0]]


def _compact_mask(valid: np.ndarray) -> np.ndarray:
    """One mask for all slices when they agree, otherwise one per slice."""
    if valid.shape[0] == 1 or (valid == valid[:1]).all():
        return valid[:1].astype(np.uint8)
    return valid.astype(np.uint8)


def raster_payload(
    name: str,
    values: np.ndarray,
    valid: np.ndarray | None,
    *,
    title: str,
    dtype: str,
    full_shape: tuple[int, ...],
    nodata: Any = None,
    crs: Any = None,
    transform: Any = None,
    downsampled_from: list[int] | None = None,
    band_names: list[str] | None = None,
    cube: dict[str, Any] | None = None,
    extra_meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build a raster payload from ``values[b,h,w]`` (any float) and ``valid[b,h,w]``."""
    values = np.asarray(values, dtype=np.float32)
    if values.ndim == 2:
        values = values[None]
    finite = np.isfinite(values)
    valid = finite if valid is None else (np.broadcast_to(valid, values.shape) & finite)
    values = np.where(valid, values, 0).astype(np.float32)
    b, h, w = values.shape

    # Stats: per band (skipped for long cubes), plus global for a stable stretch.
    bands = []
    hists = []
    if b <= 32:
        for i in range(b):
            stats, hist = band_stats(values[i], valid[i])
            bands.append(stats)
            hists.append(hist)
    global_stats, global_hist = band_stats(values, valid)

    georef = crs is not None and transform is not None
    display: dict[str, Any]
    shown_values, shown_valid = values, valid
    warp_error = None
    if georef:
        try:
            warped = warp_to_3857(values, valid, transform, crs)
            shown_values = np.where(warped["valid"], warped["values"], 0).astype(np.float32)
            shown_valid = warped["valid"]
            display = {"mode": "map", "bounds3857": warped["bounds"]}
        except Exception as exc:  # unsupported CRS etc.: fall back to pixel space
            warp_error = str(exc)
            georef = False
    if not georef:
        display = {"mode": "pixel"}
    display["width"] = int(shown_values.shape[2])
    display["height"] = int(shown_values.shape[1])

    src_h, src_w = full_shape[-2], full_shape[-1]
    grid_transform = transform
    if transform is not None and (src_w != w or src_h != h):
        from affine import Affine

        # ``transform`` describes the (possibly downsampled) grid; report the original one.
        transform = transform * Affine.scale(w / src_w, h / src_h)
    meta = {
        "title": title,
        "shape": list(full_shape),
        "dtype": dtype,
        "nodata": nodata if not isinstance(nodata, float) or math.isfinite(nodata) else str(nodata),
        "crs": crs_summary(crs),
        "crs_wkt": crs.to_wkt(pretty=True) if crs is not None else None,
        "transform": _matrix(transform),
        "res": [abs(transform.a), abs(transform.e)] if transform is not None else None,
        "bounds": list(_bounds(src_h, src_w, transform)) if transform is not None else None,
        "pixel_size": [w and src_w / w, h and src_h / h],
        "downsampled_from": downsampled_from,
        "band_names": (band_names or [f"band {i + 1}" for i in range(b)]) if cube is None else None,
        "stats": bands,
        "stats_global": global_stats,
        "grid_transform": _matrix(grid_transform),
        "display": display,
        "cube": cube,
        "warp_error": warp_error,
    }
    if extra_meta:
        meta.update(extra_meta)

    data = {
        "values": shown_values,
        "mask": _compact_mask(shown_valid),
        "histograms": np.stack(hists) if hists else np.zeros((0, HIST_BINS), np.float32),
        "histogram_global": global_hist,
    }
    return payload("raster", name, data, meta)


def downsample_factor(h: int, w: int) -> int:
    return max(1, math.ceil(max(h, w) / MAX_SIDE))


# ---------------------------------------------------------------------------- numpy
def _hash_array(a: np.ndarray) -> str:
    h = hashlib.blake2b(digest_size=12)
    h.update(f"{a.shape}{a.dtype}".encode())
    if a.dtype.kind in "biuf" and a.size:
        flat = a.reshape(-1)
        step = max(1, flat.size // 16384)
        h.update(np.ascontiguousarray(flat[::step]).tobytes())
        h.update(np.ascontiguousarray(flat[-step:]).tobytes())
    return h.hexdigest()


def _fingerprint_ndarray(a: np.ndarray) -> str:
    if a.dtype == object:
        from backend.renderers.geometry import _fingerprint_many

        return _fingerprint_many(a)
    return _hash_array(a)


def array_to_bands(a: np.ndarray) -> tuple[np.ndarray, str] | None:
    """Arrange a 2D/3D array as ``[bands,h,w]``; ``None`` if it is not raster-like."""
    if a.dtype.kind not in "biuf":
        return None
    if a.ndim == 2 and min(a.shape) >= 3:
        return a[None], "2D array"
    if a.ndim == 3 and a.shape[2] <= 4 < a.shape[0] and min(a.shape[:2]) >= 3:
        return np.moveaxis(a, -1, 0), f"{a.shape[2]}-channel image (h, w, c)"
    if a.ndim == 3 and min(a.shape[1:]) >= 3 and a.shape[0] <= MAX_BANDS:
        return a, f"{a.shape[0]}-band array"
    return None


@register("numpy.ndarray", fingerprint=_fingerprint_ndarray)
def render_ndarray(a: np.ndarray, name: str) -> dict[str, Any] | None:
    if a.dtype == object:
        return render_geometry_array(a, name)
    arranged = array_to_bands(a)
    if arranged is None:
        return None
    bands, title = arranged
    valid = ~np.ma.getmaskarray(bands) if isinstance(bands, np.ma.MaskedArray) else None
    values = np.ma.getdata(bands).astype(np.float32)
    if valid is None:
        valid = np.isfinite(values)
    b, h, w = values.shape
    factor = downsample_factor(h, w)
    if factor > 1:
        values, valid = block_mean(values, valid, factor)
    return raster_payload(
        name,
        values,
        valid,
        title=title,
        dtype=str(a.dtype),
        full_shape=tuple(a.shape) if a.ndim == 2 else (b, h, w),
        downsampled_from=[h, w] if factor > 1 else None,
        nodata="masked" if isinstance(a, np.ma.MaskedArray) else None,
        extra_meta={"source": "numpy"},
    )


# ---------------------------------------------------------------------------- rasterio
def _fingerprint_rasterio(ds: Any) -> str:
    parts = [str(id(ds)), str(getattr(ds, "name", "")), str(ds.mode), str(ds.closed)]
    if not ds.closed and ds.mode != "w":
        try:
            parts.append(_hash_array(ds.read(1, out_shape=(32, 32))))
            parts.append(str(ds.transform) + str(ds.crs))
        except Exception:
            pass
    return "|".join(parts)


@register("rasterio._base.DatasetBase", fingerprint=_fingerprint_rasterio)
def render_rasterio(ds: Any, name: str) -> dict[str, Any] | None:
    from affine import Affine
    from pyproj import CRS
    from rasterio.enums import Resampling

    if ds.closed:
        return None
    h, w, count = ds.height, ds.width, ds.count
    n = min(count, MAX_BANDS)
    factor = downsample_factor(h, w)
    oh, ow = math.ceil(h / factor), math.ceil(w / factor)
    arr = ds.read(
        list(range(1, n + 1)),
        out_shape=(n, oh, ow),
        resampling=Resampling.average if factor > 1 else Resampling.nearest,
        masked=True,
    )
    transform = ds.transform
    if factor > 1:
        transform = transform * Affine.scale(w / ow, h / oh)
    has_georef = not transform.is_identity or ds.crs is not None
    crs = CRS.from_wkt(ds.crs.to_wkt()) if ds.crs else None
    return raster_payload(
        name,
        np.ma.getdata(arr),
        ~np.ma.getmaskarray(arr),
        title=f"rasterio {type(ds).__name__}",
        dtype=ds.dtypes[0],
        full_shape=(count, h, w),
        nodata=ds.nodata,
        crs=crs,
        transform=transform if has_georef else None,
        downsampled_from=[h, w] if factor > 1 else None,
        band_names=[d or f"band {i + 1}" for i, d in enumerate(ds.descriptions[:n])],
        extra_meta={
            "source": "rasterio",
            "path": ds.name,
            "driver": ds.driver,
            "bands_shown": n,
        },
    )


# ---------------------------------------------------------------------------- GDAL
def _fingerprint_gdal(ds: Any) -> str:
    parts = [str(id(ds)), str(ds.RasterXSize), str(ds.RasterYSize), str(ds.RasterCount), str(ds.GetGeoTransform())]
    try:
        parts.append(_hash_array(ds.ReadAsArray(buf_xsize=32, buf_ysize=32)))
    except Exception:
        pass
    return "|".join(parts)


@register("osgeo.gdal.Dataset", fingerprint=_fingerprint_gdal)
def render_gdal(ds: Any, name: str) -> dict[str, Any] | None:
    from affine import Affine
    from osgeo import gdal
    from pyproj import CRS

    h, w, count = ds.RasterYSize, ds.RasterXSize, ds.RasterCount
    if count == 0:
        return None
    n = min(count, MAX_BANDS)
    factor = downsample_factor(h, w)
    oh, ow = math.ceil(h / factor), math.ceil(w / factor)
    bands, valids, nodatas = [], [], []
    for i in range(1, n + 1):
        band = ds.GetRasterBand(i)
        arr = band.ReadAsArray(
            buf_xsize=ow, buf_ysize=oh, resample_alg=gdal.GRIORA_Average if factor > 1 else gdal.GRIORA_NearestNeighbour
        ).astype(np.float32)
        nd = band.GetNoDataValue()
        nodatas.append(nd)
        valid = np.isfinite(arr) if nd is None else (arr != np.float32(nd)) & np.isfinite(arr)
        bands.append(arr)
        valids.append(valid)
    gt = ds.GetGeoTransform(can_return_null=True)
    wkt = ds.GetProjection()
    crs = CRS.from_wkt(wkt) if wkt else None
    transform = Affine.from_gdal(*gt) if gt else None
    if transform is not None and factor > 1:
        transform = transform * Affine.scale(w / ow, h / oh)
    if transform is not None and transform.is_identity and crs is None:
        transform = None
    dtype = gdal.GetDataTypeName(ds.GetRasterBand(1).DataType)
    return raster_payload(
        name,
        np.stack(bands),
        np.stack(valids),
        title="gdal.Dataset",
        dtype=dtype,
        full_shape=(count, h, w),
        nodata=nodatas[0],
        crs=crs,
        transform=transform,
        downsampled_from=[h, w] if factor > 1 else None,
        band_names=[ds.GetRasterBand(i).GetDescription() or f"band {i}" for i in range(1, n + 1)],
        extra_meta={
            "source": "gdal",
            "path": ds.GetDescription(),
            "driver": ds.GetDriver().ShortName if ds.GetDriver() else None,
            "geotransform": list(gt) if gt else None,
            "bands_shown": n,
        },
    )


warnings.filterwarnings("ignore", message="Mean of empty slice")
