"""Exercise generator: asks Claude (Anthropic Messages API) for a set of
exercise statements and turns them into a `# %%` file the editor can open.

The API key comes from ANTHROPIC_API_KEY or from a `.env` file at the repo
root; it stays on the server and is never sent to the browser.
"""

from __future__ import annotations

import json
import os
import re
import textwrap
from pathlib import Path
from typing import Any, Literal

import anthropic
import httpx2
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
# Sonnet is a fraction of Opus's price and plenty for writing exercise statements.
MODEL = os.environ.get("GEOSANDBOX_MODEL", "claude-sonnet-5-5")
MAX_TOKENS = 16000
EFFORT = "medium"
# Server-side retry on another model if a safety classifier declines the request.
FALLBACK_BETA = "server-side-fallback-2026-07-01"

LIBRARIES = {
    "shapely": "Shapely 2",
    "gdal": "GDAL/OGR (from osgeo import gdal, ogr, osr)",
    "pyproj": "pyproj",
    "rasterio": "Rasterio",
    "xarray": "xarray (with rioxarray)",
    "geopandas": "GeoPandas",
}
LANGUAGES = {"es": "Spanish", "en": "English"}


class ExerciseRequest(BaseModel):
    library: Literal["shapely", "gdal", "pyproj", "rasterio", "xarray", "geopandas"]
    count: int = Field(5, ge=1, le=10)
    level: Literal["beginner", "intermediate", "advanced"] = "beginner"
    language: Literal["es", "en"] = "es"
    topic: str = Field("", max_length=300)


class ExerciseError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


SYSTEM = """You write programming exercises for geo-sandbox, a local notebook for learning Python geospatial libraries.

The learner writes Python in an editor split into `# %%` cells, run in a persistent IPython kernel. After each cell every top-level variable is drawn automatically: Shapely geometries on Cartesian graph paper (no CRS); anything with a CRS (GeoPandas, OGR, rasterio, xarray with rioxarray) on a web map; rasters and DataArrays with a colormap (N-D cubes get a time slider); pyproj CRS and Transformer objects as cards; Transformer.transform calls as points. Geometries with Z can be viewed in 3D. Names starting with `_` are not drawn, and `show(obj, label=None)` draws any intermediate object.

Available: Python 3.12, numpy, shapely 2, GDAL/OGR (from osgeo import gdal, ogr, osr), pyproj, rasterio, xarray, rioxarray, geopandas. There is no internet and there are no data files: every exercise builds its own data in code (coordinates, numpy arrays, rasterio MemoryFile, the GDAL MEM driver or /vsimem/, GeoDataFrames from lists).

For each exercise:
- title: a few words.
- statement: what to do and what the learner should see on the canvas, so the result can be checked visually. Plain text, no markdown, at most about 120 words. Name the functions to use only at beginner level.
- starter_code: runnable Python with the imports and the input data, but not the solution; it may end with `# TODO` comments. Never include `# %%` lines.
- hint: one short hint.

Make the set progressive and varied, with practical, real-world geospatial tasks rather than trivia."""

# Structured output: the response text is guaranteed to be JSON matching this schema.
SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "Title of the whole set."},
        "exercises": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "statement": {"type": "string"},
                    "hint": {"type": "string"},
                    "starter_code": {"type": "string"},
                },
                "required": ["title", "statement", "hint", "starter_code"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["title", "exercises"],
    "additionalProperties": False,
}


