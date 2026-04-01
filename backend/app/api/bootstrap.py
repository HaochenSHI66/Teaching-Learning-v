from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.auth import get_current_user
from app.models import Document, LearningSession, Slide, SlideExplanation, User
from app.schemas import (
    DocumentCacheBundleRead,
    SlideExplanationRead,
    SlideRead,
)

router = APIRouter(prefix="/api/v1/bootstrap", tags=["bootstrap"])


# ── Schemas ───────────────────────────────────────────────────────

class BootstrapFirstDocument(BaseModel):
    document_id: str
    filename: str
    content_version: int
    page_count: int
    status: str
    created_at: datetime


class BootstrapResponse(BaseModel):
    first_document: BootstrapFirstDocument | None = None


# ── Endpoint ──────────────────────────────────────────────────────

@router.get("", response_model=BootstrapResponse)
def get_bootstrap(
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> BootstrapResponse:
    """Return the user's most-recently-created document for fast initial load."""
    document = session.exec(
        select(Document)
        .where(Document.user_id == current_user.id)
        .where(Document.status == "ready")
        .order_by(Document.created_at.desc())
    ).first()

    if not document:
        return BootstrapResponse(first_document=None)

    first_document = BootstrapFirstDocument(
        document_id=document.id,
        filename=document.filename,
        content_version=document.content_version or 1,
        page_count=document.page_count,
        status=document.status,
        created_at=document.created_at,
    )

    return BootstrapResponse(first_document=first_document)
