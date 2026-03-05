from io import BytesIO
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app


def _png_bytes() -> bytes:
    image = Image.new("RGB", (400, 200), color=(245, 245, 245))
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def test_upload_image_and_list_slides(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)

    response = client.post(
        "/api/v1/documents/upload",
        files={"file": ("slide.png", _png_bytes(), "image/png")},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["slide_count"] == 1

    doc_id = payload["document"]["id"]
    slides_response = client.get(f"/api/v1/documents/{doc_id}/slides")

    assert slides_response.status_code == 200
    slides_payload = slides_response.json()
    assert len(slides_payload["slides"]) == 1
    assert slides_payload["slides"][0]["page_num"] == 1
