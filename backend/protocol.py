"""Binary WebSocket frame format shared by the server and the frontend decoder.

Layout of one frame::

    [u32 little-endian header length][header JSON, utf-8][zero padding to 4 bytes][buffer 0][pad][buffer 1]...

The header is the renderer payload ``{type, kind, name, data, meta}`` plus a
``buffers`` list. Each entry describes one typed array as
``{dtype, shape, offset, length}``, where ``offset`` counts from the start of the
frame and is always 4-byte aligned so the frontend can build typed-array views
without copying.
"""

from __future__ import annotations

import json
import struct
from typing import Any

ALLOWED_DTYPES = {"float32", "uint32", "int32", "uint8"}


def _pad(n: int) -> int:
    return (-n) % 4


def pack_frame(header: dict[str, Any], buffers: list[bytes | memoryview]) -> bytes:
    """Pack a header (with ``buffers`` descriptors lacking offsets) and raw buffers."""
    descriptors = header.get("buffers", [])
    if len(descriptors) != len(buffers):
        raise ValueError(f"{len(descriptors)} buffer descriptors but {len(buffers)} buffers")
    for desc in descriptors:
        if desc["dtype"] not in ALLOWED_DTYPES:
            raise ValueError(f"dtype {desc['dtype']} is not allowed on the wire")

    # Offsets depend on the header length, which depends on the offsets' digits:
    # iterate until the encoded header size stabilises (two passes in practice).
    lengths = [memoryview(b).nbytes for b in buffers]
    header_bytes = b""
    for _ in range(4):
        start = 4 + len(header_bytes) + _pad(len(header_bytes))
        offset = start
        for desc, length in zip(descriptors, lengths):
            desc["offset"] = offset
            desc["length"] = length
            offset += length + _pad(length)
        encoded = json.dumps(header, separators=(",", ":"), allow_nan=False).encode()
        if len(encoded) == len(header_bytes):
            break
        header_bytes = encoded
    header_bytes = encoded

    parts = [struct.pack("<I", len(header_bytes)), header_bytes, b"\0" * _pad(len(header_bytes))]
    for buf, length in zip(buffers, lengths):
        parts.append(bytes(buf))
        parts.append(b"\0" * _pad(length))
    return b"".join(parts)


def unpack_frame(frame: bytes) -> tuple[dict[str, Any], list[bytes]]:
    """Inverse of :func:`pack_frame`; used by tests."""
    (n,) = struct.unpack_from("<I", frame, 0)
    header = json.loads(frame[4 : 4 + n])
    buffers = [frame[d["offset"] : d["offset"] + d["length"]] for d in header.get("buffers", [])]
    return header, buffers
