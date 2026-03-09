from pathlib import Path

import fitz
import logging
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import SlideExplanation
from app.services.explanation_engine import CURRENT_EXPLANATION_VERSION
from app.services.note_prompts import build_notebook_fallback


def _two_page_pdf_bytes() -> bytes:
    document = fitz.open()
    p1 = document.new_page(width=1000, height=700)
    p1.insert_text((64, 100), "Calculus: derivative, gradient, chain rule", fontsize=24)
    p1.insert_text((64, 160), "- Derivative measures local rate of change", fontsize=20)
    p2 = document.new_page(width=1000, height=700)
    p2.insert_text((64, 100), "Linear Algebra: matrix rank and eigenvectors", fontsize=24)
    p2.insert_text((64, 160), "- Rank measures independent directions", fontsize=20)
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


def _upload_ready_document(client: TestClient) -> str:
    upload_resp = client.post(
        "/api/v1/documents/upload",
        files={"file": ("deck.pdf", _two_page_pdf_bytes(), "application/pdf")},
    )
    assert upload_resp.status_code == 202
    document_id = upload_resp.json()["document"]["id"]
    _wait_until_ready(client, document_id)
    return document_id


def test_get_document_notebook_returns_default_template(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)
    document_id = _upload_ready_document(client)

    response = client.get(f"/api/v1/notebooks/{document_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["document_id"] == document_id
    assert payload["exists"] is False
    assert payload["markdown"].startswith("# deck.pdf 笔记本")


def test_save_document_notebook_persists_content(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)
    document_id = _upload_ready_document(client)

    save_resp = client.put(
        f"/api/v1/notebooks/{document_id}",
        json={"markdown": "# deck.pdf 笔记本\n\n## 第 1 页 · Calculus\n\n- 手动笔记"},
    )
    assert save_resp.status_code == 200
    assert save_resp.json()["exists"] is True

    fetch_resp = client.get(f"/api/v1/notebooks/{document_id}")
    assert fetch_resp.status_code == 200
    payload = fetch_resp.json()
    assert payload["exists"] is True
    assert "手动笔记" in payload["markdown"]


def test_autogen_document_notebook_uses_cached_explanations_without_regeneration(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)
    document_id = _upload_ready_document(client)

    with TestClient(app) as stateful_client:
        before_resp = stateful_client.get(f"/api/v1/documents/{document_id}/explanations")
        assert before_resp.status_code == 200
        before_explanations = before_resp.json()["explanations"]
        before_versions = [item.get("meta") for item in before_explanations]

        auto_resp = stateful_client.post(
            f"/api/v1/notebooks/{document_id}/autogen",
            json={"title": "自动笔记"},
        )
        assert auto_resp.status_code == 200
        markdown = auto_resp.json()["markdown"]
        assert markdown.startswith("# deck.pdf 笔记本")
        assert "<mark>" in markdown
        assert "### 核心内容" in markdown

        after_resp = stateful_client.get(f"/api/v1/documents/{document_id}/explanations")
        assert after_resp.status_code == 200
        after_explanations = after_resp.json()["explanations"]
        assert [item.get("meta") for item in after_explanations] == before_versions

    with app.state.engine.begin() as connection:
        rows = connection.exec_driver_sql(
            "SELECT version FROM slideexplanation WHERE document_id = ? ORDER BY page_num",
            (document_id,),
        ).fetchall()
    assert [row[0] for row in rows]
    assert all(row[0] == CURRENT_EXPLANATION_VERSION for row in rows)


def test_export_document_notebook_returns_saved_markdown(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)
    document_id = _upload_ready_document(client)

    save_resp = client.put(
        f"/api/v1/notebooks/{document_id}",
        json={"markdown": "# deck.pdf 笔记本\n\n## 第 2 页 · Linear Algebra\n\n<mark>Rank</mark> 是关键量。"},
    )
    assert save_resp.status_code == 200

    export_resp = client.post(f"/api/v1/notebooks/{document_id}/export")
    assert export_resp.status_code == 200
    payload = export_resp.json()
    assert payload["title"] == "deck.pdf 笔记本"
    assert "<mark>Rank</mark>" in payload["markdown"]


def test_save_document_notebook_requires_markdown_field(tmp_path: Path) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)
    document_id = _upload_ready_document(client)

    response = client.put(f"/api/v1/notebooks/{document_id}", json={})

    assert response.status_code == 422


def test_autogen_document_notebook_logs_warning_and_falls_back_on_model_error(
    tmp_path: Path, monkeypatch, caplog
) -> None:
    app = create_app(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        storage_dir=tmp_path / "storage",
    )
    client = TestClient(app)
    document_id = _upload_ready_document(client)

    class FailingGateway:
        def __init__(self, *args, **kwargs) -> None:
            pass

        def is_configured(self) -> bool:
            return True

        def generate_text_markdown(self, *, prompt: str) -> str:
            raise RuntimeError("gateway boom")

    monkeypatch.setattr("app.api.notebooks.ModelGateway", FailingGateway)

    with caplog.at_level(logging.WARNING):
        response = client.post(
            f"/api/v1/notebooks/{document_id}/autogen",
            json={"title": "自动笔记"},
        )

    assert response.status_code == 200
    assert "<mark>" in response.json()["markdown"]
    assert any("autogen notebook failed" in record.message for record in caplog.records)


def test_build_notebook_fallback_strips_existing_mark_tags() -> None:
    explanation = SlideExplanation(
        document_id="doc-1",
        slide_id="slide-1",
        page_num=1,
        markdown="## Derivative\n\n### 完整翻译与解释\n\n<mark>导数（Derivative）</mark> 表示变化率。",
        meta={
            "sections": {
                "translation_md": "### 完整翻译与解释\n\n<mark>导数（Derivative）</mark> 表示变化率。",
                "primary_md": "### 知识点总结\n\n<mark>导数（Derivative）</mark> 是本页核心术语。",
            }
        },
        version=CURRENT_EXPLANATION_VERSION,
    )

    markdown = build_notebook_fallback(filename="deck.pdf", explanations=[explanation])

    assert "<mark><mark>" not in markdown
    assert markdown.count("<mark>") == markdown.count("</mark>")
