from __future__ import annotations

import os
import secrets
import warnings
from datetime import datetime, timezone, timedelta
from pathlib import Path

import jwt
from dotenv import load_dotenv
from fastapi import HTTPException, Request, status
from sqlmodel import Session

from app.models import User

# Load .env before reading JWT_SECRET so it's available at import time
for _env in [Path(__file__).resolve().parents[1] / ".env", Path.cwd() / ".env"]:
    if _env.exists():
        load_dotenv(_env, override=False)
        break

JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    warnings.warn(
        "JWT_SECRET is not set! Using random secret (tokens won't survive restarts).",
        stacklevel=2,
    )
    if os.getenv("ENVIRONMENT") == "production" and not os.getenv("JWT_SECRET"):
        raise RuntimeError("JWT_SECRET must be set in production environment")
    JWT_SECRET = secrets.token_hex(32)
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_DAYS = 7


def create_access_token(user_id: str) -> str:
    """Create a JWT access token for the given user ID."""
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRY_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> dict:
    """Decode and validate a JWT token. Raises HTTPException on failure."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )


def _extract_token(request: Request) -> str | None:
    """Extract Bearer token from Authorization header, or return None."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        return None
    return auth_header[7:]


def get_current_user(request: Request) -> User:
    """FastAPI dependency: requires a valid JWT and returns the User.

    Raises 401 if no token or invalid token.
    """
    token = _extract_token(request)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    payload = _decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )

    engine = request.app.state.engine
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )
        if getattr(user, "is_disabled", False):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Account is disabled",
            )
        # Detach from session so it can be used outside
        session.expunge(user)
        return user


def require_admin(request: Request) -> User:
    """FastAPI dependency: requires admin user. Raises 403 if not admin."""
    user = get_current_user(request)
    if not getattr(user, "is_admin", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user


def get_optional_user(request: Request) -> User | None:
    """FastAPI dependency: returns User if a valid JWT is present, else None.

    This maintains backwards compatibility -- endpoints still work without auth.
    """
    token = _extract_token(request)
    if token is None:
        return None
    try:
        payload = _decode_token(token)
    except HTTPException:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None

    engine = request.app.state.engine
    with Session(engine) as session:
        user = session.get(User, user_id)
        if not user:
            return None
        session.expunge(user)
        return user
