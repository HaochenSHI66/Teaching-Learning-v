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


class RoiBox(BaseModel):
    x: float = Field(ge=0.0, le=1.0)
    y: float = Field(ge=0.0, le=1.0)
    w: float = Field(gt=0.0, le=1.0)
    h: float = Field(gt=0.0, le=1.0)


class RoiChatRequest(BaseModel):
    session_id: str
    slide_id: str
    message: str
    roi: RoiBox


class RoiChatResponse(BaseModel):
    answer: str
    used_slide_ids: list[str]
    roi_bbox: RoiBox


class NotesExportRequest(BaseModel):
    session_id: str
    title: str = "PPT 学习笔记"


class NotesExportResponse(BaseModel):
    title: str
    markdown: str


class QuizGenerateRequest(BaseModel):
    session_id: str
    slide_id: str
    question_count: int = Field(default=3, ge=1, le=10)


class QuizQuestion(BaseModel):
    id: str
    prompt: str
    options: list[str]


class QuizGenerateResponse(BaseModel):
    quiz_id: str
    slide_id: str
    questions: list[QuizQuestion]


class QuizGradeRequest(BaseModel):
    answers: dict[str, str]


class QuizGradeResult(BaseModel):
    question_id: str
    expected: str
    actual: str
    is_correct: bool


class QuizGradeResponse(BaseModel):
    quiz_id: str
    score: int
    total: int
    feedback: str
    results: list[QuizGradeResult]
