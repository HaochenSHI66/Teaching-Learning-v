from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.models import Document, DocumentNotebook, Slide, SlideBookmark, SlideExplanation, SlideNote
from app.schemas import (
    SlideNoteBatchGenerateResponse,
    SlideNoteExportResponse,
    SlideNoteGenerateResponse,
    SlideNoteListResponse,
    SlideNoteRead,
    SlideNoteSaveRequest,
)
from app.services.model_gateway import ModelGateway

router = APIRouter(prefix="/api/v1/slide-notes", tags=["slide-notes"])
logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_document_or_404(session: Session, document_id: str) -> Document:
    doc = session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _serialize_note(note: SlideNote) -> SlideNoteRead:
    return SlideNoteRead(
        id=note.id,
        document_id=note.document_id,
        slide_id=note.slide_id,
        page_num=note.page_num,
        content_md=note.content_md,
        source=note.source,
        updated_at=note.updated_at,
    )


# ── List all notes for a document ─────────────────────────────

@router.get("/{document_id}", response_model=SlideNoteListResponse)
def list_slide_notes(
    document_id: str,
    session: Session = Depends(get_db_session),
) -> SlideNoteListResponse:
    _get_document_or_404(session, document_id)
    notes = session.exec(
        select(SlideNote)
        .where(SlideNote.document_id == document_id)
        .order_by(SlideNote.page_num)
    ).all()
    return SlideNoteListResponse(
        document_id=document_id,
        notes=[_serialize_note(n) for n in notes],
    )


# ── Get single slide note ─────────────────────────────────────

@router.get("/slide/{slide_id}", response_model=SlideNoteRead)
def get_slide_note(
    slide_id: str,
    session: Session = Depends(get_db_session),
) -> SlideNoteRead:
    note = session.exec(
        select(SlideNote).where(SlideNote.slide_id == slide_id)
    ).first()
    if not note:
        slide = session.get(Slide, slide_id)
        if not slide:
            raise HTTPException(status_code=404, detail="Slide not found")
        return SlideNoteRead(
            id="",
            document_id=slide.document_id,
            slide_id=slide_id,
            page_num=slide.page_num,
            content_md="",
            source="manual",
            updated_at=None,
        )
    return _serialize_note(note)


# ── Save / update slide note ──────────────────────────────────

