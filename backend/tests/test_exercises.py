import json

import httpx2 as httpx
import pytest

from backend import exercises
from backend.exercises import ExerciseError, ExerciseRequest, format_exercises

DATA = {
    "title": "Shapely: primeros pasos",
    "exercises": [
        {
            "title": "Un buffer",
            "statement": "Crea un punto en (2, 3) y un buffer de radio 1. Deberías ver un círculo.",
            "hint": "Usa .buffer()",
            "starter_code": "from shapely import Point\n\n# TODO",
        },
        {"title": "Roto %% raro", "statement": "%% no debe crear celdas", "starter_code": "def f(:\n  pass"},
    ],
}


def test_format_makes_one_cell_per_exercise():
    code = format_exercises(DATA, ExerciseRequest(library="shapely", count=2, language="es"))
    cells = [line for line in code.splitlines() if line.startswith("# %%")]
    assert cells == ["# %% Ejercicio 1 · Un buffer", "# %% Ejercicio 2 · Roto % % raro"]
    assert "# Pista: Usa .buffer()" in code
    assert "from shapely import Point" in code
    # Broken starter code is kept, commented out, so the file still runs.
    assert "# def f(:" in code
    compile(code, "<exercises>", "exec")


def test_english_labels():
    code = format_exercises(DATA, ExerciseRequest(library="shapely", language="en"))
    assert "# %% Exercise 1 · Un buffer" in code and "# Hint: Usa .buffer()" in code


def test_api_key_from_dotenv(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(exercises, "ROOT", tmp_path)
    assert exercises.api_key() is None
    (tmp_path / ".env").write_text("# secrets\nexport ANTHROPIC_API_KEY='sk-test'\n")
    assert exercises.api_key() == "sk-test"


async def test_no_key_is_a_clear_error(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(exercises, "ROOT", tmp_path)
    with pytest.raises(ExerciseError) as err:
        await exercises.generate(ExerciseRequest(library="shapely"))
    assert err.value.status == 503 and "ANTHROPIC_API_KEY" in err.value.message


async def test_generate_through_the_sdk(monkeypatch):
    """The real SDK, with the HTTP layer mocked: request shape and JSON parsing."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = request.url.path
        seen["key"] = request.headers.get("x-api-key")
        seen["beta"] = request.headers.get("anthropic-beta")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "id": "msg_1", "type": "message", "role": "assistant", "model": exercises.MODEL,
            "content": [{"type": "text", "text": json.dumps(DATA)}],
            "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 10},
        })

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        out = await exercises.generate(ExerciseRequest(library="shapely", count=2, topic="buffers", language="es"), http)

    body = seen["body"]
    assert seen["url"].endswith("/v1/messages") and seen["key"] == "sk-test"
    assert body["model"] == exercises.MODEL
    assert body["model"] == "claude-sonnet-5-5"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["output_config"]["effort"] == "medium"
    assert body["fallbacks"] == "default" and "server-side-fallback-2026-07-01" in seen["beta"]
    assert "tool_choice" not in body and "tools" not in body
    assert "2 beginner-level exercises about Shapely 2" in body["messages"][0]["content"]
    assert "Focus on: buffers" in body["messages"][0]["content"]
    assert out["count"] == 2 and out["code"].count("# %% Ejercicio") == 2


async def test_bad_key_maps_to_401(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-bad")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"type": "error", "error": {"type": "authentication_error", "message": "invalid x-api-key"}})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(ExerciseError) as err:
            await exercises.generate(ExerciseRequest(library="gdal"), http)
    assert err.value.status == 401


async def test_refusal_is_a_clear_error(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-test")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={
            "id": "msg_2", "type": "message", "role": "assistant", "model": exercises.MODEL,
            "content": [], "stop_reason": "refusal", "stop_sequence": None,
            "stop_details": {"type": "refusal", "category": "general_harms", "explanation": None},
            "usage": {"input_tokens": 10, "output_tokens": 0},
        })

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
        with pytest.raises(ExerciseError) as err:
            await exercises.generate(ExerciseRequest(library="shapely"), http)
    assert err.value.status == 422
