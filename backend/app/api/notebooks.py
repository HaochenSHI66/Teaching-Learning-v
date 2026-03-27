from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.deps import get_db_session, require_document_owner
from app.auth import get_current_user
from app.models import Document, DocumentNotebook, SlideExplanation, User
from app.schemas import (
    DocumentNotebookAutoGenerateRequest,
    DocumentNotebookExportResponse,
    DocumentNotebookRead,
    DocumentNotebookSaveRequest,
)
from app.services.explanation_engine import (
    CURRENT_EXPLANATION_VERSION,
    explanation_markdown_is_stale,
    explanation_meta_is_current,
)
from app.services.model_gateway import ModelGateway
from app.services.note_prompts import (
    build_autogen_notes_prompt,
    build_notebook_fallback,
    default_notebook_markdown,
)

router = APIRouter(prefix="/api/v1/notebooks", tags=["notebooks"])
logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_document_or_404(session: Session, document_id: str) -> Document:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return document


def _get_notebook(session: Session, document_id: str) -> DocumentNotebook | None:
    return session.exec(
        select(DocumentNotebook).where(DocumentNotebook.document_id == document_id)
    ).first()


def _serialize_notebook(
    *,
    document_id: str,
    markdown: str,
    exists: bool,
    updated_at: datetime | None,
) -> DocumentNotebookRead:
    return DocumentNotebookRead(
        document_id=document_id,
        markdown=markdown,
        exists=exists,
        updated_at=updated_at,
    )


def _current_explanations_only(items: list[SlideExplanation]) -> list[SlideExplanation]:
    return [
        item
        for item in items
        if int(getattr(item, "version", 0) or 0) == CURRENT_EXPLANATION_VERSION
        and not explanation_markdown_is_stale(item.markdown)
        and explanation_meta_is_current(getattr(item, "meta", None))
    ]


def _generate_notebook_markdown(
    *,
    document: Document,
    explanations: list[SlideExplanation],
    title: str,
) -> str:
    gateway = ModelGateway(timeout=8.0)
    prompt = build_autogen_notes_prompt(
        filename=document.filename,
        explanations=explanations,
        title=title,
    )
    if gateway.is_configured():
        try:
            generated = gateway.generate_text_markdown(prompt=prompt).strip()
            if generated.startswith("# ") and "<mark>" in generated:
                return generated if generated.endswith("\n") else f"{generated}\n"
        except Exception as exc:
            logger.warning("autogen notebook failed: %s", exc)
    return build_notebook_fallback(filename=document.filename, explanations=explanations)


def _persist_notebook(
    *,
    session: Session,
    document_id: str,
    markdown: str,
) -> DocumentNotebook:
    notebook = _get_notebook(session, document_id)
    timestamp = _utcnow()
    if not notebook:
        notebook = DocumentNotebook(document_id=document_id, content_md=markdown, updated_at=timestamp)
        session.add(notebook)
    else:
        notebook.content_md = markdown
        notebook.updated_at = timestamp
        session.add(notebook)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        notebook = _get_notebook(session, document_id)
        if notebook is None:
            raise
        notebook.content_md = markdown
        notebook.updated_at = timestamp
        session.add(notebook)
        session.commit()
    session.refresh(notebook)
    return notebook


@router.get("/{document_id}", response_model=DocumentNotebookRead)
def get_document_notebook(
    document_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_db_session),
) -> DocumentNotebookRead:
    require_document_owner(document_id, current_user.id, session)
    document = _get_document_or_404(session, document_id)
    notebook = _get_notebook(session, document_id)
    if not notebook:
        return _serialize_notebook(
            document_id=document.id,
            markdown=default_notebook_markdown(document.filename),
            exists=False,
            updated_at=None,
        )
    return _serialize_notebook(
        document_id=document.id,
        markdown=notebook.content_md,
        exists=True,
        updated_at=notebook.updated_at,
    )


@router.put("/{document_id}", response_model=DocumentNotebookRead)
def save_document_notebook(
    document_id: str,
    payload: DocumentNotebookSaveRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_db_session),
) -> DocumentNotebookRead:
    require_document_owner(document_id, current_user.id, session)
    document = _get_document_or_404(session, document_id)
    notebook = _persist_notebook(
        session=session,
        document_id=document.id,
        markdown=payload.markdown,
    )
    return _serialize_notebook(
        document_id=document.id,
        markdown=notebook.content_md,
        exists=True,
        updated_at=notebook.updated_at,
    )


@router.post("/{document_id}/autogen", response_model=DocumentNotebookRead)
def autogen_document_notebook(
    document_id: str,
    payload: DocumentNotebookAutoGenerateRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_db_session),
) -> DocumentNotebookRead:
    require_document_owner(document_id, current_user.id, session)
    document = _get_document_or_404(session, document_id)
    explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == document.id)
        .order_by(SlideExplanation.page_num)
    ).all()
    explanations = _current_explanations_only(explanations)
    if not explanations:
        raise HTTPException(status_code=409, detail="No cached explanations available")

    markdown = _generate_notebook_markdown(
        document=document,
        explanations=explanations,
        title=payload.title,
    )
    notebook = _persist_notebook(
        session=session,
        document_id=document.id,
        markdown=markdown,
    )
    return _serialize_notebook(
        document_id=document.id,
        markdown=notebook.content_md,
        exists=True,
        updated_at=notebook.updated_at,
    )


@router.post("/{document_id}/export", response_model=DocumentNotebookExportResponse)
def export_document_notebook(
    document_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_db_session),
) -> DocumentNotebookExportResponse:
    require_document_owner(document_id, current_user.id, session)
    document = _get_document_or_404(session, document_id)
    notebook = _get_notebook(session, document.id)
    markdown = notebook.content_md if notebook else default_notebook_markdown(document.filename)
    return DocumentNotebookExportResponse(
        title=f"{document.filename} 笔记本",
        markdown=markdown,
    )
