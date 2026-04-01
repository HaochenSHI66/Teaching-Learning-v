"""Bootstrap endpoint: returns all data needed to render the main page in ONE request.

Combines: folder library + first document's slides + first document's explanations.
Eliminates 3-4 sequential round trips through Cloudflare Tunnel.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.auth import get_current_user
from app.api.folders import _build_library
from app.models import Document, Slide, SlideExplanation, SlideExtract, User

router = APIRouter(prefix="/api/v1/bootstrap", tags=["bootstrap"])


class BootstrapSlide(BaseModel):
    id: str
    page_num: int
    image_url: str
    thumbnail_url: str
    width: int
    height: int
    explanation_state: str
    extract: dict | None = None


class BootstrapExplanation(BaseModel):
    slide_id: str
    page_num: int
    markdown: str
    meta: dict | None = None


class BootstrapResponse(BaseModel):
    """Everything the frontend needs on first load."""
    folders: dict  # FolderLibraryResponse as dict
    first_document: BootstrapFirstDocument | None = None


class BootstrapFirstDocument(BaseModel):
    document_id: str
    content_version: int
    slides: list[BootstrapSlide]


def _explanation_is_current(exp: SlideExplanation | None) -> bool:
    if not exp or not exp.markdown:
        return False
    return True


@router.get("", response_model=BootstrapResponse)
def get_bootstrap_data(
    request: Request,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> BootstrapResponse:
    # 1. Folder library
    library = _build_library(session, current_user.id)

    # 2. Find first document (first doc in first folder, or first uncategorized)
    first_doc_id: str | None = None
    for folder in library.folders:
        if folder.documents:
            first_doc_id = folder.documents[0].id
            break
    if not first_doc_id and library.uncategorized.documents:
        first_doc_id = library.uncategorized.documents[0].id

    first_document = None
    if first_doc_id:
        document = session.get(Document, first_doc_id)
        if document and document.status == "ready":
            # Slides
            slides_db = session.exec(
                select(Slide)
                .where(Slide.document_id == first_doc_id)
                .order_by(Slide.page_num)
            ).all()

            # Only check which slides have explanations (don't send full content — too large)
            explanations_db = session.exec(
                select(SlideExplanation.slide_id)
                .where(SlideExplanation.document_id == first_doc_id)
            ).all()
            explanation_set = set(explanations_db)

            # Extract payloads (keyed by slide_id)
            slide_ids = [s.id for s in slides_db]
            extract_db = session.exec(
                select(SlideExtract)
                .where(SlideExtract.slide_id.in_(slide_ids))  # type: ignore[attr-defined]
            ).all() if slide_ids else []
            extract_map = {e.slide_id: e for e in extract_db}

            slides = []
            for slide in slides_db:
                extract = extract_map.get(slide.id)
                slides.append(BootstrapSlide(
                    id=slide.id,
                    page_num=slide.page_num,
                    image_url=f"/storage/{first_doc_id}/{slide.image_path}",
                    thumbnail_url=f"/storage/{first_doc_id}/{slide.thumbnail_path}",
                    width=slide.width,
                    height=slide.height,
                    explanation_state="ready" if slide.id in explanation_set else "not_generated",
                    extract=extract.payload if extract and extract.payload else None,
                ))

            first_document = BootstrapFirstDocument(
                document_id=first_doc_id,
                content_version=document.content_version or 1,
                slides=slides,
            )

    return BootstrapResponse(
        folders=library.model_dump(),
        first_document=first_document,
    )
