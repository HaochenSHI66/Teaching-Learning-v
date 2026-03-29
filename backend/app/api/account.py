from __future__ import annotations

import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, Request, status
from sqlmodel import Session, select

from app.auth import get_current_user
from app.models import (
    Concept,
    ConceptRelation,
    Document,
    DocumentNotebook,
    DocumentSummary,
    Flashcard,
    Folder,
    LearningSession,
    LLMUsage,
    Message,
    Note,
    Quiz,
    QuizAttempt,
    ReviewItem,
    Slide,
    SlideBookmark,
    SlideExplanation,
    SlideExtract,
    SlideNote,
    User,
)

router = APIRouter(prefix="/account", tags=["account"])


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Delete user account and ALL associated data. Irreversible."""
    engine = request.app.state.engine
    storage_dir: Path = request.app.state.storage_dir

    with Session(engine) as session:
        # ── Documents & document-level data ──────────────────────────
        docs = session.exec(
            select(Document).where(Document.user_id == current_user.id)
        ).all()
        doc_ids = [d.id for d in docs]

        if doc_ids:
            # Slides
            slides = session.exec(
                select(Slide).where(Slide.document_id.in_(doc_ids))
            ).all()
            slide_ids = [s.id for s in slides]

            if slide_ids:
                # Slide-level children (keyed by slide_id)
                for model in (SlideExplanation, SlideExtract, SlideNote, SlideBookmark):
                    for item in session.exec(
                        select(model).where(model.slide_id.in_(slide_ids))
                    ).all():
                        session.delete(item)

                # Flashcards (keyed by slide_id)
                for fc in session.exec(
                    select(Flashcard).where(Flashcard.slide_id.in_(slide_ids))
                ).all():
                    session.delete(fc)

                # Delete slides themselves
                for slide in slides:
                    session.delete(slide)

            # Document-level children
            for model in (DocumentNotebook, DocumentSummary):
                for item in session.exec(
                    select(model).where(model.document_id.in_(doc_ids))
                ).all():
                    session.delete(item)

            # Concepts & relations
            concepts = session.exec(
                select(Concept).where(Concept.document_id.in_(doc_ids))
            ).all()
            concept_ids = [c.id for c in concepts]
            if concept_ids:
                for rel in session.exec(
                    select(ConceptRelation).where(
                        (ConceptRelation.source_id.in_(concept_ids))
                        | (ConceptRelation.target_id.in_(concept_ids))
                    )
                ).all():
                    session.delete(rel)
                for concept in concepts:
                    session.delete(concept)

            # Delete documents
            for doc in docs:
                session.delete(doc)

        # ── Sessions & session-level data ────────────────────────────
        sessions = session.exec(
            select(LearningSession).where(
                LearningSession.user_id == current_user.id
            )
        ).all()
        session_ids = [s.id for s in sessions]

        if session_ids:
            # Messages
            for msg in session.exec(
                select(Message).where(Message.session_id.in_(session_ids))
            ).all():
                session.delete(msg)

            # Notes (keyed by session_id)
            for note in session.exec(
                select(Note).where(Note.session_id.in_(session_ids))
            ).all():
                session.delete(note)

            # Quizzes & attempts (keyed by session_id)
            quizzes = session.exec(
                select(Quiz).where(Quiz.session_id.in_(session_ids))
            ).all()
            quiz_ids = [q.id for q in quizzes]
            if quiz_ids:
                for att in session.exec(
                    select(QuizAttempt).where(QuizAttempt.quiz_id.in_(quiz_ids))
                ).all():
                    session.delete(att)
                for quiz in quizzes:
                    session.delete(quiz)

            # Review items (keyed by session_id)
            for ri in session.exec(
                select(ReviewItem).where(ReviewItem.session_id.in_(session_ids))
            ).all():
                session.delete(ri)

            # Delete sessions
            for sess in sessions:
                session.delete(sess)

        # ── Folders ──────────────────────────────────────────────────
        for folder in session.exec(
            select(Folder).where(Folder.user_id == current_user.id)
        ).all():
            session.delete(folder)

        # ── LLM usage records ────────────────────────────────────────
        for usage in session.exec(
            select(LLMUsage).where(LLMUsage.user_id == current_user.id)
        ).all():
            session.delete(usage)

        # ── User ─────────────────────────────────────────────────────
        user = session.get(User, current_user.id)
        if user:
            session.delete(user)

        session.commit()

    # ── Clean up storage files ───────────────────────────────────────
    for doc in docs:
        doc_storage = storage_dir / str(doc.id)
        if doc_storage.exists():
            shutil.rmtree(doc_storage, ignore_errors=True)

    return None
