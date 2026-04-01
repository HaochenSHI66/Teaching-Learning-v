"""Tests for /api/v1/sync endpoints."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-secret-for-unit-tests")

from app.main import create_app


@pytest.fixture()
def app_and_client(tmp_path: Path):
    """Create a fresh app with an isolated SQLite database and storage dir."""
    db_url = f"sqlite:///{tmp_path / 'test.db'}"
    storage = tmp_path / "storage"
    app = create_app(database_url=db_url, storage_dir=storage)
    client = TestClient(app)
    yield app, client


def test_sync_manifest_returns_documents(app_and_client):
    app, client = app_and_client
    resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": "manifest@test.com",
            "password": "password123",
            "display_name": "Tester",
        },
    )
    assert resp.status_code == 201
    headers = {"Authorization": f"Bearer {resp.json()['token']}"}

    resp = client.get("/api/v1/sync/manifest", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "schema" in data
    assert "explanation_version" in data["schema"]
    assert "extract_version" in data["schema"]
    assert "documents" in data
