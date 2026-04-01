"""Tests for document API endpoints: upload, list, status, delete with user scoping."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

os.environ.setdefault("JWT_SECRET", "test-secret-for-unit-tests")

from app.main import create_app
from app.models import Document, Slide, SlideExplanation, SlideExtract
from app.services.explanation_engine import CURRENT_EXPLANATION_VERSION
from app.services.slide_processor import CURRENT_EXTRACT_SCHEMA_VERSION

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


def _current_extract_payload(page_num: int) -> dict:
    return {
        "schema_version": CURRENT_EXTRACT_SCHEMA_VERSION,
        "page_num": page_num,
        "text": f"Page {page_num} body",
        "summary": f"Page {page_num} summary",
        "title_candidates": [f"Page {page_num} title"],
        "text_blocks": [],
        "bullet_blocks": [],
        "figures": [],
        "tables": [],
        "equation_like_blocks": [],
        "code_like_blocks": [],
        "reading_order": [],
        "page_stats": {"word_count": 3},
        "repeat_analysis": None,
    }


def _current_explanation_meta(page_num: int) -> dict:
    return {
        "render_mode": "compact-static",
        "content_type": "summary",
        "title": f"Page {page_num} title",
    }


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


# ── 6. Unauthenticated document routes require auth ─────────────────


def test_unauthenticated_document_routes_require_auth(app_and_client):
    """Document upload and list endpoints should reject unauthenticated requests."""
    _app, client = app_and_client
    user = _register_user(client, "authed@test.com", "Authed")

    # Authenticated upload still works.
    auth_upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("owned.pdf", MINIMAL_PDF, "application/pdf")},
        headers=_auth_header(user["token"]),
    )
    assert auth_upload.status_code == 202

    # Unauthenticated upload is rejected.
    anon_upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("anon.pdf", MINIMAL_PDF, "application/pdf")},
    )
    assert anon_upload.status_code == 401

    # Unauthenticated list is rejected too.
    anon_list = client.get("/api/v1/documents")
    assert anon_list.status_code == 401


def test_cache_batch_returns_ready_documents_with_current_payloads(two_users):
    """Batch cache endpoint should return ready owned documents with slides + explanations."""
    app, client, user_a, user_b = two_users

    with Session(app.state.engine) as session:
        doc_a = Document(
            filename="alpha.pdf",
            media_type="application/pdf",
            storage_path="alpha",
            status="ready",
            page_count=1,
            user_id=user_a["user"]["id"],
        )
        doc_b = Document(
            filename="beta.pdf",
            media_type="application/pdf",
            storage_path="beta",
            status="ready",
            page_count=1,
            user_id=user_a["user"]["id"],
        )
        foreign_doc = Document(
            filename="foreign.pdf",
            media_type="application/pdf",
            storage_path="foreign",
            status="ready",
            page_count=1,
            user_id=user_b["user"]["id"],
        )
        session.add(doc_a)
        session.add(doc_b)
        session.add(foreign_doc)
        session.flush()

        for doc, page_num in ((doc_a, 1), (doc_b, 2), (foreign_doc, 3)):
            slide = Slide(
                document_id=doc.id,
                page_num=page_num,
                image_path=f"slides/{page_num}.png",
                thumbnail_path=f"thumbs/{page_num}.png",
                width=1600,
                height=900,
            )
            session.add(slide)
            session.flush()
            session.add(SlideExtract(slide_id=slide.id, payload=_current_extract_payload(page_num)))
            session.add(
                SlideExplanation(
                    document_id=doc.id,
                    slide_id=slide.id,
                    page_num=page_num,
                    markdown=f"## Page {page_num} title\n\nReady explanation {page_num}",
                    meta=_current_explanation_meta(page_num),
                    version=CURRENT_EXPLANATION_VERSION,
                )
            )

        session.commit()
        doc_a_id = doc_a.id
        doc_b_id = doc_b.id

    resp = client.get(
        f"/api/v1/documents/cache-batch?document_id={doc_a_id}&document_id={doc_b_id}",
        headers=_auth_header(user_a["token"]),
    )

    assert resp.status_code == 200
    payload = resp.json()
    assert [item["document_id"] for item in payload["documents"]] == [doc_a_id, doc_b_id]
    assert payload["documents"][0]["slides"][0]["extract"]["summary"] == "Page 1 summary"
    assert payload["documents"][0]["explanations"][0]["markdown"].startswith("## Page 1 title")
    assert payload["documents"][1]["slides"][0]["page_num"] == 2
