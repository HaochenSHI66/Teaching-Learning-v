"""Tests for document API endpoints: upload, list, status, delete with user scoping."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-secret-for-unit-tests")

from app.main import create_app

# A minimal valid PDF that passes magic-byte detection (%PDF header).
MINIMAL_PDF = (
    b"%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
    b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
    b"3 0 obj<</Type/Page/MediaBox[0 0 3 3]>>endobj\n"
    b"xref\n0 4\n"
    b"0000000000 65535 f \n"
    b"0000000009 00000 n \n"
    b"0000000058 00000 n \n"
    b"0000000115 00000 n \n"
    b"trailer<</Size 4/Root 1 0 R>>\n"
    b"startxref\n190\n%%EOF"
)


# ── Fixtures ────────────────────────────────────────────────────────


@pytest.fixture()
def app_and_client(tmp_path: Path):
    """Create a fresh app with an isolated SQLite database and storage dir."""
    db_url = f"sqlite:///{tmp_path / 'test.db'}"
    storage = tmp_path / "storage"
    app = create_app(database_url=db_url, storage_dir=storage)
    client = TestClient(app)
    yield app, client


def _register_user(client: TestClient, email: str, display_name: str) -> dict:
    """Register a user and return {"token": ..., "user": {...}}."""
    resp = client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "password123",
            "display_name": display_name,
        },
    )
    assert resp.status_code == 201, f"Registration failed: {resp.text}"
    return resp.json()


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
def two_users(app_and_client):
    """Register two users and return (app, client, user_a_data, user_b_data)."""
    app, client = app_and_client
    user_a = _register_user(client, "alice@test.com", "Alice")
    user_b = _register_user(client, "bob@test.com", "Bob")
    return app, client, user_a, user_b


# ── 1. Upload success ──────────────────────────────────────────────


def test_upload_valid_pdf_returns_202(app_and_client):
    """Uploading a minimal valid PDF should return 202 with document metadata."""
    _app, client = app_and_client
    user = _register_user(client, "uploader@test.com", "Uploader")

    resp = client.post(
        "/api/v1/documents/upload",
        files={"file": ("lecture.pdf", MINIMAL_PDF, "application/pdf")},
        headers=_auth_header(user["token"]),
    )

    assert resp.status_code == 202
    payload = resp.json()
    assert "document" in payload
    doc = payload["document"]
    assert doc["filename"] == "lecture.pdf"
    assert doc["status"] == "processing"  # background task won't run in TestClient
    assert doc["media_type"] == "application/pdf"


# ── 2. Upload empty file ───────────────────────────────────────────


def test_upload_empty_file_returns_400(app_and_client):
    """Uploading an empty file should be rejected with 400."""
    _app, client = app_and_client
    user = _register_user(client, "empty@test.com", "Empty")

    resp = client.post(
        "/api/v1/documents/upload",
        files={"file": ("empty.pdf", b"", "application/pdf")},
        headers=_auth_header(user["token"]),
    )

    assert resp.status_code == 400
    assert "empty" in resp.json()["detail"].lower()


# ── 3. List documents is user-scoped ───────────────────────────────


def test_list_documents_user_scoped(two_users):
    """User A's documents should NOT appear in user B's list."""
    _app, client, user_a, user_b = two_users

    # User A uploads a document
    upload_resp = client.post(
        "/api/v1/documents/upload",
        files={"file": ("alice.pdf", MINIMAL_PDF, "application/pdf")},
        headers=_auth_header(user_a["token"]),
    )
    assert upload_resp.status_code == 202
    doc_id = upload_resp.json()["document"]["id"]

    # User A can see the document
    list_a = client.get(
        "/api/v1/documents",
        headers=_auth_header(user_a["token"]),
    )
    assert list_a.status_code == 200
    a_doc_ids = [d["id"] for d in list_a.json()["documents"]]
    assert doc_id in a_doc_ids

    # User B should NOT see user A's document
    list_b = client.get(
        "/api/v1/documents",
        headers=_auth_header(user_b["token"]),
    )
    assert list_b.status_code == 200
    b_doc_ids = [d["id"] for d in list_b.json()["documents"]]
    assert doc_id not in b_doc_ids


# ── 4. Delete own document ─────────────────────────────────────────


def test_delete_own_document(app_and_client):
    """A user should be able to delete their own document."""
    _app, client = app_and_client
    user = _register_user(client, "owner@test.com", "Owner")

    upload_resp = client.post(
        "/api/v1/documents/upload",
        files={"file": ("to_delete.pdf", MINIMAL_PDF, "application/pdf")},
        headers=_auth_header(user["token"]),
    )
    assert upload_resp.status_code == 202
    doc_id = upload_resp.json()["document"]["id"]

    del_resp = client.delete(
        f"/api/v1/documents/{doc_id}",
        headers=_auth_header(user["token"]),
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["deleted"] is True

    # Verify it no longer appears in the list
    list_resp = client.get(
        "/api/v1/documents",
        headers=_auth_header(user["token"]),
    )
    assert doc_id not in [d["id"] for d in list_resp.json()["documents"]]


# ── 5. Delete other user's document ────────────────────────────────


def test_delete_other_users_document_returns_404(two_users):
    """Attempting to delete another user's document should return 404."""
    _app, client, user_a, user_b = two_users

    # User A uploads a document
    upload_resp = client.post(
        "/api/v1/documents/upload",
        files={"file": ("private.pdf", MINIMAL_PDF, "application/pdf")},
        headers=_auth_header(user_a["token"]),
    )
    assert upload_resp.status_code == 202
    doc_id = upload_resp.json()["document"]["id"]

    # User B tries to delete it
    del_resp = client.delete(
        f"/api/v1/documents/{doc_id}",
        headers=_auth_header(user_b["token"]),
    )
    assert del_resp.status_code == 404

    # Verify the document still exists for user A
    list_a = client.get(
        "/api/v1/documents",
        headers=_auth_header(user_a["token"]),
    )
    assert doc_id in [d["id"] for d in list_a.json()["documents"]]


# ── 6. Unauthenticated list sees only user_id=NULL docs ────────────


def test_unauthenticated_list_sees_only_null_user_docs(app_and_client):
    """Unauthenticated requests should only see documents with user_id=NULL."""
    _app, client = app_and_client
    user = _register_user(client, "authed@test.com", "Authed")

    # Authenticated upload (user_id is set)
    auth_upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("owned.pdf", MINIMAL_PDF, "application/pdf")},
        headers=_auth_header(user["token"]),
    )
    assert auth_upload.status_code == 202
    owned_doc_id = auth_upload.json()["document"]["id"]

    # Unauthenticated upload (user_id will be NULL)
    anon_upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("anon.pdf", MINIMAL_PDF, "application/pdf")},
    )
    assert anon_upload.status_code == 202
    anon_doc_id = anon_upload.json()["document"]["id"]

    # Unauthenticated list should see only the anonymous doc
    anon_list = client.get("/api/v1/documents")
    assert anon_list.status_code == 200
    anon_doc_ids = [d["id"] for d in anon_list.json()["documents"]]
    assert anon_doc_id in anon_doc_ids
    assert owned_doc_id not in anon_doc_ids
