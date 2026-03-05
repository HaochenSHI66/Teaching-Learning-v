from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.models import LearningSession, ReviewItem
from app.schemas import ReviewCompleteResponse, ReviewItemRead, ReviewQueueResponse

router = APIRouter(prefix="/api/v1/review", tags=["review"])


@router.get("/{session_id}/queue", response_model=ReviewQueueResponse)
def get_review_queue(
    session_id: str,
    limit: int = 20,
    session: Session = Depends(get_db_session),
) -> ReviewQueueResponse:
    learning_session = session.get(LearningSession, session_id)
    if not learning_session:
        raise HTTPException(status_code=404, detail="Session not found")

    query = (
        select(ReviewItem)
        .where(ReviewItem.session_id == session_id)
        .where(ReviewItem.status == "pending")
        .order_by(ReviewItem.due_at, ReviewItem.created_at)
        .limit(max(1, min(limit, 200)))
    )
    items = session.exec(query).all()

    return ReviewQueueResponse(
        session_id=session_id,
        items=[
            ReviewItemRead(
                id=item.id,
                session_id=item.session_id,
                slide_id=item.slide_id,
                source_ref=item.source_ref,
                prompt=item.prompt,
                due_at=item.due_at,
                status=item.status,
            )
            for item in items
        ],
    )


@router.post("/{review_id}/complete", response_model=ReviewCompleteResponse)
def complete_review_item(
    review_id: str,
    session: Session = Depends(get_db_session),
) -> ReviewCompleteResponse:
    item = session.get(ReviewItem, review_id)
    if not item:
        raise HTTPException(status_code=404, detail="Review item not found")

    item.status = "completed"
    session.add(item)
    session.commit()

    return ReviewCompleteResponse(id=item.id, status=item.status)
