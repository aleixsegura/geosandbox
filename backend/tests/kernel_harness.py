"""Helpers to drive a real KernelSession from tests."""

from __future__ import annotations

import asyncio
from typing import Any

from backend.kernel import KernelSession, Message
from backend.protocol import unpack_frame


class Recorder:
    def __init__(self) -> None:
        self.messages: list[Message] = []
        self.event = asyncio.Event()

    async def __call__(self, message: Message) -> None:
        self.messages.append(message)
        self.event.set()

    def json(self, type_: str | None = None) -> list[dict[str, Any]]:
        return [m for m in self.messages if isinstance(m, dict) and (type_ is None or m.get("type") == type_)]

    def frames(self) -> list[tuple[dict[str, Any], list[bytes]]]:
        return [unpack_frame(m) for m in self.messages if isinstance(m, bytes)]

    def clear(self) -> None:
        self.messages.clear()


async def run(session: KernelSession, rec: Recorder, code: str, line_offset: int = 0, timeout: float = 60) -> None:
    """Execute code and wait until its execute_done message arrives."""
    msg_id = await session.execute(code, line_offset)
    async with asyncio.timeout(timeout):
        while not any(m.get("msg_id") == msg_id for m in rec.json("execute_done")):
            rec.event.clear()
            await rec.event.wait()
        # comm/iopub messages may trail the shell reply slightly
        await asyncio.sleep(0.15)
