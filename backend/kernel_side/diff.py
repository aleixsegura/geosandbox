"""Detect new, modified and removed variables in the user namespace."""

from __future__ import annotations

import types
from typing import Any, Iterable

from backend import renderers

SKIP_TYPES = (
    types.ModuleType,
    types.FunctionType,
    types.BuiltinFunctionType,
    types.MethodType,
    type,
)


def user_variables(ns: dict[str, Any], hidden: Iterable[str]) -> dict[str, Any]:
    hidden = set(hidden)
    out = {}
    for name, obj in ns.items():
        if name.startswith("_") or name in hidden:
            continue
        if isinstance(obj, SKIP_TYPES):
            continue
        out[name] = obj
    return out


class Snapshot:
    """Remembers ``name → (id, fingerprint)`` from the previous run."""

    def __init__(self) -> None:
        self.state: dict[str, tuple[int, Any]] = {}

    def update(self, variables: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        """Return the changed variables and the names that disappeared."""
        changed: dict[str, Any] = {}
        new_state: dict[str, tuple[int, Any]] = {}
        for name, obj in variables.items():
            key = (id(obj), renderers.fingerprint(obj))
            new_state[name] = key
            if self.state.get(name) != key:
                changed[name] = obj
        removed = [name for name in self.state if name not in new_state]
        self.state = new_state
        return changed, removed

    def clear(self) -> None:
        self.state.clear()
