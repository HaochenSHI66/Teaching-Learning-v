from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.models import LearningSession, ReviewItem
from app.schemas import ReviewCompleteResponse, ReviewItemRead, ReviewQueueResponse
from app.services.sm2 import SM2State, sm2_next

router = APIRouter(prefix="/api/v1/review", tags=["review"])


class ReviewCompleteRequest(BaseModel):
    quality: int = Field(default=4, ge=0, le=5, description="SM-2 quality rating 0-5")


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
                repetitions=item.repetitions,
                interval_days=item.interval_days,
                easiness=item.easiness,
            )
            for item in items
        ],
    )


@router.post("/{review_id}/complete", response_model=ReviewCompleteResponse)
def complete_review_item(
    review_id: str,
    payload: ReviewCompleteRequest = ReviewCompleteRequest(),
    session: Session = Depends(get_db_session),
) -> ReviewCompleteResponse:
    item = session.get(ReviewItem, review_id)
    if not item:
        raise HTTPException(status_code=404, detail="Review item not found")

    state = SM2State(
        repetitions=item.repetitions,
        interval_days=item.interval_days,
        easiness=item.easiness,
    )
    new_state, next_due = sm2_next(state, payload.quality)

    item.repetitions = new_state.repetitions
    item.interval_days = new_state.interval_days
    item.easiness = new_state.easiness
    item.due_at = next_due

    if payload.quality >= 3:
        item.status = "completed"
    else:
        # Failed recall: keep pending, re-queue with short interval
        item.status = "pending"

    session.add(item)
    session.commit()

    return ReviewCompleteResponse(id=item.id, status=item.status)
