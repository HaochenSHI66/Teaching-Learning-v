from __future__ import annotations

import json
import logging
import sys
import time
import uuid
from typing import Any

from starlette.types import ASGIApp, Message, Receive, Scope, Send


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if hasattr(record, "request_id"):
            log_data["request_id"] = record.request_id
        if hasattr(record, "user_id"):
            log_data["user_id"] = record.user_id
        if record.exc_info and record.exc_info[0]:
            log_data["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_data, ensure_ascii=False)


def setup_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    root.handlers.clear()
    root.addHandler(handler)


class RequestLoggingMiddleware:
    """Pure ASGI middleware for request logging.

    Unlike BaseHTTPMiddleware, this does not interfere with CORSMiddleware
    preflight handling.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = str(uuid.uuid4())[:8]
        # Store request_id in scope state for downstream access
        scope.setdefault("state", {})["request_id"] = request_id
        start = time.monotonic()
        method = scope.get("method", "?")
        path = scope.get("path", "?")
        logger = logging.getLogger("api.request")
        status_code = 500  # default if we never see a response

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message.get("status", 500)
                # Inject X-Request-ID header
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            duration_ms = (time.monotonic() - start) * 1000
            logger.error(
                "%s %s 500 %.0fms",
                method, path, duration_ms,
                extra={"request_id": request_id},
            )
            raise

        duration_ms = (time.monotonic() - start) * 1000
        logger.info(
            "%s %s %d %.0fms",
            method, path, status_code, duration_ms,
            extra={"request_id": request_id},
        )
