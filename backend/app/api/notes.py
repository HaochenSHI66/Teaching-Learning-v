from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.models import LearningSession, Message, Slide, SlideExplanation
from app.schemas import NotesAutoGenerateRequest, NotesExportRequest, NotesExportResponse
from app.services.explanation_cache import build_document_explanations_markdown
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

    # Aggregate assistant messages per slide as note content
    query = (
        select(Message, Slide)
        .where(Message.session_id == payload.session_id)
        .where(Message.role == "assistant")
        .where(Message.slide_id.is_not(None))
        .join(Slide, Slide.id == Message.slide_id, isouter=True)
        .order_by(Message.created_at)
    )
    rows = session.exec(query).all()

    notes_by_slide: list[tuple[int, str]] = []
    for message, slide in rows:
        page_num = slide.page_num if slide else 0
        notes_by_slide.append((page_num, message.content))

    markdown = build_markdown(title=payload.title, notes_by_slide=notes_by_slide)
    return NotesExportResponse(title=payload.title, markdown=markdown)


@router.post("/autogen", response_model=NotesExportResponse)
def autogen_notes_from_cached_explanations(
    payload: NotesAutoGenerateRequest,
    session: Session = Depends(get_db_session),
) -> NotesExportResponse:
    learning_session = session.get(LearningSession, payload.session_id)
    if not learning_session:
        raise HTTPException(status_code=404, detail="Session not found")

    explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == learning_session.document_id)
        .order_by(SlideExplanation.page_num)
    ).all()

    if not explanations:
        raise HTTPException(status_code=409, detail="No cached explanations available")

    markdown = build_document_explanations_markdown(
        title=payload.title,
        slide_markdowns=[
            (
                f"{item.markdown.strip()}\n\n"
                "### 可补充笔记\n"
                "- [ ] 补充自己的理解\n"
                "- [ ] 记录一个易错点\n"
                "- [ ] 补一题练习题\n"
            )
            for item in explanations
        ],
    )
    return NotesExportResponse(title=payload.title, markdown=markdown)