@router.put("/slide/{slide_id}", response_model=SlideNoteRead)
def save_slide_note(
    slide_id: str,
    payload: SlideNoteSaveRequest,
    session: Session = Depends(get_db_session),
) -> SlideNoteRead:
    slide = session.get(Slide, slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")

    note = session.exec(
        select(SlideNote).where(SlideNote.slide_id == slide_id)
    ).first()

    now = _utcnow()
    if note:
        note.content_md = payload.content_md
        note.source = payload.source
        note.updated_at = now
        session.add(note)
    else:
        note = SlideNote(
            document_id=slide.document_id,
            slide_id=slide_id,
            page_num=slide.page_num,
            content_md=payload.content_md,
            source=payload.source,
            updated_at=now,
        )
        session.add(note)

    session.commit()
    session.refresh(note)
    return _serialize_note(note)


# ── AI generate note for one slide ────────────────────────────

NOTE_GEN_PROMPT = """你是一个学习笔记助手。请将以下PPT讲解内容精简为结构化学习笔记。

要求格式：
- **要点**：用 bullet list 列出 3-5 个核心知识点
- **关键术语**：列出重要术语及简要解释
- **总结**：用 1-2 句话概括本页核心

讲解内容：
{explanation}

请直接输出 Markdown 格式的笔记，不要额外说明。"""


@router.post("/slide/{slide_id}/generate", response_model=SlideNoteGenerateResponse)
def generate_slide_note(
    slide_id: str,
    session: Session = Depends(get_db_session),
) -> SlideNoteGenerateResponse:
    slide = session.get(Slide, slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")

    explanation = session.exec(
        select(SlideExplanation).where(SlideExplanation.slide_id == slide_id)
    ).first()
    if not explanation:
        raise HTTPException(status_code=404, detail="No explanation for this slide")

    gateway = ModelGateway(timeout=8.0)
    if not gateway.is_configured():
        raise HTTPException(status_code=503, detail="Model gateway not configured")

    prompt = NOTE_GEN_PROMPT.format(explanation=explanation.markdown)
    generated = gateway.generate_text_markdown(prompt=prompt).strip()

    now = _utcnow()
    note = session.exec(
        select(SlideNote).where(SlideNote.slide_id == slide_id)
    ).first()
    if note:
        note.content_md = generated
        note.source = "ai"
        note.updated_at = now
        session.add(note)
    else:
        note = SlideNote(
            document_id=slide.document_id,
            slide_id=slide_id,
            page_num=slide.page_num,
            content_md=generated,
            source="ai",
            updated_at=now,
        )
        session.add(note)

    session.commit()
    return SlideNoteGenerateResponse(
        slide_id=slide_id,
        content_md=generated,
        source="ai",
    )


# ── Batch generate for all slides ─────────────────────────────

@router.post("/{document_id}/generate-all", response_model=SlideNoteBatchGenerateResponse)
def generate_all_slide_notes(
    document_id: str,
    session: Session = Depends(get_db_session),
) -> SlideNoteBatchGenerateResponse:
    doc = _get_document_or_404(session, document_id)

    existing_slide_ids = {
        row.slide_id
        for row in session.exec(
            select(SlideNote.slide_id).where(SlideNote.document_id == document_id)
        ).all()
    }

    explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == document_id)
        .order_by(SlideExplanation.page_num)
    ).all()

    gateway = ModelGateway(timeout=8.0)
    if not gateway.is_configured():
        raise HTTPException(status_code=503, detail="Model gateway not configured")

    count = 0
    for exp in explanations:
        if exp.slide_id in existing_slide_ids:
            continue
        prompt = NOTE_GEN_PROMPT.format(explanation=exp.markdown)
        try:
            generated = gateway.generate_text_markdown(prompt=prompt).strip()
        except Exception as exc:
            logger.warning("generate note for slide %s failed: %s", exp.slide_id, exc)
            continue

        note = SlideNote(
            document_id=document_id,
            slide_id=exp.slide_id,
            page_num=exp.page_num,
            content_md=generated,
            source="ai",
            updated_at=_utcnow(),
        )
        session.add(note)
        count += 1

    session.commit()
    return SlideNoteBatchGenerateResponse(document_id=document_id, generated_count=count)


# ── Export as Obsidian-compatible Markdown ──────────────────────

@router.post("/{document_id}/export", response_model=SlideNoteExportResponse)
def export_slide_notes(
    document_id: str,
    session: Session = Depends(get_db_session),
) -> SlideNoteExportResponse:
    doc = _get_document_or_404(session, document_id)

    notes = session.exec(
        select(SlideNote)
        .where(SlideNote.document_id == document_id)
        .order_by(SlideNote.page_num)
    ).all()

    bookmarks = session.exec(
        select(SlideBookmark).where(SlideBookmark.document_id == document_id)
    ).all()
    bookmark_map: dict[str, list[str]] = {}
    for bm in bookmarks:
        bookmark_map.setdefault(bm.slide_id, []).append(bm.tag)

    tag_labels = {
        "important": "#重点",
        "difficult": "#难点",
        "review": "#待复习",
        "exam": "#考试",
    }

    sections = [f"# {doc.filename}\n"]
    for note in notes:
        tags = bookmark_map.get(note.slide_id, [])
        tag_str = " ".join(tag_labels.get(t, f"#{t}") for t in tags)
        header = f"## Page {note.page_num}"
        if tag_str:
            header += f"  {tag_str}"
        sections.append(header)
        sections.append(note.content_md.strip())
        sections.append("\n---\n")

    markdown = "\n".join(sections).rstrip("\n---\n").strip() + "\n"
    return SlideNoteExportResponse(title=f"{doc.filename} 笔记", markdown=markdown)
