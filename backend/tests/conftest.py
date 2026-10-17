from __future__ import annotations

from typing import Any

import numpy as np
import pytest

from backend import renderers
from backend.kernel_side.encode import encode
from backend.protocol import pack_frame, unpack_frame

DTYPES = {"float32": np.float32, "uint32": np.uint32, "int32": np.int32, "uint8": np.uint8}


def roundtrip(obj: Any, name: str = "obj") -> dict[str, Any]:
    """Render → encode → pack → unpack, resolving ``$buf`` refs back to arrays."""
    header, buffers = encode(renderers.render(obj, name))
    header, raw = unpack_frame(pack_frame(header, buffers))
    assert header["type"] == "var"
    assert {"kind", "name", "data", "meta"} <= header.keys()
    arrays = [
        np.frombuffer(b, dtype=DTYPES[d["dtype"]]).reshape(d["shape"])
        for b, d in zip(raw, header["buffers"])
    ]

    def resolve(value: Any) -> Any:
        if isinstance(value, dict):
            if set(value) == {"$buf"}:
                return arrays[value["$buf"]]
            return {k: resolve(v) for k, v in value.items()}
        if isinstance(value, list):
            return [resolve(v) for v in value]
        return value

    header["data"] = resolve(header["data"])
    return header


@pytest.fixture
def rt():
    return roundtrip
