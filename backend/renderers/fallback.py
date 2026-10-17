"""Anything without a dedicated renderer: listed with its short repr, not drawn."""

from __future__ import annotations

import hashlib
import reprlib
from typing import Any

_short = reprlib.Repr()
_short.maxstring = 160
_short.maxother = 160
_short.maxlist = 12
_short.maxtuple = 12
_short.maxdict = 8
_short.maxset = 8
_short.maxlevel = 3


def short_repr(obj: Any, limit: int = 200) -> str:
    try:
        text = _short.repr(obj)
    except Exception as exc:  # broken __repr__
        text = f"<{type(obj).__name__}: repr failed ({exc})>"
    return text if len(text) <= limit else text[: limit - 1] + "…"


def type_name(obj: Any) -> str:
    cls = type(obj)
    module = cls.__module__
    return cls.__qualname__ if module == "builtins" else f"{module.split('.')[0]}.{cls.__qualname__}"


def render_repr(obj: Any, name: str, error: str | None = None) -> dict[str, Any]:
    meta = {"type": type_name(obj), "repr": short_repr(obj)}
    if error:
        meta["render_error"] = error
    return {"kind": "repr", "name": name, "data": {}, "meta": meta}


def fingerprint_repr(obj: Any) -> str:
    return hashlib.blake2b(short_repr(obj, 4096).encode(), digest_size=12).hexdigest()
