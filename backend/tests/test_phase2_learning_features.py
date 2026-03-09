from io import BytesIO
from pathlib import Path

import fitz
from fastapi.testclient import TestClient
from PIL import Image

from app.main import create_app


def _png_bytes() -> bytes:
    image = Image.new("RGB", (640, 360), color=(240, 248, 255))
    stream = BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def _two_page_pdf_bytes() -> bytes:
    document = fitz.open()

    first_page = document.new_page(width=1024, height=768)
    first_page.insert_text(
        (64, 96),
        "Linear Algebra: matrix decomposition and eigenspace basics",
        fontsize=24,
    )

    second_page = document.new_page(width=1024, height=768)
    second_page.insert_text(
        (64, 96),
        "Optimization: gradient descent convergence and step size",
        fontsize=24,
    )

    return document.tobytes()


def _create_client(tmp_path: Path) -> TestClient:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    return TestClient(app)


def test_cross_slide_retrieval_for_chat(tmp_path: Path) -> None:
    client = _create_client(tmp_path)

    upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("course.pdf", _two_page_pdf_bytes(), "application/pdf")},
    )
    assert upload.status_code == 202
    document_id = upload.json()["document"]["id"]

    slides = client.get(f"/api/v1/documents/{document_id}/slides")
    assert slides.status_code == 200
    slide_items = slides.json()["slides"]
    assert len(slide_items) == 2

    first_slide_id = slide_items[0]["id"]
    second_slide_id = slide_items[1]["id"]

    session_response = client.post(
        "/api/v1/sessions",
        json={"document_id": document_id, "current_slide_id": first_slide_id},
    )
    assert session_response.status_code == 201
    session_id = session_response.json()["id"]

    chat = client.post(
        "/api/v1/chat",
        json={
            "session_id": session_id,
            "message": "gradient descent 在这套课件里是怎么引入的？",
            "slide_id": first_slide_id,
            "mode": "slide",
        },
    )
    assert chat.status_code == 200
    payload = chat.json()
    assert first_slide_id in payload["used_slide_ids"]
    assert second_slide_id in payload["used_slide_ids"]
    assert "引用页码" in payload["answer"]
    assert "### 完整翻译与解释" in payload["answer"]
    assert (
        "### 知识点总结" in payload["answer"]
        or "### 例题完整讲解" in payload["answer"]
    )


def test_roi_explanation_endpoint(tmp_path: Path) -> None:
    client = _create_client(tmp_path)

    upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("single.png", _png_bytes(), "image/png")},
    )
    assert upload.status_code == 202
    document_id = upload.json()["document"]["id"]

    slides = client.get(f"/api/v1/documents/{document_id}/slides")
    slide_id = slides.json()["slides"][0]["id"]

    session_response = client.post(
        "/api/v1/sessions",
        json={"document_id": document_id, "current_slide_id": slide_id},
    )
    session_id = session_response.json()["id"]

    roi_response = client.post(
        "/api/v1/chat/roi",
        json={
            "session_id": session_id,
            "slide_id": slide_id,
            "message": "解释这个框里的内容",
            "roi": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        },
    )
    assert roi_response.status_code == 200
    payload = roi_response.json()
    assert payload["used_slide_ids"] == [slide_id]
    assert "区域坐标" in payload["answer"]


def test_roi_explanation_endpoint_uses_multimodal_gateway(tmp_path: Path, monkeypatch) -> None:
    client = _create_client(tmp_path)

    upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("single.png", _png_bytes(), "image/png")},
    )
    assert upload.status_code == 202
    document_id = upload.json()["document"]["id"]

    slides = client.get(f"/api/v1/documents/{document_id}/slides")
    slide_id = slides.json()["slides"][0]["id"]

    session_response = client.post(
        "/api/v1/sessions",
        json={"document_id": document_id, "current_slide_id": slide_id},
    )
    session_id = session_response.json()["id"]

    captured: dict[str, object] = {}

    class SpyGateway:
        def generate_roi_markdown(
            self,
            *,
            prompt: str,
            slide_image_path: Path,
            roi_image_path: Path,
            extraction_text: str,
        ) -> str:
            captured["prompt"] = prompt
            captured["slide_image_path"] = slide_image_path
            captured["roi_image_path"] = roi_image_path
            captured["extraction_text"] = extraction_text
            captured["slide_exists_during_call"] = slide_image_path.exists()
            captured["roi_exists_during_call"] = roi_image_path.exists()
            return "## ROI Live\n\n模型已收到整页和局部图像。"

    monkeypatch.setattr("app.services.explanation_engine.ModelGateway", lambda: SpyGateway())

    roi_response = client.post(
        "/api/v1/chat/roi",
        json={
            "session_id": session_id,
            "slide_id": slide_id,
            "message": "解释这个框里的内容",
            "roi": {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4},
        },
    )
    assert roi_response.status_code == 200
    assert roi_response.json()["answer"].startswith("## ROI Live")
    assert captured["slide_exists_during_call"] is True
    assert captured["roi_exists_during_call"] is True


def test_generate_and_grade_quiz(tmp_path: Path) -> None:
    client = _create_client(tmp_path)

    upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("course.pdf", _two_page_pdf_bytes(), "application/pdf")},
    )
    assert upload.status_code == 202
    document_id = upload.json()["document"]["id"]

    slides = client.get(f"/api/v1/documents/{document_id}/slides")
    slide_id = slides.json()["slides"][0]["id"]

    session_response = client.post(
        "/api/v1/sessions",
        json={"document_id": document_id, "current_slide_id": slide_id},
    )
    session_id = session_response.json()["id"]

    generate_response = client.post(
        "/api/v1/quizzes/generate",
        json={
            "session_id": session_id,
            "slide_id": slide_id,
            "question_count": 3,
        },
    )
    assert generate_response.status_code == 200
    generated = generate_response.json()
    assert len(generated["questions"]) == 3

    quiz_id = generated["quiz_id"]
    answers = {question["id"]: "A" for question in generated["questions"]}

    grade_response = client.post(
        f"/api/v1/quizzes/{quiz_id}/grade",
        json={"answers": answers},
    )
    assert grade_response.status_code == 200
    graded = grade_response.json()
    assert graded["total"] == 3
    assert graded["score"] == 3
    assert "掌握度" in graded["feedback"]
