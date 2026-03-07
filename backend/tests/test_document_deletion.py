from pathlib import Path

import fitz
from fastapi.testclient import TestClient

from app.main import create_app


def _two_page_pdf_bytes() -> bytes:
    document = fitz.open()
    first_page = document.new_page(width=1000, height=700)
    first_page.insert_text((64, 100), "Systems Design: queue, cache, worker", fontsize=24)
    second_page = document.new_page(width=1000, height=700)
    second_page.insert_text((64, 100), "Operating Systems: scheduler, mutex, deadlock", fontsize=24)
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


def test_delete_document_removes_records_and_storage(tmp_path: Path) -> None:
    storage_dir = tmp_path / "storage"
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=storage_dir,
    )
    client = TestClient(app)

    upload_resp = client.post(
        "/api/v1/documents/upload",
        files={"file": ("deck.pdf", _two_page_pdf_bytes(), "application/pdf")},
    )
    assert upload_resp.status_code == 202
    document_id = upload_resp.json()["document"]["id"]

    _wait_until_ready(client, document_id)

    document_storage_dir = storage_dir / document_id
    assert document_storage_dir.exists()

    delete_resp = client.delete(f"/api/v1/documents/{document_id}")
    assert delete_resp.status_code == 200
    assert delete_resp.json()["id"] == document_id
    assert delete_resp.json()["deleted"] is True

    list_resp = client.get("/api/v1/documents")
    assert list_resp.status_code == 200
    assert all(item["id"] != document_id for item in list_resp.json()["documents"])

    status_resp = client.get(f"/api/v1/documents/{document_id}/status")
    assert status_resp.status_code == 404

    slides_resp = client.get(f"/api/v1/documents/{document_id}/slides")
    assert slides_resp.status_code == 404

    assert not document_storage_dir.exists()
