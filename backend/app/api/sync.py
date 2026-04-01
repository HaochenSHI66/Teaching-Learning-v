from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.auth import get_current_user
from app.models import Document, User
from app.services.explanation_engine import CURRENT_EXPLANATION_VERSION
from app.services.slide_processor import CURRENT_EXTRACT_SCHEMA_VERSION

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


@router.get("/manifest")
def get_sync_manifest(
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    documents = session.exec(
        select(Document).where(Document.user_id == current_user.id)
    ).all()

    return {
        "schema": {
            "explanation_version": CURRENT_EXPLANATION_VERSION,
            "extract_version": CURRENT_EXTRACT_SCHEMA_VERSION,
        },
        "documents": {
            doc.id: {
                "version": doc.content_version or 1,
                "page_count": doc.page_count,
                "filename": doc.filename,
            }
            for doc in documents
        },
    }
