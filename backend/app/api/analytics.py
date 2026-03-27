from __future__ import annotations

from collections import Counter

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_db_session, require_session_owner
from app.auth import get_current_user
from app.models import LearningSession, Message, Quiz, QuizAttempt, User
from app.schemas import HotSlideStat, SessionAnalyticsResponse

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


@router.get("/{session_id}", response_model=SessionAnalyticsResponse)
def get_session_analytics(
    session_id: str,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> SessionAnalyticsResponse:
    require_session_owner(session_id, current_user.id, session)

    messages = session.exec(select(Message).where(Message.session_id == session_id)).all()
    user_messages = sum(1 for message in messages if message.role == "user")
    assistant_messages = sum(1 for message in messages if message.role == "assistant")

    slide_counter: Counter[str] = Counter()
    for message in messages:
        if message.slide_id:
            slide_counter[message.slide_id] += 1

    quizzes = session.exec(select(Quiz).where(Quiz.session_id == session_id)).all()
    quiz_ids = [quiz.id for quiz in quizzes]

    attempts: list[QuizAttempt] = []
    if quiz_ids:
        attempts = session.exec(select(QuizAttempt).where(QuizAttempt.quiz_id.in_(quiz_ids))).all()

    quiz_attempts = len(attempts)
    avg_score_percent = 0
    if attempts:
        aggregate = 0
        for attempt in attempts:
            if attempt.total > 0:
                aggregate += int(round((attempt.score / attempt.total) * 100))
        avg_score_percent = int(round(aggregate / len(attempts)))

    hot_slides = [
        HotSlideStat(slide_id=slide_id, message_count=count)
        for slide_id, count in slide_counter.most_common(5)
    ]

    return SessionAnalyticsResponse(
        session_id=session_id,
        user_messages=user_messages,
        assistant_messages=assistant_messages,
        quiz_attempts=quiz_attempts,
        avg_quiz_score_percent=avg_score_percent,
        hot_slides=hot_slides,
    )
