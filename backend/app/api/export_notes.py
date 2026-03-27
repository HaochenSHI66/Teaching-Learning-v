"""API endpoints for exporting styled study notes."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlmodel import Session

from app.api.deps import get_db_session, require_document_owner
from app.auth import get_current_user
from app.models import User
from app.schemas import (
    ExportNotesPreviewResponse,
    ExportNotesRequest,
    ExportNotesStyle,
    ExportNotesStylesResponse,
)
from app.services.notes_renderer import (
    STYLE_META,
    gather_export_data,
    render_notes_html,
    render_notes_pdf,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/export-notes", tags=["export-notes"])


@router.get("/styles", response_model=ExportNotesStylesResponse)
def list_styles():
    """Return available note export styles."""
    return ExportNotesStylesResponse(
        styles=[ExportNotesStyle(**s) for s in STYLE_META]
    )


@router.post("/{document_id}/preview", response_model=ExportNotesPreviewResponse)
def preview_notes(
    document_id: str,
    body: ExportNotesRequest,
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """Generate HTML preview of the styled notes."""
    require_document_owner(document_id, current_user.id, db)
    data = gather_export_data(
        db,
        document_id,
        include_images=body.include_images,
        include_explanations=body.include_explanations,
        include_key_terms=body.include_key_terms,
        include_knowledge_map=body.include_knowledge_map,
        include_flashcards=body.include_flashcards,
    )

    base_url = str(request.base_url).rstrip("/")
    html = render_notes_html(data, style=body.style, base_url=base_url)

    return ExportNotesPreviewResponse(
        html=html,
        title=data["title"],
        page_count=data.get("page_count", 0),
        concept_count=data.get("concept_count", 0),
    )


@router.post("/{document_id}/download")
def download_notes(
    document_id: str,
    body: ExportNotesRequest,
    request: Request,
    db: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
):
    """Generate and download the styled notes as PDF or HTML file."""
    require_document_owner(document_id, current_user.id, db)
    data = gather_export_data(
        db,
        document_id,
        include_images=body.include_images,
        include_explanations=body.include_explanations,
        include_key_terms=body.include_key_terms,
        include_knowledge_map=body.include_knowledge_map,
        include_flashcards=body.include_flashcards,
    )

    base_url = str(request.base_url).rstrip("/")
    html = render_notes_html(data, style=body.style, base_url=base_url)
    title = data["title"]

    if body.format == "pdf":
        pdf_bytes = render_notes_pdf(html)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{title}-notes.pdf"'
            },
        )
    else:
        return Response(
            content=html.encode("utf-8"),
            media_type="text/html; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{title}-notes.html"'
            },
        )
