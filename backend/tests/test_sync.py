import os
os.environ.setdefault("JWT_SECRET", "test-secret-for-unit-tests")

import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from sqlmodel import Session
from app.main import create_app
from app.models import Document


@pytest.fixture()
def app_and_client(tmp_path: Path):
    db_url = f"sqlite:///{tmp_path / 'test.db'}"
    storage = tmp_path / "storage"
    app = create_app(database_url=db_url, storage_dir=storage)
    client = TestClient(app)
    yield app, client


def _register_user(client, email="test@test.com"):
    resp = client.post("/api/v1/auth/register", json={"email": email, "password": "password123", "display_name": "Tester"})
    assert resp.status_code == 201
    return resp.json()


def _auth_header(token):
    return {"Authorization": f"Bearer {token}"}


def test_document_has_content_version():
    doc = Document(filename="test.pdf", media_type="application/pdf", storage_path="/tmp")
    assert hasattr(doc, "content_version")
    assert doc.content_version == 1


def test_bump_content_version(app_and_client):
    from app.api.documents import bump_content_version
    app, client = app_and_client
    reg = _register_user(client)
    engine = app.state.engine
    with Session(engine) as session:
        doc = Document(filename="test.pdf", media_type="application/pdf", storage_path="/tmp", user_id=reg["user"]["id"], status="ready")
        session.add(doc)
        session.commit()
        session.refresh(doc)
        assert doc.content_version == 1
        bump_content_version(session, doc.id)
        session.commit()
        session.refresh(doc)
        assert doc.content_version == 2


def test_sync_manifest(app_and_client):
    app, client = app_and_client
    reg = _register_user(client, "manifest@test.com")
    headers = _auth_header(reg["token"])
    resp = client.get("/api/v1/sync/manifest", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "schema" in data
    assert "explanation_version" in data["schema"]
    assert "extract_version" in data["schema"]
    assert "documents" in data


def test_manifest_includes_schema_versions(app_and_client):
    """Manifest schema block should match current global constants."""
    app, client = app_and_client
    reg = _register_user(client, "schema@test.com")
    headers = _auth_header(reg["token"])
    resp = client.get("/api/v1/sync/manifest", headers=headers)
    assert resp.status_code == 200
    schema = resp.json()["schema"]
    from app.services.explanation_engine import CURRENT_EXPLANATION_VERSION
    from app.services.slide_processor import CURRENT_EXTRACT_SCHEMA_VERSION
    assert schema["explanation_version"] == CURRENT_EXPLANATION_VERSION
    assert schema["extract_version"] == CURRENT_EXTRACT_SCHEMA_VERSION


def test_cache_batch_includes_content_version(app_and_client):
    """Cache-batch response should include content_version."""
    from app.models import Slide, SlideExtract
    from app.services.slide_processor import CURRENT_EXTRACT_SCHEMA_VERSION
    app, client = app_and_client
    reg = _register_user(client, "batch@test.com")
    headers = _auth_header(reg["token"])
    engine = app.state.engine
    with Session(engine) as session:
        doc = Document(
            filename="test.pdf", media_type="application/pdf",
            storage_path="/tmp", user_id=reg["user"]["id"],
            status="ready", page_count=1,
        )
        session.add(doc)
        session.commit()
        session.refresh(doc)
        slide = Slide(
            document_id=doc.id, page_num=1,
            image_path="slide_001.webp", thumbnail_path="thumb_001.webp",
            width=800, height=600,
        )
        session.add(slide)
        session.commit()
        session.refresh(slide)
        # Add a current extract so _refresh_document_extracts_if_needed returns early
        extract = SlideExtract(
            slide_id=slide.id,
            payload={
                "schema_version": CURRENT_EXTRACT_SCHEMA_VERSION,
                "page_num": 1,
                "text": "test",
                "summary": "test",
                "title_candidates": [],
                "text_blocks": [],
                "bullet_blocks": [],
                "figures": [],
                "tables": [],
                "equation_like_blocks": [],
                "code_like_blocks": [],
                "reading_order": [],
                "page_stats": {},
                "repeat_analysis": None,
            },
        )
        session.add(extract)
        session.commit()
        doc_id = doc.id
    resp = client.get(f"/api/v1/documents/cache-batch?document_id={doc_id}", headers=headers)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    bundle = resp.json()["documents"][0]
    assert "content_version" in bundle
    assert isinstance(bundle["content_version"], int)
