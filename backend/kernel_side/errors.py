"""Map an exception raised by a cell back to a line number inside that cell."""

from __future__ import annotations

import traceback
from typing import Any


def cell_filename(ip: Any, raw_cell: str) -> str | None:
    try:
        return ip.compile.get_code_name(raw_cell, raw_cell, ip.execution_count)
    except Exception:
        return None


def error_line(ip: Any, result: Any) -> int | None:
    """1-based line inside the executed cell where the error happened, if any."""
    raw_cell = getattr(result.info, "raw_cell", "") or ""

    err = result.error_before_exec
    if isinstance(err, SyntaxError):
        return err.lineno
    if err is not None:
        return None

    err = result.error_in_exec
    if err is None or err.__traceback__ is None:
        return None
    if isinstance(err, SyntaxError) and err.filename == cell_filename(ip, raw_cell):
        return err.lineno

    target = cell_filename(ip, raw_cell)
    line = None
    for frame, lineno in traceback.walk_tb(err.__traceback__):
        if frame.f_code.co_filename == target:
            line = lineno
    return line
