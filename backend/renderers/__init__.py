"""Renderer registry: ``type → serialization function``.

Renderers run inside the kernel. Each one takes ``(obj, name)`` and returns
``{kind, name, data, meta}``; numpy arrays inside ``data`` travel as binary
buffers. A renderer may return ``None`` to decline (e.g. a list that does not
hold geometries); the next renderer registered for the same type is tried
(e.g. another kind of list), then lookup continues along the MRO and ends at ``repr``.

Types are registered by fully qualified name so that heavy libraries (GDAL,
rasterio, xarray…) are only imported once the user imports them.

Adding a type means adding a module to this package: every module here is
imported automatically.
"""

from __future__ import annotations

import importlib
import pkgutil
from typing import Any, Callable

Renderer = Callable[[Any, str], "dict[str, Any] | None"]
Fingerprint = Callable[[Any], Any]

REGISTRY: dict[str, list[Renderer]] = {}
FINGERPRINTS: dict[str, Fingerprint] = {}
SETUP_HOOKS: list[Callable[[Any], None]] = []


def qualname(cls: type) -> str:
    return f"{cls.__module__}.{cls.__qualname__}"


def register(*type_names: str, fingerprint: Fingerprint | None = None) -> Callable[[Renderer], Renderer]:
    """Register a renderer (and optionally a cheap change fingerprint) for types."""

    def decorator(fn: Renderer) -> Renderer:
        for type_name in type_names:
            REGISTRY.setdefault(type_name, []).append(fn)
            if fingerprint is not None:
                FINGERPRINTS[type_name] = fingerprint
        return fn

    return decorator


def on_setup(fn: Callable[[Any], None]) -> Callable[[Any], None]:
    """Run ``fn(session)`` when the kernel session starts (e.g. to patch a library)."""
    SETUP_HOOKS.append(fn)
    return fn


def payload(kind: str, name: str, data: dict[str, Any] | None = None, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"kind": kind, "name": name, "data": data or {}, "meta": meta or {}}


def _mro_names(obj: Any) -> list[str]:
    return [qualname(cls) for cls in type(obj).__mro__]


def render(obj: Any, name: str) -> dict[str, Any]:
    for type_name in _mro_names(obj):
        for fn in REGISTRY.get(type_name, ()):
            out = fn(obj, name)
            if out is not None:
                return out
    return fallback.render_repr(obj, name)


def fingerprint(obj: Any) -> Any:
    for type_name in _mro_names(obj):
        fn = FINGERPRINTS.get(type_name)
        if fn is not None:
            try:
                return fn(obj)
            except Exception:
                break
    return fallback.fingerprint_repr(obj)


def _load_all() -> None:
    for info in pkgutil.iter_modules(__path__):
        importlib.import_module(f"{__name__}.{info.name}")


from backend.renderers import fallback  # noqa: E402

_load_all()
