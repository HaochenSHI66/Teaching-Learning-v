from __future__ import annotations

import json as _json
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from app.middleware.rate_limit import rate_limit
from PIL import Image
from pydantic import BaseModel
from sqlalchemy import text
from sqlmodel import Session
from sqlmodel import select

from app.api.deps import get_db_session, require_session_owner
from app.auth import get_current_user
from app.models import Document, LearningSession, Message, Slide, SlideExtract, SlideExplanation, User
from app.schemas import ChatRequest, ChatResponse, RoiChatRequest, RoiChatResponse
from app.services.chat_engine import (
    classify_question,
    generate_chat_response,
    generate_global_chat_response,
    stream_chat_response,
)
from app.services.chat_prompts import extract_page_numbers
from app.services.retrieval import retrieve_related_slides

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


class GlobalMessageItem(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    created_at: str
    slide_id: str | None
    filename: str
    page_num: int | None


def _get_slide_extract_payload(session: Session, slide_id: str) -> dict:
    slide_extract = session.exec(
        select(SlideExtract).where(SlideExtract.slide_id == slide_id)
    ).first()
    if not slide_extract:
        return {}
    return dict(slide_extract.payload)


def _get_slide_extract_text(session: Session, slide_id: str) -> str:
    return str(_get_slide_extract_payload(session, slide_id).get("text", ""))


def _get_slide_image_path(request: Request, document: Document, slide: Slide) -> Path:
    return request.app.state.storage_dir / document.storage_path / slide.image_path


def _get_session_and_slide(
    *,
    session: Session,
    session_id: str,
    slide_id: str,
) -> tuple[LearningSession, Slide]:
    learning_session = session.get(LearningSession, session_id)
    if not learning_session:
        raise HTTPException(status_code=404, detail="Session not found")

    slide = session.get(Slide, slide_id)
    if not slide or slide.document_id != learning_session.document_id:
        raise HTTPException(status_code=400, detail="Slide not found in session document")

    return learning_session, slide


def _fetch_conversation_history(session: Session, session_id: str, limit: int = 10) -> list[dict[str, str]]:
    """Fetch recent messages from this session as a conversation history array."""
    messages = session.exec(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    ).all()
    # Reverse to chronological order
    messages = list(reversed(messages))
    return [{"role": msg.role, "content": msg.content} for msg in messages]


def _get_cached_explanation(session: Session, slide_id: str) -> str:
    """Get the cached SlideExplanation markdown for context injection."""
    explanation = session.exec(
        select(SlideExplanation).where(SlideExplanation.slide_id == slide_id)
    ).first()
    if not explanation:
        return ""
    return explanation.markdown or ""


def _get_document_slides_summary(session: Session, document_id: str) -> str:
    """Build a summary of all slides for global mode context."""
    explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == document_id)
        .order_by(SlideExplanation.page_num)
    ).all()
    lines = []
    for exp in explanations:
        meta = exp.meta or {}
        title = meta.get("title", f"第 {exp.page_num} 页")
        # First 100 chars of explanation as summary
        summary = (exp.markdown or "")[:100].replace("\n", " ")
        lines.append(f"第 {exp.page_num} 页「{title}」: {summary}")
    return "\n".join(lines[:30])  # Cap at 30 slides to stay within token budget


def _build_cross_slide_context(
    session: Session,
    document_id: str,
    page_numbers: list[int],
) -> str:
    """Build context from multiple slides for comparison questions."""
    if not page_numbers:
        return ""
    slides = session.exec(
        select(Slide)
        .where(Slide.document_id == document_id)
        .where(Slide.page_num.in_(page_numbers))
    ).all()
    parts = []
    for slide in sorted(slides, key=lambda s: s.page_num):
        extract_text = _get_slide_extract_text(session, slide.id)
        explanation = _get_cached_explanation(session, slide.id)
        parts.append(
            f"--- 第 {slide.page_num} 页 ---\n"
            f"提取文本: {extract_text[:500]}\n"
            f"讲解摘要: {explanation[:300]}"
        )
    return "\n\n".join(parts)


