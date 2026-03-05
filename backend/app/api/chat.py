from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session

from app.api.deps import get_db_session
from app.models import LearningSession, Message, Note, Slide
from app.schemas import ChatRequest, ChatResponse
from app.services.explanation_engine import generate_slide_explanation

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


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
        )
    )

    if target_slide:
        answer, follow_ups = generate_slide_explanation(
            slide=target_slide,
            question=payload.message,
        )
        used_slide_ids = [target_slide.id]
    else:
        answer = (
            "本页在讲什么（一句话）：\n"
            "你当前处于全局模式，我会结合课程上下文回答你的问题。\n\n"
            "知识点拆解：\n"
            "1. 先明确问题与目标。\n"
            "2. 回溯相关章节。\n"
            "3. 给出可执行结论。\n\n"
            "1分钟自测：\n"
            "1. 你能复述答案主线吗？\n"
            "2. 哪个知识点仍然不清楚？\n"
            "3. 下一步你会练哪道题？\n"
        )
        follow_ups = ["把这题拆成三步", "给我一个反例", "和前一页有什么关系"]
        used_slide_ids = []

    session.add(
        Message(
            session_id=learning_session.id,
            role="assistant",
            content=answer,
            slide_id=target_slide_id,
            mode=payload.mode,
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
