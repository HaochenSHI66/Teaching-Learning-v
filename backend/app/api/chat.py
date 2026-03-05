from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from PIL import Image
from sqlmodel import Session

from app.api.deps import get_db_session
from app.models import Document, LearningSession, Message, Note, Slide
from app.schemas import ChatRequest, ChatResponse, RoiChatRequest, RoiChatResponse
from app.services.explanation_engine import generate_roi_explanation, generate_slide_explanation
from app.services.retrieval import retrieve_related_slides

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


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


@router.post("", response_model=ChatResponse)
def chat_on_slide(
    payload: ChatRequest,
    session: Session = Depends(get_db_session),
) -> ChatResponse:
    learning_session = session.get(LearningSession, payload.session_id)
    if not learning_session:
        raise HTTPException(status_code=404, detail="Session not found")

    target_slide_id = payload.slide_id
    if payload.mode == "slide" and not target_slide_id:
        target_slide_id = learning_session.current_slide_id

    target_slide = None
    if target_slide_id:
        target_slide = session.get(Slide, target_slide_id)
        if not target_slide or target_slide.document_id != learning_session.document_id:
            raise HTTPException(status_code=400, detail="Slide not found in session document")

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

    if target_slide:
        related_slides = retrieve_related_slides(
            session=session,
            document_id=learning_session.document_id,
            question=payload.message,
            anchor_slide_id=target_slide.id,
            max_results=3,
        )
        used_slide_ids = [slide.id for slide in related_slides] or [target_slide.id]
        related_pages = [slide.page_num for slide in related_slides] or [target_slide.page_num]

        answer, follow_ups = generate_slide_explanation(
            slide=target_slide,
            question=payload.message,
            related_pages=related_pages,
        )
    else:
        related_slides = retrieve_related_slides(
            session=session,
            document_id=learning_session.document_id,
            question=payload.message,
            anchor_slide_id=learning_session.current_slide_id,
            max_results=3,
        )
        used_slide_ids = [slide.id for slide in related_slides]
        if related_slides:
            reference_slide = related_slides[0]
            related_pages = [slide.page_num for slide in related_slides]
            answer, follow_ups = generate_slide_explanation(
                slide=reference_slide,
                question=payload.message,
                related_pages=related_pages,
            )
        else:
            answer = (
                "本页在讲什么（一句话）：\n"
                "你当前处于全局模式，我会结合课程上下文回答你的问题。\n\n"
                "知识点拆解：\n"
                "1. 先明确问题与目标。\n"
                "2. 回溯相关章节。\n"
                "3. 给出可执行结论。\n\n"
                "引用页码：无\n\n"
                "1分钟自测：\n"
                "1. 你能复述答案主线吗？\n"
                "2. 哪个知识点仍然不清楚？\n"
                "3. 下一步你会练哪道题？\n"
            )
            follow_ups = ["把这题拆成三步", "给我一个反例", "和前一页有什么关系"]

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

    if target_slide_id:
        session.add(
            Note(
                session_id=learning_session.id,
                slide_id=target_slide_id,
                content_md=answer,
            )
        )

    if payload.mode == "slide" and target_slide_id:
        learning_session.current_slide_id = target_slide_id

    session.add(learning_session)
    session.commit()

    return ChatResponse(
        answer=answer,
        used_slide_ids=used_slide_ids,
        degraded=False,
        follow_ups=follow_ups,
    )


@router.post("/roi", response_model=RoiChatResponse)
def explain_roi(
    payload: RoiChatRequest,
    session: Session = Depends(get_db_session),
) -> RoiChatResponse:
    learning_session, slide = _get_session_and_slide(
        session=session,
        session_id=payload.session_id,
        slide_id=payload.slide_id,
    )

    document = session.get(Document, learning_session.document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    image_path = Path(document.storage_path) / slide.image_path
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
        region_size = region.size

    answer = generate_roi_explanation(
        slide=slide,
        question=payload.message,
        roi_bbox=(payload.roi.x, payload.roi.y, payload.roi.w, payload.roi.h),
        region_size=region_size,
    )

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
            context={
                "roi": payload.roi.model_dump(),
                "region_size": {"width": region_size[0], "height": region_size[1]},
            },
        )
    )

    session.add(
        Note(
            session_id=learning_session.id,
            slide_id=slide.id,
            content_md=answer,
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