def api_key() -> str | None:
    """ANTHROPIC_API_KEY from the environment, else from `.env` at the repo root."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if key:
        return key.strip()
    env = ROOT / ".env"
    if env.is_file():
        for line in env.read_text().splitlines():
            name, sep, value = line.strip().partition("=")
            if sep and name.strip().removeprefix("export ").strip() == "ANTHROPIC_API_KEY":
                return value.strip().strip("'\"") or None
    return None


def user_prompt(req: ExerciseRequest) -> str:
    text = (
        f"Write {req.count} {req.level}-level exercises about {LIBRARIES[req.library]}. "
        f"Write titles, statements, hints and code comments in {LANGUAGES[req.language]}."
    )
    if req.topic.strip():
        text += f"\nFocus on: {req.topic.strip()}"
    return text


async def call_claude(req: ExerciseRequest, key: str, http_client: httpx2.AsyncClient | None = None) -> dict[str, Any]:
    client = anthropic.AsyncAnthropic(api_key=key, max_retries=2, http_client=http_client)
    try:
        message = await client.beta.messages.create(
            model=MODEL,
            max_tokens=MAX_TOKENS,
            system=SYSTEM,
            output_config={"effort": EFFORT, "format": {"type": "json_schema", "schema": SCHEMA}},
            fallbacks="default",
            betas=[FALLBACK_BETA],
            messages=[{"role": "user", "content": user_prompt(req)}],
        )
    except anthropic.AuthenticationError as exc:
        raise ExerciseError(401, "The Anthropic API rejected the key (ANTHROPIC_API_KEY).") from exc
    except anthropic.RateLimitError as exc:
        raise ExerciseError(429, "Rate limited by the Anthropic API; try again in a moment.") from exc
    except anthropic.APIStatusError as exc:
        raise ExerciseError(502, f"Anthropic API error {exc.status_code}: {exc.message}") from exc
    except anthropic.APIConnectionError as exc:
        raise ExerciseError(502, "Could not reach the Anthropic API.") from exc
    if message.stop_reason == "refusal":
        raise ExerciseError(422, "Claude declined this request; try rewording the topic.")
    if message.stop_reason == "max_tokens":
        raise ExerciseError(502, "The answer was cut off; ask for fewer exercises.")
    text = next((b.text for b in message.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ExerciseError(502, "Claude returned no exercises.") from exc


_CELL = re.compile(r"^\s*#\s*%%")


def _comment(text: str, width: int = 88) -> list[str]:
    """Wrap free text as `# ` comment lines, keeping paragraphs and never forming a cell marker."""
    lines: list[str] = []
    for para in text.replace("%%", "% %").splitlines():
        lines += ["# " + w for w in textwrap.wrap(para, width - 2)] if para.strip() else ["#"]
    return lines


def _starter(code: str) -> list[str]:
    code = "\n".join(line for line in code.strip("\n").splitlines() if not _CELL.match(line))
    if not code.strip():
        return []
    try:
        compile(code, "<starter>", "exec")
    except SyntaxError:
        return ["# (starter code did not compile; kept as a comment)", *("# " + line for line in code.splitlines())]
    return code.splitlines()


def format_exercises(data: dict[str, Any], req: ExerciseRequest) -> str:
    """The exercise set as a `# %%` file: a header, then one cell per exercise."""
    exercise_word = "Ejercicio" if req.language == "es" else "Exercise"
    hint_word = "Pista" if req.language == "es" else "Hint"
    footer = (
        f"Generados por Claude ({MODEL}). Resuelve cada celda y ejecútala con Ctrl+Enter."
        if req.language == "es"
        else f"Generated by Claude ({MODEL}). Solve each cell and run it with Ctrl+Enter."
    )
    out = [*_comment(str(data.get("title") or LIBRARIES[req.library])), *_comment(footer), ""]
    for i, ex in enumerate(data.get("exercises") or [], 1):
        title = " ".join(str(ex.get("title", "")).split()).replace("%%", "% %")
        out.append(f"# %% {exercise_word} {i} · {title}" if title else f"# %% {exercise_word} {i}")
        out += _comment(str(ex.get("statement", "")))
        if ex.get("hint"):
            out += ["#", *_comment(f"{hint_word}: {ex['hint']}")]
        starter = _starter(str(ex.get("starter_code", "")))
        if starter:
            out += ["", *starter]
        out += ["", ""]
    return "\n".join(out).rstrip() + "\n"


async def generate(req: ExerciseRequest, http_client: httpx2.AsyncClient | None = None) -> dict[str, Any]:
    key = api_key()
    if not key:
        raise ExerciseError(
            503, "No API key: set ANTHROPIC_API_KEY (environment or .env at the project root) and restart."
        )
    data = await call_claude(req, key, http_client)
    exercises = data.get("exercises") or []
    if not exercises:
        raise ExerciseError(502, "Claude returned no exercises.")
    return {"code": format_exercises(data, req), "title": data.get("title", ""), "count": len(exercises), "model": MODEL}