@router.post("", response_model=ChatResponse)
def chat_on_slide(
    request: Request,
    payload: ChatRequest,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    _rate_limit=Depends(rate_limit(30, 60, "chat")),
) -> ChatResponse:
    learning_session = session.get(LearningSession, payload.session_id)
    if not learning_session:
        raise HTTPException(status_code=404, detail="Session not found")
    require_session_owner(payload.session_id, current_user.id, session)

    target_slide_id = payload.slide_id
    if payload.mode == "slide" and not target_slide_id:
        target_slide_id = learning_session.current_slide_id

    target_slide = None
    if target_slide_id:
        target_slide = session.get(Slide, target_slide_id)
        if not target_slide or target_slide.document_id != learning_session.document_id:
            raise HTTPException(status_code=400, detail="Slide not found in session document")

    # Save user message
    session.add(
        Message(
            session_id=learning_session.id,
            role="user",
            content=payload.message,
            slide_id=target_slide_id,
            mode=payload.mode,
            context={},
        )
    )

    # Fetch conversation history
    history = _fetch_conversation_history(session, learning_session.id)

    # Check for cross-slide comparison
    question_type = classify_question(payload.message)
    extra_context = ""
    if question_type == "comparison":
        page_nums = extract_page_numbers(payload.message)
        if page_nums:
            extra_context = _build_cross_slide_context(
                session, learning_session.document_id, page_nums
            )

    if target_slide:
        document = session.get(Document, learning_session.document_id)
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")

        # Get slide context
        extract_payload = _get_slide_extract_payload(session, target_slide.id)
        extracted_text = str(extract_payload.get("text") or "")
        cached_explanation = _get_cached_explanation(session, target_slide.id)

        # Retrieve related slides for used_slide_ids
        related_slides = retrieve_related_slides(
            session=session,
            document_id=learning_session.document_id,
            question=payload.message,
            anchor_slide_id=target_slide.id,
            max_results=3,
        )
        used_slide_ids = [slide.id for slide in related_slides] or [target_slide.id]

        answer = generate_chat_response(
            conversation_history=history,
            slide_context=extracted_text,
            slide_image_path=_get_slide_image_path(request, document, target_slide),
            question=payload.message,
            cached_explanation=cached_explanation,
            extra_context=extra_context,
        )
    else:
        # Global mode — use AI with document-level context
        related_slides = retrieve_related_slides(
            session=session,
            document_id=learning_session.document_id,
            question=payload.message,
            anchor_slide_id=learning_session.current_slide_id,
            max_results=3,
        )
        used_slide_ids = [slide.id for slide in related_slides]

        document = session.get(Document, learning_session.document_id)
        doc_title = document.filename if document else ""
        slides_summary = _get_document_slides_summary(session, learning_session.document_id)

        answer = generate_global_chat_response(
            conversation_history=history,
            question=payload.message,
            document_title=doc_title,
            slides_summary=slides_summary,
        )

    # Save assistant message
    session.add(
        Message(
            session_id=learning_session.id,
            role="assistant",
            content=answer,
            slide_id=target_slide_id,
            mode=payload.mode,
            context={"used_slide_ids": used_slide_ids},
        )
    )

    if payload.mode == "slide" and target_slide_id:
        learning_session.current_slide_id = target_slide_id

    session.add(learning_session)
    session.commit()

    follow_ups = ["能再详细说说吗", "给我举个例子", "这个和前一页有什么关系"]
    return ChatResponse(
        answer=answer,
        used_slide_ids=used_slide_ids,
        degraded=False,
        follow_ups=follow_ups,
    )


