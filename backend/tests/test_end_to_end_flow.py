from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app


def _png_bytes() -> bytes:
    image = Image.new("RGB", (640, 360), color=(250, 245, 235))
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def test_end_to_end_learning_flow(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)

    upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("lecture.png", _png_bytes(), "image/png")},
    )
    assert upload.status_code == 202
    doc_id = upload.json()["document"]["id"]

    slides = client.get(f"/api/v1/documents/{doc_id}/slides")
    assert slides.status_code == 200
    slide_id = slides.json()["slides"][0]["id"]

    create_session = client.post(
        "/api/v1/sessions",
        json={"document_id": doc_id, "current_slide_id": slide_id},
    )
    assert create_session.status_code == 201
    session_id = create_session.json()["id"]

    get_session = client.get(f"/api/v1/sessions/{session_id}")
    assert get_session.status_code == 200
    assert get_session.json()["current_slide_id"] == slide_id

    chat = client.post(
        "/api/v1/chat",
        json={
            "session_id": session_id,
            "message": "给我这一页的重点",
            "slide_id": slide_id,
            "mode": "slide",
        },
    )
    assert chat.status_code == 200
    assert chat.json()["used_slide_ids"] == [slide_id]

    notes = client.post(
        "/api/v1/notes/export",
        json={"session_id": session_id, "title": "MVP E2E"},
    )
    assert notes.status_code == 200
    assert "# MVP E2E" in notes.json()["markdown"]
