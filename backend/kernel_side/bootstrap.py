"""Runs inside the IPython kernel: wires the geosandbox comm and post-run hooks."""

from __future__ import annotations

from typing import Any

from comm import create_comm

from backend.kernel_side.errors import error_line

_session: "Session | None" = None


class Session:
    def __init__(self, ip: Any) -> None:
        self.ip = ip
        self.comm = create_comm(target_name="geosandbox", data={"type": "hello"})
        ip.events.register("post_run_cell", self.post_run_cell)

    def send(self, data: dict[str, Any], buffers: list | None = None) -> None:
        self.comm.send(data=data, buffers=buffers or None)

    def post_run_cell(self, result: Any) -> None:
        line = error_line(self.ip, result)
        if line is not None:
            self.send({"type": "error_line", "line": line})

    def resync(self) -> None:
        pass


def setup(ip: Any) -> Session:
    global _session
    if _session is None:
        _session = Session(ip)
    return _session


def resync() -> None:
    if _session is not None:
        _session.resync()
