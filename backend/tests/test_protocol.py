import numpy as np
import pytest

from backend.kernel_side.encode import encode
from backend.protocol import pack_frame, unpack_frame


def test_frame_roundtrip_is_aligned():
    a = np.arange(5, dtype=np.float64)  # cast to float32 on the wire
    b = np.array([True, False, True])
    header, buffers = encode({"kind": "x", "name": "n", "data": {"a": a, "nested": [b]}, "meta": {"v": np.int64(3)}})
    assert header["data"] == {"a": {"$buf": 0}, "nested": [{"$buf": 1}]}
    frame = pack_frame(header, buffers)
    out, raw = unpack_frame(frame)
    assert out["meta"] == {"v": 3}
    assert [d["dtype"] for d in out["buffers"]] == ["float32", "uint8"]
    for d in out["buffers"]:
        assert d["offset"] % 4 == 0
    np.testing.assert_array_equal(np.frombuffer(raw[0], np.float32), a)
    np.testing.assert_array_equal(np.frombuffer(raw[1], np.uint8), [1, 0, 1])


def test_non_finite_meta_becomes_null():
    header, _ = encode({"kind": "x", "name": "n", "data": {}, "meta": {"a": float("nan"), "b": np.float32("inf")}})
    assert header["meta"] == {"a": None, "b": None}


def test_rejects_object_arrays():
    with pytest.raises(TypeError):
        encode({"kind": "x", "name": "n", "data": {"a": np.array(["s"], dtype=object)}, "meta": {}})
