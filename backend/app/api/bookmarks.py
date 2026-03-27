from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_db_session, require_document_owner
from app.auth import get_current_user
from app.models import Document, Slide, SlideBookmark, User
from app.schemas import (
    BookmarkCreateRequest,
    BookmarkDeleteResponse,
    BookmarkListResponse,
    BookmarkRead,
)

router = APIRouter(prefix="/api/v1/bookmarks", tags=["bookmarks"])


def _get_document_or_404(session: Session, document_id: str) -> Document:
    doc = session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _serialize_bookmark(bm: SlideBookmark) -> BookmarkRead:
    return BookmarkRead(
        id=bm.id,
        document_id=bm.document_id,
        slide_id=bm.slide_id,
        page_num=bm.page_num,
        tag=bm.tag,
        note=bm.note,
        created_at=bm.created_at,
    )


@router.get("/{document_id}", response_model=BookmarkListResponse)
def list_bookmarks(
    document_id: str,
    tag: str | None = None,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_db_session),
) -> BookmarkListResponse:
    require_document_owner(document_id, current_user.id, session)
    query = select(SlideBookmark).where(SlideBookmark.document_id == document_id)
    if tag:
        query = query.where(SlideBookmark.tag == tag)
    query = query.order_by(SlideBookmark.page_num, SlideBookmark.tag)
    bookmarks = session.exec(query).all()
    return BookmarkListResponse(
        document_id=document_id,
        bookmarks=[_serialize_bookmark(bm) for bm in bookmarks],
    )


@router.post("", response_model=BookmarkRead)
def create_bookmark(
    payload: BookmarkCreateRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_db_session),
) -> BookmarkRead:
    slide = session.get(Slide, payload.slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")
    require_document_owner(slide.document_id, current_user.id, session)

    # Check duplicate (same slide + same tag)
    existing = session.exec(
        select(SlideBookmark)
        .where(SlideBookmark.slide_id == payload.slide_id)
        .where(SlideBookmark.tag == payload.tag)
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Bookmark already exists for this slide and tag")

    bookmark = SlideBookmark(
        document_id=slide.document_id,
        slide_id=slide.id,
        page_num=slide.page_num,
        tag=payload.tag,
        note=payload.note,
    )
    session.add(bookmark)
    session.commit()
    session.refresh(bookmark)
    return _serialize_bookmark(bookmark)


@router.delete("/{bookmark_id}", response_model=BookmarkDeleteResponse)
def delete_bookmark(
    bookmark_id: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_db_session),
) -> BookmarkDeleteResponse:
    bookmark = session.get(SlideBookmark, bookmark_id)
    if not bookmark:
        raise HTTPException(status_code=404, detail="Bookmark not found")
    require_document_owner(bookmark.document_id, current_user.id, session)
    session.delete(bookmark)
    session.commit()
    return BookmarkDeleteResponse(id=bookmark_id, deleted=True)
