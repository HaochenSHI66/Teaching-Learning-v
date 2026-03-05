from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.models import LearningSession, Note, Slide
from app.schemas import NotesExportRequest, NotesExportResponse
from app.services.notes_exporter import build_markdown

router = APIRouter(prefix="/api/v1/notes", tags=["notes"])


@router.post("/export", response_model=NotesExportResponse)
def export_notes_markdown(
    payload: NotesExportRequest,
    session: Session = Depends(get_db_session),
) -> NotesExportResponse:
    learning_session = session.get(LearningSession, payload.session_id)
    if not learning_session:
        raise HTTPException(status_code=404, detail="Session not found")

    query = (
        select(Note, Slide)
        .where(Note.session_id == payload.session_id)
        .join(Slide, Slide.id == Note.slide_id, isouter=True)
    )
    rows = session.exec(query).all()

    notes_by_slide: list[tuple[int, str]] = []
    for note, slide in rows:
        page_num = slide.page_num if slide else 0
        notes_by_slide.append((page_num, note.content_md))

    markdown = build_markdown(title=payload.title, notes_by_slide=notes_by_slide)
    return NotesExportResponse(title=payload.title, markdown=markdown)
