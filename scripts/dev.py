"""Start the backend (uvicorn) and the frontend (Vite) together.

Both bind to 127.0.0.1 only. Ctrl+C stops both.
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
BACKEND_PORT = int(os.environ.get("GEOSANDBOX_BACKEND_PORT", "8765"))


def main() -> int:
    npm = shutil.which("npm")
    if npm is None:
        print("npm not found — run through `pixi run dev` so nodejs is on PATH.", file=sys.stderr)
        return 1
    if not (FRONTEND / "node_modules").is_dir():
        print("Installing frontend dependencies…", flush=True)
        subprocess.run([npm, "install", "--no-audit", "--no-fund"], cwd=FRONTEND, check=True)

    procs = [
        subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", str(BACKEND_PORT)],
            cwd=ROOT,
        ),
        subprocess.Popen([npm, "run", "dev"], cwd=FRONTEND),
    ]
    print("\n  GeoSandbox → http://127.0.0.1:5173\n", flush=True)

    def stop(*_: object) -> None:
        for p in procs:
            if p.poll() is None:
                p.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        while all(p.poll() is None for p in procs):
            time.sleep(0.3)
    finally:
        stop()
        for p in procs:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()
    return max((p.returncode or 0) for p in procs)


if __name__ == "__main__":
    sys.exit(main())
