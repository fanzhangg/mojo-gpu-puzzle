#!/usr/bin/env python3
"""Local server for Kernel Flow: serves the page, reads puzzle files from disk,
and runs them for real on this machine's GPU with `pixi run mojo`.

    python3 tools/kernel-flow/server.py          # then open http://127.0.0.1:8765

Only listens on 127.0.0.1. It runs whatever Mojo code the page sends, so do not
expose it to other machines.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # repo root
PAGE = HERE / "kernel-flow.html"
GROUPS = ("solutions",)
TOOLS = ("memcheck", "racecheck", "synccheck", "initcheck")
RUN_TIMEOUT = 300
run_lock = threading.Lock()


def find_pixi() -> str | None:
    return shutil.which("pixi") or next((str(p) for p in [Path.home() / ".pixi/bin/pixi"] if p.exists()), None)


def list_files() -> list[dict]:
    out = []
    for group in GROUPS:
        for f in sorted((ROOT / group).glob("p*/*.mojo")):
            out.append({"path": str(f.relative_to(ROOT)), "group": group, "puzzle": f.parent.name, "mtime": f.stat().st_mtime})
    return out


def safe_path(rel: str) -> Path | None:
    """A .mojo file inside solutions/, or None."""
    try:
        p = (ROOT / rel).resolve()
    except (OSError, ValueError):
        return None
    if p.suffix != ".mojo" or not p.is_file():
        return None
    if not any(p.is_relative_to((ROOT / g).resolve()) for g in GROUPS):
        return None
    return p


def gpu_name() -> str | None:
    try:
        r = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"], capture_output=True, text=True, timeout=10)
        return r.stdout.strip().splitlines()[0] if r.returncode == 0 and r.stdout.strip() else None
    except (OSError, subprocess.SubprocessError):
        return None


def run_mojo(path: str | None, code: str | None, args: list[str], tool: str | None) -> dict:
    pixi = find_pixi()
    if not pixi:
        return {"ok": False, "error": "pixi was not found. Install it from https://pixi.sh and run `pixi install` in the repo."}
    src = safe_path(path) if path else None
    if path and not src:
        return {"ok": False, "error": f"Not a puzzle file: {path}"}
    if not src and code is None:
        return {"ok": False, "error": "Nothing to run."}
    if any(not isinstance(a, str) or not a.startswith("--") or len(a) > 64 for a in args):
        return {"ok": False, "error": "Run flags must look like --name."}
    if tool and tool not in TOOLS:
        return {"ok": False, "error": f"Unknown check: {tool}"}

    temp = None
    target = src
    if code is not None:
        # Run edited code next to the original file so relative imports keep working.
        folder = src.parent if src else ROOT / "solutions"
        temp = folder / f".kernel_flow_{uuid.uuid4().hex[:8]}.mojo"
        temp.write_text(code)
        target = temp
    cmd = [pixi, "run", "--manifest-path", str(ROOT / "pixi.toml")]
    if tool:
        cmd += ["compute-sanitizer", "--tool", tool]
    cmd += ["mojo", "-I", str(ROOT), str(target), *args]
    env = dict(os.environ)
    if tool:
        env["MODULAR_DEVICE_CONTEXT_MEMORY_MANAGER_SIZE_PERCENT"] = "0"
    shown = " ".join(["pixi run"] + (["compute-sanitizer", "--tool", tool] if tool else []) + ["mojo -I .", str((src or target).relative_to(ROOT)), *args])
    start = time.time()
    try:
        with run_lock:
            r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, timeout=RUN_TIMEOUT, env=env)
        return {"ok": r.returncode == 0, "exitCode": r.returncode, "stdout": r.stdout[-200_000:], "stderr": r.stderr[-200_000:], "seconds": round(time.time() - start, 2), "command": shown}
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"Stopped after {RUN_TIMEOUT} s.", "command": shown}
    finally:
        if temp and temp.exists():
            temp.unlink()


class Handler(BaseHTTPRequestHandler):
    server_version = "KernelFlow/1"

    def log_message(self, fmt, *a):  # quieter log
        print("  " + fmt % a)

    def _host_ok(self) -> bool:
        # Blocks DNS-rebinding: only answer requests addressed to this machine.
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost")

    def _send(self, status: int, body: bytes, ctype: str):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _json(self, obj, status=200):
        self._send(status, json.dumps(obj).encode(), "application/json")

    def do_GET(self):
        if not self._host_ok():
            return self._json({"error": "forbidden"}, 403)
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            if not PAGE.exists():
                return self._send(500, b"kernel-flow.html is missing; run `npm run build` in tools/kernel-flow.", "text/plain")
            return self._send(200, PAGE.read_bytes(), "text/html; charset=utf-8")
        if u.path == "/api/info":
            return self._json({"server": True, "gpu": gpu_name(), "pixi": bool(find_pixi()), "tools": list(TOOLS)})
        if u.path == "/api/files":
            return self._json(list_files())
        if u.path == "/api/file":
            rel = parse_qs(u.query).get("path", [""])[0]
            p = safe_path(rel)
            if not p:
                return self._json({"error": "not found"}, 404)
            return self._json({"path": rel, "code": p.read_text()})
        self._json({"error": "not found"}, 404)

    def do_POST(self):
        # The custom header makes browsers send a CORS preflight, which this server never approves,
        # so other websites cannot make the browser POST here.
        if not self._host_ok() or self.headers.get("X-Kernel-Flow") != "1":
            return self._json({"error": "forbidden"}, 403)
        if urlparse(self.path).path != "/api/run":
            return self._json({"error": "not found"}, 404)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(min(n, 2_000_000)) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json({"error": "bad request"}, 400)
        self._json(run_mojo(body.get("path"), body.get("code"), body.get("args") or [], body.get("tool")))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print(f"Kernel Flow: http://127.0.0.1:{a.port}   (GPU: {gpu_name() or 'none found'}; Ctrl+C to stop)")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
