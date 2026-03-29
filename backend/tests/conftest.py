"""Shared test fixtures for authentication.

Sets JWT_SECRET before any app code is imported so that tokens are
deterministic across the test session.
"""
from __future__ import annotations

import os

# Must be set BEFORE importing anything from app.auth
os.environ.setdefault("JWT_SECRET", "test-secret-for-unit-tests")

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlmodel import Session

from app.auth import create_access_token
from app.models import User


TEST_USER_ID = "test-user-00000000-0000-0000-0000-000000000001"
TEST_USER_EMAIL = "testuser@example.com"
TEST_USER_DISPLAY_NAME = "Test User"


def create_test_user_in_db(engine) -> User:
    """Insert a test user into the database and return the User object."""
    user = User(
        id=TEST_USER_ID,
        email=TEST_USER_EMAIL,
        password_hash="fakehash-not-used-in-tests",
        display_name=TEST_USER_DISPLAY_NAME,
        created_at=datetime.now(timezone.utc),
    )
    with Session(engine) as session:
        # Avoid duplicate inserts if called multiple times on the same DB
        existing = session.get(User, TEST_USER_ID)
        if existing:
            return existing
        session.add(user)
        session.commit()
        session.refresh(user)
        session.expunge(user)
    return user


def get_auth_headers() -> dict[str, str]:
    """Return Authorization headers with a valid JWT for the test user."""
    token = create_access_token(TEST_USER_ID)
    return {"Authorization": f"Bearer {token}"}
