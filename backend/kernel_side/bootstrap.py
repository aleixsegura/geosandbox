"""Runs inside the IPython kernel: wires the geosandbox comm and post-run hooks."""

from __future__ import annotations

import linecache
import sys
import traceback
from typing import Any

from comm import create_comm

from backend import renderers
from backend.kernel_side.diff import Snapshot, user_variables
from backend.kernel_side.encode import encode
from backend.kernel_side.errors import error_line
from backend.renderers import fallback

_session: "Session | None" = None


def _call_label(depth: int = 2) -> str | None:
    """Source text of the first argument of the ``show(...)`` call that called us."""
    try:
        frame = sys._getframe(depth)
        line = linecache.getline(frame.f_code.co_filename, frame.f_lineno)
    except Exception:
        return None
    start = line.find("show(")
    if start < 0:
        return None
    depth_, i = 0, start + len("show(")
    for j in range(i, len(line)):
        ch = line[j]
        if ch in "([{":
            depth_ += 1
        elif ch in ")]}":
            if depth_ == 0:
                return line[i:j].strip() or None
            depth_ -= 1
        elif ch == "," and depth_ == 0:
            return line[i:j].strip() or None
    return None


class Session:
    def __init__(self, ip: Any) -> None:
        self.ip = ip
        self.comm = create_comm(target_name="geosandbox", data={"type": "hello"})
        self.snapshot = Snapshot()
        self.shown: dict[str, Any] = {}
        self.deferred: list[tuple[Any, str]] = []
        self.rendering = False
        self._show_counter = 0
        ip.push({"show": self.show}, interactive=False)
        ip.events.register("post_run_cell", self.post_run_cell)
        for hook in renderers.SETUP_HOOKS:
            try:
                hook(self)
            except Exception:
                traceback.print_exc()

    # ------------------------------------------------------------------ transport
    def send(self, data: dict[str, Any], buffers: list | None = None) -> None:
        self.comm.send(data=data, buffers=buffers or None)

    def emit(self, obj: Any, name: str) -> None:
        self.rendering = True
        try:
            try:
                out = renderers.render(obj, name)
                header, buffers = encode(out)
            except Exception as exc:
                detail = "".join(traceback.format_exception_only(type(exc), exc)).strip()
                header, buffers = encode(fallback.render_repr(obj, name, error=detail))
            self.send(header, buffers)
        finally:
            self.rendering = False

    # ------------------------------------------------------------------ user API
    def show(self, obj: Any, label: str | None = None) -> Any:
        """Render ``obj`` on the canvas even if it is not stored in a variable."""
        if label is None:
            label = _call_label()
            if label is None:
                self._show_counter += 1
                label = f"show[{self._show_counter}]"
            label = label if len(label) <= 48 else label[:47] + "…"
        self.shown[label] = obj
        self.emit(obj, label)
        return obj

    def defer(self, obj: Any, label: str) -> None:
        """Render ``obj`` after the current cell finishes (used by library hooks)."""
        self.deferred.append((obj, label))

    # ------------------------------------------------------------------ hooks
    def post_run_cell(self, result: Any) -> None:
        line = error_line(self.ip, result)
        if line is not None:
            self.send({"type": "error_line", "line": line})
        self.collect()

    def collect(self) -> None:
        variables = user_variables(self.ip.user_ns, self.ip.user_ns_hidden)
        changed, removed = self.snapshot.update(variables)
        removed = [name for name in removed if name not in self.shown]
        if removed:
            self.send({"type": "remove", "names": removed})
        for name, obj in changed.items():
            self.emit(obj, name)
        deferred, self.deferred = self.deferred, []
        for obj, label in deferred:
            self.shown[label] = obj
            self.emit(obj, label)

    def resync(self) -> None:
        self.snapshot.clear()
        self.collect()
        for label, obj in self.shown.items():
            self.emit(obj, label)


def setup(ip: Any) -> Session:
    global _session
    if _session is None:
        _session = Session(ip)
    return _session


def resync() -> None:
    if _session is not None:
        _session.resync()


def session() -> Session | None:
    return _session
