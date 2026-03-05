from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


def _new_id() -> str:
    return str(uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Document(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    filename: str
    media_type: str
    storage_path: str
    status: str = Field(default="ready")
    page_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=_utcnow)


class Slide(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True)
    page_num: int
    image_path: str
    thumbnail_path: str
    width: int
    height: int


class SlideExtract(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    slide_id: str = Field(index=True)
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))


class SlideExplanation(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True)
    slide_id: str = Field(index=True)
    page_num: int
    markdown: str
    generated_at: datetime = Field(default_factory=_utcnow)


class LearningSession(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True)
    current_slide_id: str | None = Field(default=None, index=True)
    follow_current_page: bool = Field(default=True)
    learning_state_summary: str = Field(default="")
    created_at: datetime = Field(default_factory=_utcnow)


class Message(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    session_id: str = Field(index=True)
    role: str
    content: str
    slide_id: str | None = Field(default=None, index=True)
    mode: str = Field(default="slide")
    context: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_utcnow)


class Note(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    session_id: str = Field(index=True)
    slide_id: str | None = Field(default=None, index=True)
    content_md: str
    created_at: datetime = Field(default_factory=_utcnow)


class Quiz(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    session_id: str = Field(index=True)
    slide_id: str = Field(index=True)
    questions: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    answer_key: dict = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_utcnow)


class QuizAttempt(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    quiz_id: str = Field(index=True)
    answers: dict = Field(default_factory=dict, sa_column=Column(JSON))
    score: int = Field(default=0)
    total: int = Field(default=0)
    feedback: str = Field(default="")
    detail: list[dict] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=_utcnow)


class ReviewItem(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    session_id: str = Field(index=True)
    slide_id: str = Field(index=True)
    source_ref: str = Field(index=True)
    prompt: str
    due_at: datetime = Field(default_factory=_utcnow)
    status: str = Field(default="pending")
    # SM-2 spaced repetition state
    repetitions: int = Field(default=0)
    interval_days: float = Field(default=1.0)
    easiness: float = Field(default=2.5)
    created_at: datetime = Field(default_factory=_utcnow)
