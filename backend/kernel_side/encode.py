"""Turn a renderer payload into a JSON header plus binary buffers."""

from __future__ import annotations

import math
from typing import Any

import numpy as np


def _wire_array(arr: np.ndarray) -> np.ndarray:
    kind = arr.dtype.kind
    if kind == "b":
        arr = arr.astype(np.uint8)
    elif kind == "f":
        arr = arr.astype(np.float32, copy=False)
    elif kind in "iu":
        if arr.dtype not in (np.uint8, np.uint32, np.int32):
            if arr.size and arr.min() < 0:
                arr = arr.astype(np.int32)
            else:
                arr = arr.astype(np.uint32)
    else:
        raise TypeError(f"cannot send array of dtype {arr.dtype} as binary")
    return np.ascontiguousarray(arr)


def _jsonable(value: Any) -> Any:
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, np.floating):
        v = float(value)
        return v if math.isfinite(v) else None
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.bool_):
        return bool(value)
    return value


def encode(payload: dict[str, Any]) -> tuple[dict[str, Any], list[memoryview]]:
    """Replace every ndarray in ``payload`` with ``{"$buf": i}``.

    Returns the header (payload + ``type: var`` + buffer descriptors) and the
    list of buffers in descriptor order.
    """
    buffers: list[memoryview] = []
    descriptors: list[dict[str, Any]] = []

    def walk(value: Any) -> Any:
        if isinstance(value, np.ndarray):
            arr = _wire_array(value)
            descriptors.append({"dtype": str(arr.dtype), "shape": list(arr.shape)})
            buffers.append(memoryview(arr).cast("B"))
            return {"$buf": len(buffers) - 1}
        if isinstance(value, dict):
            return {str(k): walk(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [walk(v) for v in value]
        return _jsonable(value)

    header = {"type": "var", **walk(payload)}
    header["buffers"] = descriptors
    return header, buffers
