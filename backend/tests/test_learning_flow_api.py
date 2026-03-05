from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app


def _png_bytes() -> bytes:
    image = Image.new("RGB", (500, 280), color=(235, 240, 250))
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def test_slide_bound_chat_and_markdown_export(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)

    upload_resp = client.post(
        "/api/v1/documents/upload",
        files={"file": ("slide.png", _png_bytes(), "image/png")},
    )
    assert upload_resp.status_code == 202
    upload_payload = upload_resp.json()
    doc_id = upload_payload["document"]["id"]

    slides_resp = client.get(f"/api/v1/documents/{doc_id}/slides")
    assert slides_resp.status_code == 200
    slide_id = slides_resp.json()["slides"][0]["id"]

    session_resp = client.post(
        "/api/v1/sessions",
        json={"document_id": doc_id, "current_slide_id": slide_id},
    )
    assert session_resp.status_code == 201
    session_id = session_resp.json()["id"]

    chat_resp = client.post(
        "/api/v1/chat",
        json={
            "session_id": session_id,
            "message": "请解释这一页的核心知识点",
            "slide_id": slide_id,
            "mode": "slide",
        },
    )
    assert chat_resp.status_code == 200
    answer = chat_resp.json()["answer"]
    assert "## Slide 1 讲解" in answer
    assert "1分钟自测" in answer

    export_resp = client.post(
        "/api/v1/notes/export",
        json={"session_id": session_id, "title": "线性代数复习"},
    )
    assert export_resp.status_code == 200
    markdown = export_resp.json()["markdown"]
    assert "# 线性代数复习" in markdown
    assert "## Slide 1" in markdown
