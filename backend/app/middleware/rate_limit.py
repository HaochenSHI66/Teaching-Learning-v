from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock
from typing import Callable

from fastapi import Depends, HTTPException, Request, status

from app.auth import get_optional_user
from app.models import User


class _RateLimitBucket:
    """Sliding-window counter for a single key."""

    __slots__ = ("timestamps", "max_calls", "window_seconds")

    def __init__(self, max_calls: int, window_seconds: int) -> None:
        self.timestamps: list[float] = []
        self.max_calls = max_calls
        self.window_seconds = window_seconds

    def is_allowed(self) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_seconds
        # Remove expired entries
        self.timestamps = [t for t in self.timestamps if t > cutoff]
        if len(self.timestamps) >= self.max_calls:
            return False
        self.timestamps.append(now)
        return True


class InMemoryRateLimiter:
    """In-memory rate limiter keyed by (identifier, endpoint_name).

    Not suitable for multi-process deployments; sufficient for single-process
    or dev/staging environments.
    """

    def __init__(self) -> None:
        self._buckets: dict[str, _RateLimitBucket] = {}
        self._lock = Lock()

    def check(self, key: str, max_calls: int, window_seconds: int) -> bool:
        """Return True if the request is allowed, False if rate-limited."""
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None or bucket.max_calls != max_calls or bucket.window_seconds != window_seconds:
                bucket = _RateLimitBucket(max_calls, window_seconds)
                self._buckets[key] = bucket
            return bucket.is_allowed()

    def cleanup(self) -> None:
        """Remove stale buckets (optional, call periodically)."""
        now = time.monotonic()
        with self._lock:
            stale_keys = []
            for key, bucket in self._buckets.items():
                if not bucket.timestamps or (now - bucket.timestamps[-1]) > bucket.window_seconds * 2:
                    stale_keys.append(key)
            for key in stale_keys:
                del self._buckets[key]


# Global singleton
_limiter = InMemoryRateLimiter()


def _get_client_key(request: Request, user: User | None) -> str:
    """Return a unique identifier: user_id if authenticated, otherwise client IP."""
    if user is not None:
        return f"user:{user.id}"
    client = request.client
    return f"ip:{client.host}" if client else "ip:unknown"


def rate_limit(max_calls: int, window_seconds: int, endpoint_name: str) -> Callable:
    """Create a FastAPI dependency that enforces rate limits.

    Usage:
        @router.post("/generate")
        def generate(
            ...,
            _rate_limit=Depends(rate_limit(20, 60, "explanation_generate")),
        ):
    """

    async def _dependency(
        request: Request,
        current_user: User | None = Depends(get_optional_user),
    ) -> None:
        client_key = _get_client_key(request, current_user)
        full_key = f"{client_key}:{endpoint_name}"
        if not _limiter.check(full_key, max_calls, window_seconds):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Rate limit exceeded. Maximum {max_calls} calls per {window_seconds} seconds for {endpoint_name}.",
            )

    return _dependency
