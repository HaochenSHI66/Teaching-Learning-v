from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_db_session, require_session_owner
from app.auth import get_current_user
from app.models import LearningSession, Quiz, QuizAttempt, ReviewItem, Slide, SlideExtract, User
from app.schemas import (
    QuizGenerateRequest,
    QuizGenerateResponse,
    QuizGradeRequest,
    QuizGradeResponse,
    QuizQuestion,
    QuizGradeResult,
)
from app.services.quiz_engine import generate_quiz, grade_quiz

router = APIRouter(prefix="/api/v1/quizzes", tags=["quizzes"])


@router.post("/generate", response_model=QuizGenerateResponse)
def generate_slide_quiz(
    payload: QuizGenerateRequest,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> QuizGenerateResponse:
    require_session_owner(payload.session_id, current_user.id, session)
    learning_session = session.get(LearningSession, payload.session_id)
    if not learning_session:
        raise HTTPException(status_code=404, detail="Session not found")

    slide = session.get(Slide, payload.slide_id)
    if not slide or slide.document_id != learning_session.document_id:
        raise HTTPException(status_code=400, detail="Slide not found in session document")

    extract = session.exec(select(SlideExtract).where(SlideExtract.slide_id == slide.id)).first()
    source_text = ""
    if extract and isinstance(extract.payload, dict):
        source_text = str(extract.payload.get("text", ""))

    questions, answer_key = generate_quiz(
        page_num=slide.page_num,
        source_text=source_text,
        question_count=payload.question_count,
    )

    quiz = Quiz(
        session_id=learning_session.id,
        slide_id=slide.id,
        questions=questions,
        answer_key=answer_key,
    )
    session.add(quiz)
    session.commit()
    session.refresh(quiz)

    return QuizGenerateResponse(
        quiz_id=quiz.id,
        slide_id=slide.id,
        questions=[QuizQuestion(**question) for question in questions],
    )


@router.post("/{quiz_id}/grade", response_model=QuizGradeResponse)
def grade_slide_quiz(
    quiz_id: str,
    payload: QuizGradeRequest,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> QuizGradeResponse:
    quiz = session.get(Quiz, quiz_id)
    if not quiz:
        raise HTTPException(status_code=404, detail="Quiz not found")
    require_session_owner(quiz.session_id, current_user.id, session)

    score, total, feedback, results = grade_quiz(answer_key=quiz.answer_key, answers=payload.answers)

    attempt = QuizAttempt(
        quiz_id=quiz.id,
        answers=payload.answers,
        score=score,
        total=total,
        feedback=feedback,
        detail=results,
    )
    session.add(attempt)

    question_map = {item.get("id"): item.get("prompt", "") for item in quiz.questions}
    for result in results:
        if result["is_correct"]:
            continue
        question_id = result["question_id"]
        prompt = question_map.get(question_id, f"复习题 {question_id}")
        session.add(
            ReviewItem(
                session_id=quiz.session_id,
                slide_id=quiz.slide_id,
                source_ref=f"{quiz.id}:{question_id}",
                prompt=prompt,
                due_at=datetime.now(timezone.utc) + timedelta(days=1),
            )
        )

    session.commit()

    return QuizGradeResponse(
        quiz_id=quiz.id,
        score=score,
        total=total,
        feedback=feedback,
        results=[QuizGradeResult(**result) for result in results],
    )