@router.post("/stream")
def chat_stream(
    request: Request,
    payload: ChatRequest,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    _rate_limit=Depends(rate_limit(30, 60, "chat")),
):
    """SSE streaming chat endpoint. Returns text/event-stream."""
    learning_session = session.get(LearningSession, payload.session_id)
    if not learning_session:
        raise HTTPException(status_code=404, detail="Session not found")
    require_session_owner(payload.session_id, current_user.id, session)

    target_slide_id = payload.slide_id
    if payload.mode == "slide" and not target_slide_id:
        target_slide_id = learning_session.current_slide_id

    target_slide = None
    if target_slide_id:
        target_slide = session.get(Slide, target_slide_id)
        if not target_slide or target_slide.document_id != learning_session.document_id:
            raise HTTPException(status_code=400, detail="Slide not found in session document")

    # Save user message
    session.add(
        Message(
            session_id=learning_session.id,
            role="user",
            content=payload.message,
            slide_id=target_slide_id,
            mode=payload.mode,
            context={},
        )
    )
    session.commit()

    # Fetch conversation history
    history = _fetch_conversation_history(session, learning_session.id)

    # Prepare context
    slide_context = ""
    cached_explanation = ""
    if target_slide:
        extract_payload = _get_slide_extract_payload(session, target_slide.id)
        slide_context = str(extract_payload.get("text") or "")
        cached_explanation = _get_cached_explanation(session, target_slide.id)

    extra_context = ""
    question_type = classify_question(payload.message)
    if question_type == "comparison":
        page_nums = extract_page_numbers(payload.message)
        if page_nums:
            extra_context = _build_cross_slide_context(
                session, learning_session.document_id, page_nums
            )

    def event_generator():
        full_answer_parts: list[str] = []
        try:
            for chunk in stream_chat_response(
                conversation_history=history,
                slide_context=slide_context,
                question=payload.message,
                cached_explanation=cached_explanation,
                extra_context=extra_context,
            ):
                full_answer_parts.append(chunk)
                yield f"data: {_json.dumps({'delta': chunk}, ensure_ascii=False)}\n\n"
        except Exception as exc:
            error_msg = f"生成失败: {exc}"
            yield f"data: {_json.dumps({'error': error_msg}, ensure_ascii=False)}\n\n"

        full_answer = "".join(full_answer_parts)
        yield f"data: {_json.dumps({'done': True, 'answer': full_answer}, ensure_ascii=False)}\n\n"

        # Save assistant message after streaming completes
        try:
            from app.db import create_db_engine, get_database_url
            engine = create_db_engine(get_database_url())
            with Session(engine) as save_session:
                save_session.add(
                    Message(
                        session_id=learning_session.id,
                        role="assistant",
                        content=full_answer,
                        slide_id=target_slide_id,
                        mode=payload.mode,
                        context={},
                    )
                )
                if payload.mode == "slide" and target_slide_id:
                    ls = save_session.get(LearningSession, learning_session.id)
                    if ls:
                        ls.current_slide_id = target_slide_id
                        save_session.add(ls)
                save_session.commit()
        except Exception:
            pass  # Non-fatal: message save failure shouldn't break the stream

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/roi", response_model=RoiChatResponse)
def explain_roi(
    request: Request,
    payload: RoiChatRequest,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
    _rate_limit=Depends(rate_limit(30, 60, "chat")),
) -> RoiChatResponse:
    require_session_owner(payload.session_id, current_user.id, session)
    learning_session, slide = _get_session_and_slide(
        session=session,
        session_id=payload.session_id,
        slide_id=payload.slide_id,
    )

    document = session.get(Document, learning_session.document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    storage_root: Path = request.app.state.storage_dir
    image_path = storage_root / document.storage_path / slide.image_path
    if not image_path.exists():
        raise HTTPException(status_code=404, detail="Slide image not found")

    with Image.open(image_path) as image:
        width, height = image.size
        left = max(0, min(width - 1, int(payload.roi.x * width)))
        top = max(0, min(height - 1, int(payload.roi.y * height)))
        right = max(1, min(width, int((payload.roi.x + payload.roi.w) * width)))
        bottom = max(1, min(height, int((payload.roi.y + payload.roi.h) * height)))

        if right <= left or bottom <= top:
            raise HTTPException(status_code=400, detail="ROI area is invalid")

        region = image.crop((left, top, right, bottom))
        with tempfile.NamedTemporaryFile(prefix="roi-", suffix=".png", delete=False) as temp_file:
            roi_path = Path(temp_file.name)
            region.save(roi_path, format="PNG")

    # Fetch conversation history for ROI chat
    history = _fetch_conversation_history(session, learning_session.id)
    extract_payload = _get_slide_extract_payload(session, slide.id)
    extracted_text = str(extract_payload.get("text") or "")
    cached_explanation = _get_cached_explanation(session, slide.id)

    # Use ChatEngine for ROI instead of generate_roi_explanation
    roi_context = (
        f"学生框选了第 {slide.page_num} 页的一个区域 "
        f"(x={payload.roi.x:.2f}, y={payload.roi.y:.2f}, w={payload.roi.w:.2f}, h={payload.roi.h:.2f})，"
        f"请重点解释这个区域的内容。"
    )
    answer = generate_chat_response(
        conversation_history=history,
        slide_context=extracted_text,
        slide_image_path=image_path,
        question=f"{payload.message}\n\n{roi_context}",
        cached_explanation=cached_explanation,
    )
    roi_path.unlink(missing_ok=True)

    session.add(
        Message(
            session_id=learning_session.id,
            role="user",
            content=payload.message,
            slide_id=slide.id,
            mode="slide",
            context={"roi": payload.roi.model_dump()},
        )
    )
    session.add(
        Message(
            session_id=learning_session.id,
            role="assistant",
            content=answer,
            slide_id=slide.id,
            mode="slide",
            context={"roi": payload.roi.model_dump()},
        )
    )

    learning_session.current_slide_id = slide.id
    session.add(learning_session)
    session.commit()

    return RoiChatResponse(
        answer=answer,
        used_slide_ids=[slide.id],
        roi_bbox=payload.roi,
    )


@router.get("/global", response_model=list[GlobalMessageItem])
def get_global_messages(
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> list[GlobalMessageItem]:
    rows = session.execute(
        text(
            """
            SELECT m.id, m.session_id, m.role, m.content,
                   m.created_at, m.slide_id,
                   d.filename,
                   s.page_num
            FROM message m
            JOIN learningsession ls ON m.session_id = ls.id
            JOIN document d ON ls.document_id = d.id
            LEFT JOIN slide s ON m.slide_id = s.id
            WHERE d.user_id = :uid
            ORDER BY m.created_at DESC
            LIMIT 200
            """
        ),
        {"uid": current_user.id},
    ).fetchall()
    return [
        GlobalMessageItem(
            id=r[0],
            session_id=r[1],
            role=r[2],
            content=r[3],
            created_at=str(r[4]),
            slide_id=r[5],
            filename=r[6],
            page_num=r[7],
        )
        for r in rows
    ]


@router.delete("/global")
def delete_global_messages(
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    session.execute(
        text(
            """
            DELETE FROM message
            WHERE session_id IN (
                SELECT ls.id FROM learningsession ls
                JOIN document d ON ls.document_id = d.id
                WHERE d.user_id = :uid
            )
            """
        ),
        {"uid": current_user.id},
    )
    session.commit()
    return {"ok": True}
