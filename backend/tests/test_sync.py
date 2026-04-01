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


def test_document_has_content_version():
    doc = Document(filename="test.pdf", media_type="application/pdf", storage_path="/tmp")
    assert hasattr(doc, "content_version")
    assert doc.content_version == 1


def test_bump_content_version(app_and_client):
    from app.api.documents import bump_content_version
    app, client = app_and_client

    # Register user
    resp = client.post("/api/v1/auth/register", json={"email": "test@test.com", "password": "password123", "display_name": "Tester"})
    assert resp.status_code == 201
    user_id = resp.json()["user"]["id"]

    engine = app.state.engine
    with Session(engine) as session:
        doc = Document(filename="test.pdf", media_type="application/pdf", storage_path="/tmp", user_id=user_id, status="ready")
        session.add(doc)
        session.commit()
        session.refresh(doc)
        assert doc.content_version == 1
        bump_content_version(session, doc.id)
        session.commit()
        session.refresh(doc)
        assert doc.content_version == 2
