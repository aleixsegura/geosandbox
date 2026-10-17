"""Integration tests against a real IPython kernel."""

from __future__ import annotations

import pytest_asyncio

from backend.kernel import KernelSession
from backend.tests.kernel_harness import Recorder, run


@pytest_asyncio.fixture(scope="module")
async def kernel():
    rec = Recorder()
    session = KernelSession(rec)
    await session.start()
    yield session, rec
    await session.stop()


def stdout(rec: Recorder) -> str:
    return "".join(m["text"] for m in rec.json("stream") if m["name"] == "stdout")


async def test_state_persists_between_runs(kernel):
    session, rec = kernel
    rec.clear()
    await run(session, rec, "x = 21")
    await run(session, rec, "print(x * 2)")
    assert "42" in stdout(rec)


async def test_runtime_error_line_is_offset_into_the_file(kernel):
    session, rec = kernel
    rec.clear()
    await run(session, rec, "a = 1\nb = 2\n\n1 / 0\n", line_offset=10)
    errors = rec.json("error")
    assert errors and errors[0]["ename"] == "ZeroDivisionError"
    assert "\x1b[" not in errors[0]["traceback"]
    assert rec.json("error_line") == [{"type": "error_line", "line": 14}]


async def test_error_inside_function_marks_the_raising_line(kernel):
    session, rec = kernel
    rec.clear()
    await run(session, rec, "def f():\n    return undefined_name\n\nf()\n")
    assert rec.json("error_line")[0]["line"] == 2


async def test_syntax_error_line(kernel):
    session, rec = kernel
    rec.clear()
    await run(session, rec, "ok = 1\nnope = (\n", line_offset=3)
    assert rec.json("error")[0]["ename"] == "SyntaxError"
    assert rec.json("error_line")[0]["line"] in (5, 6)


async def test_kernel_survives_errors(kernel):
    session, rec = kernel
    rec.clear()
    await run(session, rec, "raise ValueError('boom')")
    await run(session, rec, "print('alive')")
    assert "alive" in stdout(rec)


async def test_completion_sees_live_namespace(kernel):
    session, rec = kernel
    await run(session, rec, "geosandbox_value = 3")
    reply = await session.complete("geosandbox_v", 12)
    assert "geosandbox_value" in reply["matches"]


async def test_restart_clears_state(kernel):
    session, rec = kernel
    await run(session, rec, "keep = 1")
    await session.restart()
    rec.clear()
    await run(session, rec, "print(keep)")
    assert rec.json("error")[0]["ename"] == "NameError"
    await run(session, rec, "print('after restart')")
    assert "after restart" in stdout(rec)


async def test_only_changed_variables_are_sent(kernel):
    session, rec = kernel
    await run(session, rec, "v1 = {'a': 1}\nv2 = [1, 2]")
    rec.clear()
    await run(session, rec, "v2.append(3)")
    names = [h["name"] for h, _ in rec.frames()]
    assert names == ["v2"]


async def test_removed_variables_are_reported(kernel):
    session, rec = kernel
    await run(session, rec, "gone = 1")
    rec.clear()
    await run(session, rec, "del gone")
    assert rec.json("remove") == [{"type": "remove", "names": ["gone"]}]


async def test_show_uses_the_argument_source_as_label(kernel):
    session, rec = kernel
    rec.clear()
    await run(session, rec, "show([1, 2][::-1])\nshow(3, label='three')")
    names = [h["name"] for h, _ in rec.frames()]
    assert names == ["[1, 2][::-1]", "three"]


async def test_resync_resends_everything(kernel):
    session, rec = kernel
    await run(session, rec, "r1 = 'hello'")
    rec.clear()
    await session.resync()
    names = {h["name"] for h, _ in rec.frames()}
    assert "r1" in names
