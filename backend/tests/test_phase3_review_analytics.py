from pathlib import Path

import fitz
from fastapi.testclient import TestClient

from app.main import create_app


def _two_page_pdf_bytes() -> bytes:
    document = fitz.open()

    first_page = document.new_page(width=900, height=700)
    first_page.insert_text((64, 96), "Statistics: variance and expectation", fontsize=22)

    second_page = document.new_page(width=900, height=700)
    second_page.insert_text((64, 96), "ML: bias variance tradeoff and generalization", fontsize=22)

    return document.tobytes()


def _create_client(tmp_path: Path) -> TestClient:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    return TestClient(app)


def test_review_queue_and_learning_analytics(tmp_path: Path) -> None:
    client = _create_client(tmp_path)

    upload = client.post(
        "/api/v1/documents/upload",
        files={"file": ("course.pdf", _two_page_pdf_bytes(), "application/pdf")},
    )
    assert upload.status_code == 201
    document_id = upload.json()["document"]["id"]

    slides = client.get(f"/api/v1/documents/{document_id}/slides")
    slide_id = slides.json()["slides"][0]["id"]

    session_response = client.post(
        "/api/v1/sessions",
        json={"document_id": document_id, "current_slide_id": slide_id},
    )
    session_id = session_response.json()["id"]

    chat = client.post(
        "/api/v1/chat",
        json={
            "session_id": session_id,
            "message": "variance 和 expectation 有什么联系？",
            "slide_id": slide_id,
            "mode": "slide",
        },
    )
    assert chat.status_code == 200

    generate_response = client.post(
        "/api/v1/quizzes/generate",
        json={"session_id": session_id, "slide_id": slide_id, "question_count": 3},
    )
    quiz = generate_response.json()
    answers = {question["id"]: "B" for question in quiz["questions"]}

    grade_response = client.post(
        f"/api/v1/quizzes/{quiz['quiz_id']}/grade",
        json={"answers": answers},
    )
    assert grade_response.status_code == 200

    queue_response = client.get(f"/api/v1/review/{session_id}/queue")
    assert queue_response.status_code == 200
    queue = queue_response.json()
    assert len(queue["items"]) == 3

    first_item_id = queue["items"][0]["id"]
    complete_response = client.post(f"/api/v1/review/{first_item_id}/complete")
    assert complete_response.status_code == 200
    assert complete_response.json()["status"] == "completed"

    analytics_response = client.get(f"/api/v1/analytics/{session_id}")
    assert analytics_response.status_code == 200
    analytics = analytics_response.json()
    assert analytics["quiz_attempts"] == 1
    assert analytics["user_messages"] >= 1
    assert analytics["assistant_messages"] >= 1
    assert analytics["avg_quiz_score_percent"] == 0
    assert analytics["hot_slides"][0]["slide_id"] == slide_id
