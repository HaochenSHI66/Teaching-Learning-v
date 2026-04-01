from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


def _new_id() -> str:
    return str(uuid4())


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    email: str = Field(index=True, unique=True)
    password_hash: str
    display_name: str
    is_admin: bool = Field(default=False)
    is_disabled: bool = Field(default=False)
    created_at: datetime = Field(default_factory=_utcnow)


class Document(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    filename: str
    media_type: str
    storage_path: str
    folder_id: str | None = Field(default=None, index=True)
    sort_order: int = Field(default=0, index=True)
    status: str = Field(default="ready")
    page_count: int = Field(default=0)
    user_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_utcnow)
    content_version: int = Field(default=1)


class Folder(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    name: str
    color: str = Field(default="oat")
    sort_order: int = Field(default=0, index=True)
    user_id: str | None = Field(default=None, index=True)
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
    meta: dict = Field(default_factory=dict, sa_column=Column(JSON))
    version: int = Field(default=1)
    generated_at: datetime = Field(default_factory=_utcnow)


class LearningSession(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True)
    current_slide_id: str | None = Field(default=None, index=True)
    follow_current_page: bool = Field(default=True)
    learning_state_summary: str = Field(default="")
    user_id: str | None = Field(default=None, index=True)
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


class DocumentNotebook(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True, unique=True)
    content_md: str
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


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


class SlideNote(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True)
    slide_id: str = Field(index=True)
    page_num: int = Field(default=0)
    content_md: str = Field(default="")
    source: str = Field(default="manual")  # manual / ai / mixed
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class DocumentSummary(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True, unique=True)
    content_md: str = Field(default="")
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)


class SlideBookmark(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True)
    slide_id: str = Field(index=True)
    page_num: int = Field(default=0)
    tag: str = Field(default="important")  # important / difficult / review / exam
    note: str = Field(default="")
    created_at: datetime = Field(default_factory=_utcnow)


class Flashcard(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True)
    slide_id: str = Field(index=True)
    front_md: str = Field(default="")
    back_md: str = Field(default="")
    source: str = Field(default="auto")  # auto / manual
    concept_id: str | None = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=_utcnow)


class Concept(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True)
    name: str = Field(default="")
    description: str = Field(default="")
    slide_ids: list[str] = Field(default_factory=list, sa_column=Column(JSON))
    importance: int = Field(default=3)
    created_at: datetime = Field(default_factory=_utcnow)


class ConceptRelation(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    document_id: str = Field(index=True)
    source_id: str = Field(index=True)
    target_id: str = Field(index=True)
    relation_type: str = Field(default="related")  # prerequisite / related / part_of / contrast
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


class LLMUsage(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    user_id: str | None = Field(default=None, index=True)
    model: str = Field(default="")
    input_tokens: int = Field(default=0)
    output_tokens: int = Field(default=0)
    estimated_cost_cny: float = Field(default=0.0)
    endpoint: str = Field(default="")
    created_at: datetime = Field(default_factory=_utcnow)
