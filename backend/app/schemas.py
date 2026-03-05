from __future__ import annotations

from pydantic import BaseModel


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
