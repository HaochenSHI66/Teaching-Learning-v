from io import BytesIO
from pathlib import Path

import fitz
from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app


def _png_bytes() -> bytes:
    image = Image.new("RGB", (400, 200), color=(245, 245, 245))
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def _pdf_bytes() -> bytes:
    document = fitz.open()
    page = document.new_page(width=1000, height=700)
    page.insert_text((64, 100), "Gradient Descent", fontsize=28)
    page.insert_text((64, 150), "- learning rate", fontsize=20)
    page.insert_text((64, 185), "- update rule", fontsize=20)
    return document.tobytes()


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

    assert response.status_code == 202
    payload = response.json()
    doc_id = payload["document"]["id"]
    slides_response = client.get(f"/api/v1/documents/{doc_id}/slides")

    assert slides_response.status_code == 200
    slides_payload = slides_response.json()
    assert len(slides_payload["slides"]) == 1
    assert slides_payload["slides"][0]["page_num"] == 1


def test_pdf_slide_extract_contains_structured_blocks(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)

    response = client.post(
        "/api/v1/documents/upload",
        files={"file": ("slide.pdf", _pdf_bytes(), "application/pdf")},
    )

    assert response.status_code == 202
    doc_id = response.json()["document"]["id"]

    status_response = client.get(f"/api/v1/documents/{doc_id}/status")
    assert status_response.status_code == 200
    assert status_response.json()["status"] == "ready"

    slides_response = client.get(f"/api/v1/documents/{doc_id}/slides")
    assert slides_response.status_code == 200
    slide = slides_response.json()["slides"][0]

    assert "extract" in slide
    assert slide["extract"]["text"] != ""
    assert slide["extract"]["text_blocks"]
    assert isinstance(slide["extract"]["figures"], list)
    assert slide["extract"]["page_stats"]["text_block_count"] >= 1


def test_regenerate_slide_and_document_explanations_overwrite_cache(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)

    upload_response = client.post(
        "/api/v1/documents/upload",
        files={"file": ("slide.pdf", _pdf_bytes(), "application/pdf")},
    )
    assert upload_response.status_code == 202
    doc_id = upload_response.json()["document"]["id"]

    slides_response = client.get(f"/api/v1/documents/{doc_id}/slides")
    assert slides_response.status_code == 200
    slide_id = slides_response.json()["slides"][0]["id"]

    first_explanations = client.get(f"/api/v1/documents/{doc_id}/explanations")
    assert first_explanations.status_code == 200
    first_markdown = first_explanations.json()["explanations"][0]["markdown"]

    slide_regen = client.post(f"/api/v1/documents/{doc_id}/slides/{slide_id}/explanations/generate")
    assert slide_regen.status_code == 200
    slide_payload = slide_regen.json()
    assert slide_payload["slide_id"] == slide_id
    assert slide_payload["overwrote_existing"] is True
    assert slide_payload["markdown"] == first_markdown

    doc_regen = client.post(f"/api/v1/documents/{doc_id}/explanations/generate")
    assert doc_regen.status_code == 200
    doc_payload = doc_regen.json()
    assert doc_payload["document_id"] == doc_id
    assert doc_payload["generated_count"] == 1
    assert doc_payload["overwrote_existing"] is True
