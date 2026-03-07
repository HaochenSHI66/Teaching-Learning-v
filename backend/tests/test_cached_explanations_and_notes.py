from pathlib import Path

import fitz
from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app
from app.models import Slide
from app.services.explanation_engine import generate_slide_explanation


def _two_page_pdf_bytes() -> bytes:
    document = fitz.open()
    p1 = document.new_page(width=1000, height=700)
    p1.insert_text((64, 100), "Calculus: derivative, gradient, chain rule", fontsize=24)
    p2 = document.new_page(width=1000, height=700)
    p2.insert_text((64, 100), "Linear Algebra: matrix rank and eigenvectors", fontsize=24)
    return document.tobytes()


def _wait_until_ready(client: TestClient, document_id: str, max_attempts: int = 20) -> None:
    for _ in range(max_attempts):
        status_resp = client.get(f"/api/v1/documents/{document_id}/status")
        assert status_resp.status_code == 200
        status = status_resp.json()["status"]
        if status == "ready":
            return
        if status == "error":
            raise AssertionError("Document processing failed")
    raise AssertionError("Timed out waiting for document readiness")


def test_list_documents_and_export_cached_explanations(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)

    upload_resp = client.post(
        "/api/v1/documents/upload",
        files={"file": ("deck.pdf", _two_page_pdf_bytes(), "application/pdf")},
    )
    assert upload_resp.status_code == 202
    document_id = upload_resp.json()["document"]["id"]

    _wait_until_ready(client, document_id)

    list_resp = client.get("/api/v1/documents")
    assert list_resp.status_code == 200
    documents = list_resp.json()["documents"]
    assert any(item["id"] == document_id for item in documents)

    explanations_resp = client.get(f"/api/v1/documents/{document_id}/explanations")
    assert explanations_resp.status_code == 200
    explanations = explanations_resp.json()["explanations"]
    assert len(explanations) == 2
    assert "[!NOTE]" in explanations[0]["markdown"]
    assert "### 核心术语 Core Terms" in explanations[0]["markdown"]
    assert "导数（Derivative）" in explanations[0]["markdown"]

    export_resp = client.get(f"/api/v1/documents/{document_id}/explanations/export")
    assert export_resp.status_code == 200
    exported_md = export_resp.json()["markdown"]
    assert "# 全部PPT讲解" in exported_md
    assert "## Slide 1" in exported_md
    assert "矩阵（Matrix）" in exported_md


def test_autogen_notes_from_cached_explanations(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)

    upload_resp = client.post(
        "/api/v1/documents/upload",
        files={"file": ("deck.pdf", _two_page_pdf_bytes(), "application/pdf")},
    )
    assert upload_resp.status_code == 202
    document_id = upload_resp.json()["document"]["id"]

    _wait_until_ready(client, document_id)

    slides_resp = client.get(f"/api/v1/documents/{document_id}/slides")
    assert slides_resp.status_code == 200
    first_slide_id = slides_resp.json()["slides"][0]["id"]

    session_resp = client.post(
        "/api/v1/sessions",
        json={"document_id": document_id, "current_slide_id": first_slide_id},
    )
    assert session_resp.status_code == 201
    session_id = session_resp.json()["id"]

    notes_resp = client.post(
        "/api/v1/notes/autogen",
        json={"session_id": session_id, "title": "自动笔记"},
    )
    assert notes_resp.status_code == 200
    markdown = notes_resp.json()["markdown"]
    assert "# 自动笔记" in markdown
    assert "## Slide 1" in markdown
    assert "### 核心术语 Core Terms" in markdown


def test_generated_explanation_does_not_embed_prompt_contract() -> None:
    slide = Slide(
        id="slide-1",
        document_id="doc-1",
        page_num=1,
        image_path="slides/slide_001.png",
        thumbnail_path="thumbnails/thumb_001.png",
        width=1600,
        height=900,
    )

    markdown, _, _ = generate_slide_explanation(
        slide=slide,
        question="总结本页",
        extracted_text="Gradient descent updates parameters using the learning rate.",
    )

    assert "Prompt Contract" not in markdown
    assert "<!--" not in markdown


def test_slide_generation_falls_back_when_gateway_fails(tmp_path: Path) -> None:
    class FailingGateway:
        def generate_slide_markdown(self, **_: object) -> str:
            raise RuntimeError("boom")

    slide = Slide(
        id="slide-1",
        document_id="doc-1",
        page_num=1,
        image_path="slides/slide_001.png",
        thumbnail_path="thumbnails/thumb_001.png",
        width=1600,
        height=900,
    )
    slide_image = tmp_path / "slide.png"
    Image.new("RGB", (400, 240), color=(245, 240, 232)).save(slide_image, format="PNG")

    markdown, follow_ups, degraded = generate_slide_explanation(
        slide=slide,
        question="总结本页",
        extracted_text="Gradient descent updates parameters using the learning rate.",
        slide_image_path=slide_image,
        extract_payload={"summary": "Gradient Descent"},
        gateway=FailingGateway(),
    )

    assert degraded is True
    assert follow_ups
    assert "Prompt Contract" not in markdown
    assert "### 核心术语 Core Terms" in markdown
