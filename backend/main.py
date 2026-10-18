"""FastAPI entry point: one WebSocket per browser tab, one shared kernel."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles

from backend import exercises
from backend.kernel import KernelSession, Message

log = logging.getLogger("geosandbox")

ROOT = Path(__file__).resolve().parent.parent
SNIPPETS = ROOT / "snippets"
DIST = ROOT / "frontend" / "dist"

clients: set[WebSocket] = set()
background: set[asyncio.Task] = set()


async def broadcast(message: Message) -> None:
    dead = []
    for ws in list(clients):
        try:
            if isinstance(message, bytes):
                await ws.send_bytes(message)
            else:
                await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


session = KernelSession(broadcast)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await session.start()
    yield
    await session.stop()


app = FastAPI(title="geo-sandbox", lifespan=lifespan)


@app.get("/api/snippets")
def list_snippets() -> list[dict[str, str]]:
    return [{"name": p.stem, "file": p.name} for p in sorted(SNIPPETS.glob("*.py"))]


@app.get("/api/snippets/{name}")
def get_snippet(name: str) -> dict[str, str]:
    path = (SNIPPETS / f"{Path(name).stem}.py").resolve()
    if path.parent != SNIPPETS.resolve() or not path.is_file():
        raise HTTPException(404, "snippet not found")
    return {"name": path.stem, "code": path.read_text()}


@app.get("/api/exercises/status")
def exercises_status() -> dict[str, object]:
    return {"configured": exercises.api_key() is not None, "model": exercises.MODEL}


@app.post("/api/exercises")
async def generate_exercises(req: exercises.ExerciseRequest) -> dict[str, object]:
    try:
        return await exercises.generate(req)
    except exercises.ExerciseError as exc:
        raise HTTPException(exc.status, exc.message) from exc


@app.websocket("/ws")
async def websocket(ws: WebSocket) -> None:
    await ws.accept()
    clients.add(ws)
    await ws.send_json({"type": "hello"})
    try:
        while True:
            msg = await ws.receive_json()
            await handle(ws, msg)
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)


async def handle(ws: WebSocket, msg: dict) -> None:
    kind = msg.get("type")
    if kind == "execute":
        await session.execute(msg["code"], int(msg.get("line_offset", 0)))
    elif kind == "complete":
        try:
            reply = await session.complete(msg["code"], int(msg["cursor_pos"]))
        except (asyncio.TimeoutError, asyncio.CancelledError):
            reply = {"matches": [], "cursor_start": msg["cursor_pos"], "cursor_end": msg["cursor_pos"], "types": []}
        await ws.send_json({"type": "complete_reply", "request_id": msg.get("request_id"), **reply})
    elif kind == "interrupt":
        await session.interrupt()
    elif kind == "restart":
        await session.restart()
    elif kind == "resync":
        # In the background: re-rendering every variable can take seconds, and this
        # tab's next messages (restart, execute) must not queue behind it.
        task = asyncio.create_task(_resync())
        background.add(task)
        task.add_done_callback(background.discard)


async def _resync() -> None:
    # A restart cancels the pending request; a slow kernel times it out.
    with contextlib.suppress(asyncio.TimeoutError, asyncio.CancelledError):
        await session.resync()


if DIST.is_dir():
    app.mount("/", StaticFiles(directory=DIST, html=True), name="frontend")
