from __future__ import annotations

from fastapi import HTTPException, Request, status
from sqlmodel import Session

from app.models import Document, Folder, LearningSession


def get_db_session(request: Request):
    engine = request.app.state.engine
    with Session(engine) as session:
        yield session


def require_document_owner(
    document_id: str, user_id: str, session: Session
) -> Document:
    """Return the Document if it belongs to user_id, else raise 404/403."""
    doc = session.get(Document, document_id)
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Document not found",
        )
    if doc.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    return doc


def require_session_owner(
    session_id: str, user_id: str, db: Session
) -> LearningSession:
    """Return the LearningSession if it belongs to user_id, else raise 404/403."""
    ls = db.get(LearningSession, session_id)
    if not ls:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found",
        )
    if ls.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    return ls


def require_folder_owner(
    folder_id: str, user_id: str, session: Session
) -> Folder:
    """Return the Folder if it belongs to user_id, else raise 404/403."""
    folder = session.get(Folder, folder_id)
    if not folder:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Folder not found",
        )
    if folder.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    return folder
