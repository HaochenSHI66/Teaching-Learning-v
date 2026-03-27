from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api.deps import get_db_session, require_document_owner, require_session_owner
from app.auth import get_current_user
from app.models import Document, LearningSession, Slide, User
from app.schemas import SessionCreateRequest, SessionRead

router = APIRouter(prefix="/api/v1/sessions", tags=["sessions"])


@router.post("", response_model=SessionRead, status_code=status.HTTP_201_CREATED)
def create_session(
    payload: SessionCreateRequest,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> SessionRead:
    require_document_owner(payload.document_id, current_user.id, session)

    if payload.current_slide_id:
        slide = session.get(Slide, payload.current_slide_id)
        if not slide or slide.document_id != payload.document_id:
            raise HTTPException(status_code=400, detail="Current slide is invalid")

    learning_session = LearningSession(
        document_id=payload.document_id,
        current_slide_id=payload.current_slide_id,
        follow_current_page=payload.follow_current_page,
        user_id=current_user.id,
    )
    session.add(learning_session)
    session.commit()
    session.refresh(learning_session)

    return SessionRead(
        id=learning_session.id,
        document_id=learning_session.document_id,
        current_slide_id=learning_session.current_slide_id,
        follow_current_page=learning_session.follow_current_page,
        created_at=learning_session.created_at,
    )


@router.get("/{session_id}", response_model=SessionRead)
def get_session(
    session_id: str,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> SessionRead:
    learning_session = require_session_owner(session_id, current_user.id, session)

    return SessionRead(
        id=learning_session.id,
        document_id=learning_session.document_id,
        current_slide_id=learning_session.current_slide_id,
        follow_current_page=learning_session.follow_current_page,
        created_at=learning_session.created_at,
    )
