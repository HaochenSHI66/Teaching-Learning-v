from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Column, JSON
from sqlmodel import Field, SQLModel


def _new_id() -> str:
    return str(uuid4())


class Document(SQLModel, table=True):
    id: str = Field(default_factory=_new_id, primary_key=True)
    filename: str
    media_type: str
    storage_path: str
    status: str = Field(default="ready")
    page_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=datetime.utcnow)


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
