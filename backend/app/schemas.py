from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class DocumentRead(BaseModel):
    id: str
    filename: str
    media_type: str
    status: str
    page_count: int


class UploadResponse(BaseModel):
    document: DocumentRead
    slide_count: int


class SlideRead(BaseModel):
    id: str
    page_num: int
    image_url: str
    thumbnail_url: str
    width: int
    height: int


class SlidesResponse(BaseModel):
    document_id: str
    slides: list[SlideRead]


class SessionCreateRequest(BaseModel):
    document_id: str
    current_slide_id: str | None = None
    follow_current_page: bool = True


class SessionRead(BaseModel):
    id: str
    document_id: str
    current_slide_id: str | None
    follow_current_page: bool
    created_at: datetime


class ChatRequest(BaseModel):
    session_id: str
    message: str
    slide_id: str | None = None
    mode: str = Field(default="slide", pattern="^(slide|global)$")


class ChatResponse(BaseModel):
    answer: str
    used_slide_ids: list[str]
    degraded: bool
    follow_ups: list[str]


class NotesExportRequest(BaseModel):
    session_id: str
    title: str = "PPT 学习笔记"


class NotesExportResponse(BaseModel):
    title: str
    markdown: str
