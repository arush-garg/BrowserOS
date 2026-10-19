#!/usr/bin/env python3
"""Serve the local OpenJev decision model over HTTP with the Jev/Ollama contract.

    POST /v1/systemone   {model?, state, questions}  -> {model, answers, usage}
    GET  /health         -> {status, model, loaded, idle_seconds}

Same wire format as Ollama's `/v1/systemone`, so BrowserOS (or any client)
can point `BROWSEROS_OPENJEV_OLLAMA_URL` at this server or at Ollama and
switch models without a code change.

The model is loaded lazily on the first request and kept warm while traffic
continues; after `--idle-seconds` (default 30) without a request the weights
are dropped so the ~3 GB footprint goes back to the OS. Requests are served
one at a time: there is a single mlx_lm instance.

    python openjev_http.py [--host 127.0.0.1] [--port 11435] [--idle-seconds 30]
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import openjev_service as svc

MAX_BODY_BYTES = 64 * 1024 * 1024
_lock = threading.Lock()
_last_request = time.monotonic()
_idle_seconds = 30.0


def _idle_reaper(stop: threading.Event) -> None:
    """Unload the model once no request has arrived for `_idle_seconds`."""
    while not stop.wait(1.0):
        with _lock:
            idle = time.monotonic() - _last_request
            if idle >= _idle_seconds and svc.unload():
                svc.log("idle_unload", idle_seconds=round(idle, 1))


class Handler(BaseHTTPRequestHandler):
    server_version = "openjev-http/1"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        svc.log("http", request=format % args)

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/health", "/"):
            self._send(
                200,
                {
                    "status": "ok",
                    "model": svc.MODEL_PATH,
                    "loaded": svc._model is not None,
                    "idle_seconds": round(time.monotonic() - _last_request, 1),
                },
            )
        else:
            self._send(404, {"error": f"no route {self.path}"})

    def do_POST(self) -> None:  # noqa: N802
        global _last_request
        if self.path != "/v1/systemone":
            self._send(404, {"error": f"no route {self.path}"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send(400, {"error": "invalid Content-Length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self._send(413 if length > MAX_BODY_BYTES else 400, {"error": "body required"})
            return
        try:
            message = json.loads(self.rfile.read(length))
            # validate_request expects request_id; the HTTP contract has none.
            message.setdefault("request_id", "http")
            _, state, questions = svc.validate_request(message)
            image = svc.validate_image(message)
        except Exception as error:
            self._send(400, {"error": str(error)})
            return
        try:
            with _lock:
                try:
                    svc.load()
                    result = svc.predict(state, questions, image)
                finally:
                    # Cleanup and idle accounting must stay under the same lock
                    # as inference so another request cannot race Metal cleanup.
                    svc.release_memory()
                    _last_request = time.monotonic()
        except Exception as error:
            svc.log("request_error", error_kind=type(error).__name__, error=str(error))
            self._send(500, {"error": str(error)})
            return
        self._send(200, {"model": message.get("model") or svc.MODEL_PATH, **result})


def main() -> int:
    global _idle_seconds, _last_request
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=11435)
    parser.add_argument(
        "--idle-seconds",
        type=float,
        default=30.0,
        help="unload the model after this long without a request (0 = never unload)",
    )
    parser.add_argument("--preload", action="store_true", help="load weights at startup")
    args = parser.parse_args()
    _idle_seconds = args.idle_seconds
    if args.preload:
        svc.load()
        _last_request = time.monotonic()

    stop = threading.Event()
    if _idle_seconds > 0:
        threading.Thread(target=_idle_reaper, args=(stop,), name="idle-reaper", daemon=True).start()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    svc.log(
        "listening",
        host=args.host,
        port=args.port,
        model=svc.MODEL_PATH,
        idle_seconds=_idle_seconds,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
