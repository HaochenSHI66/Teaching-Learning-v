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
