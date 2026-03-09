from io import BytesIO
from pathlib import Path

import fitz
from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session, select

from app.main import create_app
from app.models import Slide, SlideExplanation, SlideExtract


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


def _repeated_pdf_bytes() -> bytes:
    document = fitz.open()

    page1 = document.new_page(width=1000, height=700)
    page1.insert_text((64, 100), "Gradient Descent", fontsize=28)
    page1.insert_text((64, 150), "- learning rate controls update size", fontsize=20)
    page1.insert_text((64, 185), "- update rule moves opposite gradient", fontsize=20)

    page2 = document.new_page(width=1000, height=700)
    page2.insert_text((64, 100), "Gradient Descent", fontsize=28)
    page2.insert_text((64, 150), "- learning rate controls update size", fontsize=20)
    page2.insert_text((64, 185), "- update rule moves opposite gradient", fontsize=20)
    page2.insert_text((64, 220), "- convergence depends on step size", fontsize=20)

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


def test_pdf_slide_extract_contains_repeat_analysis(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)

    response = client.post(
        "/api/v1/documents/upload",
        files={"file": ("repeat.pdf", _repeated_pdf_bytes(), "application/pdf")},
    )

    assert response.status_code == 202
    doc_id = response.json()["document"]["id"]

    slides_response = client.get(f"/api/v1/documents/{doc_id}/slides")
    assert slides_response.status_code == 200
    slides = slides_response.json()["slides"]
    assert len(slides) == 2

    repeat_analysis = slides[1]["extract"]["repeat_analysis"]
    assert repeat_analysis["status"] == "ready"
    assert repeat_analysis["repeat_pages"] == [1]
    assert repeat_analysis["repeated_ratio"] > 0
    assert repeat_analysis["repeated_block_ids"]
    assert repeat_analysis["new_block_ids"]


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


def test_slides_endpoint_refreshes_legacy_extracts_and_hides_stale_explanations(tmp_path: Path) -> None:
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

    with Session(app.state.engine) as session:
        slide = session.exec(select(Slide).where(Slide.document_id == doc_id)).first()
        assert slide is not None

        extract = session.exec(select(SlideExtract).where(SlideExtract.slide_id == slide.id)).first()
        assert extract is not None
        extract.payload = {
            "page_num": slide.page_num,
            "text": "Gradient Descent",
            "summary": "Gradient Descent",
        }

        explanation = session.exec(
            select(SlideExplanation).where(SlideExplanation.slide_id == slide.id)
        ).first()
        assert explanation is not None
        explanation.markdown = "## Slide 标题\n\n旧缓存"

        session.add(extract)
        session.add(explanation)
        session.commit()

    slides_response = client.get(f"/api/v1/documents/{doc_id}/slides")
    assert slides_response.status_code == 200
    slide_payload = slides_response.json()["slides"][0]

    assert slide_payload["extract"]["text_blocks"]
    assert slide_payload["explanation_state"] == "not_generated"

    explanations_response = client.get(f"/api/v1/documents/{doc_id}/explanations")
    assert explanations_response.status_code == 200
    assert explanations_response.json()["explanations"] == []


def test_folder_library_create_move_and_delete(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)

    calculus_upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("calculus.pdf", _pdf_bytes(), "application/pdf")},
    )
    assert calculus_upload.status_code == 202
    calculus_doc_id = calculus_upload.json()["document"]["id"]

    algebra_upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("algebra.pdf", _pdf_bytes(), "application/pdf")},
    )
    assert algebra_upload.status_code == 202
    algebra_doc_id = algebra_upload.json()["document"]["id"]

    initial_library = client.get("/api/v1/folders")
    assert initial_library.status_code == 200
    initial_payload = initial_library.json()
    assert [doc["id"] for doc in initial_payload["uncategorized"]["documents"]] == [
        calculus_doc_id,
        algebra_doc_id,
    ]
    assert initial_payload["folders"] == []

    create_folder = client.post(
        "/api/v1/folders",
        json={"name": "Calculus", "color": "oat"},
    )
    assert create_folder.status_code == 201
    folder_id = create_folder.json()["folder"]["id"]

    move_doc = client.post(
        "/api/v1/folders/move-document",
        json={"document_id": calculus_doc_id, "target_folder_id": folder_id, "target_index": 0},
    )
    assert move_doc.status_code == 200
    moved_payload = move_doc.json()
    assert moved_payload["document"]["id"] == calculus_doc_id
    assert moved_payload["document"]["folder_id"] == folder_id

    renamed = client.patch(f"/api/v1/folders/{folder_id}", json={"name": "Advanced Calculus"})
    assert renamed.status_code == 200
    assert renamed.json()["folder"]["name"] == "Advanced Calculus"

    library_after_move = client.get("/api/v1/folders")
    assert library_after_move.status_code == 200
    library_payload = library_after_move.json()
    assert library_payload["folders"][0]["name"] == "Advanced Calculus"
    assert [doc["id"] for doc in library_payload["folders"][0]["documents"]] == [calculus_doc_id]
    assert [doc["id"] for doc in library_payload["uncategorized"]["documents"]] == [algebra_doc_id]

    move_back = client.post(
        "/api/v1/folders/move-document",
        json={"document_id": calculus_doc_id, "target_folder_id": None, "target_index": 1},
    )
    assert move_back.status_code == 200

    delete_folder = client.delete(f"/api/v1/folders/{folder_id}")
    assert delete_folder.status_code == 200
    assert delete_folder.json()["deleted"] is True

    final_library = client.get("/api/v1/folders")
    assert final_library.status_code == 200
    final_payload = final_library.json()
    assert final_payload["folders"] == []
    assert [doc["id"] for doc in final_payload["uncategorized"]["documents"]] == [
        algebra_doc_id,
        calculus_doc_id,
    ]
