"""Persistent IPython kernel bridged to WebSocket clients.

The server never touches user objects: renderers run inside the kernel and send
their payloads back over the ``geosandbox`` comm, binary buffers included. This
module turns kernel messages into JSON control messages or binary frames and
hands them to a ``sink`` (the WebSocket broadcaster).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
from pathlib import Path
from typing import Any, Awaitable, Callable

from jupyter_client.manager import AsyncKernelManager

from backend.protocol import pack_frame

log = logging.getLogger("geosandbox.kernel")

ROOT = Path(__file__).resolve().parent.parent
ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[A-Za-z]")
BOOTSTRAP = "import backend.kernel_side.bootstrap as _gs_bootstrap\n_gs_bootstrap.setup(get_ipython())"

Message = dict[str, Any] | bytes
Sink = Callable[[Message], Awaitable[None]]


def strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text)


class KernelSession:
    def __init__(self, sink: Sink) -> None:
        self._sink = sink
        self.km: AsyncKernelManager | None = None
        self.kc: Any = None
        self._tasks: list[asyncio.Task] = []
        self._offsets: dict[str, int] = {}
        self._replies: dict[str, asyncio.Future] = {}
        self._restarting = False
        # Requests sent to the current kernel, and to the one before the last restart:
        # iopub output of the old kernel can still be in flight after a restart.
        self._sent: set[str] = set()
        self._stale: set[str] = set()

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        env = os.environ.copy()
        env["PYTHONPATH"] = os.pathsep.join(p for p in (str(ROOT), env.get("PYTHONPATH")) if p)
        env["MPLBACKEND"] = "Agg"
        self.km = AsyncKernelManager(kernel_name="python3")
        await self.km.start_kernel(env=env, cwd=str(ROOT))
        self.kc = self.km.client()
        self.kc.start_channels()
        await self.kc.wait_for_ready(timeout=60)
        self._tasks = [
            asyncio.create_task(self._pump_iopub()),
            asyncio.create_task(self._pump_shell()),
            asyncio.create_task(self._watch()),
        ]
        await self._bootstrap()

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        if self.kc is not None:
            self.kc.stop_channels()
        if self.km is not None:
            with contextlib.suppress(Exception):
                await self.km.shutdown_kernel(now=True)

    async def restart(self) -> None:
        assert self.km is not None
        self._restarting = True
        try:
            for fut in self._replies.values():
                if not fut.done():
                    fut.cancel()
            self._replies.clear()
            self._offsets.clear()
            self._stale, self._sent = self._sent, set()
            await self.km.restart_kernel(now=True)
            await self._wait_ready()
            await self._bootstrap()
        finally:
            self._restarting = False
        await self._sink({"type": "restarted"})

    async def interrupt(self) -> None:
        assert self.km is not None
        await self.km.interrupt_kernel()

    async def _wait_ready(self, timeout: float = 60) -> None:
        # kc.wait_for_ready() would read the shell channel concurrently with
        # _pump_shell, so poll kernel_info through the pump instead.
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while True:
            try:
                await self._request(self.kc.kernel_info(), timeout=2)
                return
            except asyncio.TimeoutError:
                if loop.time() > deadline:
                    raise

    async def _bootstrap(self) -> None:
        reply = await self._request(self.kc.execute(BOOTSTRAP, silent=True, store_history=False))
        if reply["content"]["status"] != "ok":
            log.error("kernel bootstrap failed: %s", reply["content"])

    async def _watch(self) -> None:
        """Restart the kernel if it dies (e.g. a segfault in a C extension)."""
        while True:
            await asyncio.sleep(1.0)
            if self._restarting or self.km is None:
                continue
            if not await self.km.is_alive():
                await self._sink({"type": "stream", "name": "stderr", "text": "Kernel died, restarting…\n"})
                await self.restart()

    # ------------------------------------------------------------------ requests
    async def execute(self, code: str, line_offset: int = 0) -> str:
        msg_id = self.kc.execute(code, store_history=True, allow_stdin=False)
        self._sent.add(msg_id)
        self._offsets[msg_id] = line_offset
        await self._sink({"type": "execute_started", "msg_id": msg_id})
        return msg_id

    async def complete(self, code: str, cursor_pos: int) -> dict[str, Any]:
        reply = await self._request(self.kc.complete(code, cursor_pos), timeout=5)
        content = reply["content"]
        types = content.get("metadata", {}).get("_jupyter_types_experimental", [])
        return {
            "matches": content.get("matches", []),
            "cursor_start": content.get("cursor_start", cursor_pos),
            "cursor_end": content.get("cursor_end", cursor_pos),
            "types": [t.get("type", "") for t in types],
        }

    async def resync(self) -> None:
        """Re-send every renderable variable (a new browser tab has no state)."""
        await self._request(self.kc.execute("_gs_bootstrap.resync()", silent=True, store_history=False))

    async def _request(self, msg_id: str, timeout: float = 120) -> dict[str, Any]:
        fut: asyncio.Future = asyncio.get_running_loop().create_future()
        self._sent.add(msg_id)
        self._replies[msg_id] = fut
        try:
            return await asyncio.wait_for(fut, timeout)
        finally:
            self._replies.pop(msg_id, None)

    # ------------------------------------------------------------------ pumps
    async def _pump_shell(self) -> None:
        while True:
            try:
                msg = await self.kc.get_shell_msg()
            except asyncio.CancelledError:
                raise
            except Exception:  # channel hiccup during restart
                await asyncio.sleep(0.05)
                continue
            parent = msg["parent_header"].get("msg_id")
            fut = self._replies.get(parent)
            if fut is not None and not fut.done():
                fut.set_result(msg)
            elif msg["msg_type"] == "execute_reply" and parent in self._offsets:
                content = msg["content"]
                await self._sink(
                    {
                        "type": "execute_done",
                        "msg_id": parent,
                        "status": content.get("status"),
                        "execution_count": content.get("execution_count"),
                    }
                )
                # Late comm messages for this execution may still need the offset,
                # so keep a bounded history instead of popping immediately.
                if len(self._offsets) > 64:
                    for key in list(self._offsets)[:-32]:
                        self._offsets.pop(key, None)

    async def _pump_iopub(self) -> None:
        while True:
            try:
                msg = await self.kc.get_iopub_msg()
            except asyncio.CancelledError:
                raise
            except Exception:
                await asyncio.sleep(0.05)
                continue
            try:
                await self._handle_iopub(msg)
            except Exception:
                log.exception("failed to handle iopub message %s", msg.get("msg_type"))

    async def _handle_iopub(self, msg: dict[str, Any]) -> None:
        msg_type = msg["msg_type"]
        content = msg["content"]
        parent = msg["parent_header"].get("msg_id")
        if parent in self._stale:
            return  # output of the kernel that was just restarted
        user_exec = parent in self._offsets

        if msg_type == "status":
            if user_exec:
                await self._sink({"type": "status", "state": content["execution_state"]})
        elif msg_type == "stream":
            await self._sink({"type": "stream", "name": content["name"], "text": content["text"]})
        elif msg_type == "error":
            await self._sink(
                {
                    "type": "error",
                    "ename": content["ename"],
                    "evalue": content["evalue"],
                    "traceback": strip_ansi("\n".join(content["traceback"])),
                }
            )
        elif msg_type in ("execute_result", "display_data"):
            text = content.get("data", {}).get("text/plain")
            if text:
                await self._sink({"type": "result", "text": strip_ansi(text)})
        elif msg_type in ("comm_open", "comm_msg"):
            await self._handle_comm(content.get("data") or {}, msg.get("buffers") or [], parent)

    async def _handle_comm(self, data: dict[str, Any], buffers: list, parent: str | None) -> None:
        kind = data.get("type")
        if kind == "var":
            await self._sink(pack_frame(data, [memoryview(b) for b in buffers]))
        elif kind == "error_line":
            line = data["line"] + self._offsets.get(parent, 0)
            await self._sink({"type": "error_line", "line": line})
        elif kind is not None and kind != "hello":
            await self._sink(data)
