from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.api.deps import get_db_session, require_document_owner
from app.auth import get_current_user
from app.models import Document, Flashcard, LearningSession, ReviewItem, Slide, SlideExplanation, User
from app.schemas import (
    FlashcardBatchGenerateResponse,
    FlashcardCreateRequest,
    FlashcardDeleteResponse,
    FlashcardGenerateResponse,
    FlashcardListResponse,
    FlashcardRead,
    FlashcardSlideStats,
    FlashcardStatsResponse,
)
from app.services.model_gateway import ModelGateway

router = APIRouter(prefix="/api/v1/flashcards", tags=["flashcards"])
logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _get_document_or_404(session: Session, document_id: str) -> Document:
    doc = session.get(Document, document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


def _serialize(fc: Flashcard) -> FlashcardRead:
    return FlashcardRead(
        id=fc.id,
        document_id=fc.document_id,
        slide_id=fc.slide_id,
        front_md=fc.front_md,
        back_md=fc.back_md,
        source=fc.source,
        created_at=fc.created_at,
    )


FLASHCARD_GEN_PROMPT = """你是一个教育闪卡生成助手。请根据以下PPT讲解内容生成3-5张闪卡（Flashcard）。

要求：
- 每张卡包含 front（问题）和 back（答案）
- 类型多样：定义题、对比题、填空题
- 问题简洁明确，答案精炼
- 输出严格JSON数组格式

讲解内容：
{explanation}

输出格式（纯JSON，不要```标记）：
[{{"front": "问题1", "back": "答案1"}}, {{"front": "问题2", "back": "答案2"}}]"""


def _get_or_create_session(db: Session, document_id: str) -> LearningSession:
    """Get existing session or create one for flashcard review items."""
    ls = db.exec(
        select(LearningSession).where(LearningSession.document_id == document_id)
    ).first()
    if ls:
        return ls
    ls = LearningSession(document_id=document_id)
    db.add(ls)
    db.commit()
    db.refresh(ls)
    return ls


def _create_review_items(db: Session, flashcards: list[Flashcard], session_id: str) -> None:
    """Create ReviewItem entries linked to flashcards."""
    for fc in flashcards:
        ri = ReviewItem(
            session_id=session_id,
            slide_id=fc.slide_id,
            source_ref=f"flashcard:{fc.id}",
            prompt=fc.front_md,
            due_at=_utcnow(),
        )
        db.add(ri)


# ── List flashcards ───────────────────────────────────────────

@router.get("/{document_id}", response_model=FlashcardListResponse)
def list_flashcards(
    document_id: str,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> FlashcardListResponse:
    require_document_owner(document_id, current_user.id, session)
    cards = session.exec(
        select(Flashcard)
        .where(Flashcard.document_id == document_id)
        .order_by(Flashcard.created_at)
    ).all()
    return FlashcardListResponse(
        document_id=document_id,
        flashcards=[_serialize(c) for c in cards],
    )


# ── Create manual flashcard ───────────────────────────────────

@router.post("", response_model=FlashcardRead)
def create_flashcard(
    payload: FlashcardCreateRequest,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> FlashcardRead:
    slide = session.get(Slide, payload.slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")
    require_document_owner(slide.document_id, current_user.id, session)

    fc = Flashcard(
        document_id=slide.document_id,
        slide_id=slide.id,
        front_md=payload.front_md,
        back_md=payload.back_md,
        source="manual",
    )
    session.add(fc)
    session.commit()
    session.refresh(fc)

    ls = _get_or_create_session(session, slide.document_id)
    _create_review_items(session, [fc], ls.id)
    session.commit()

    return _serialize(fc)


# ── Delete flashcard ──────────────────────────────────────────

@router.delete("/{flashcard_id}", response_model=FlashcardDeleteResponse)
def delete_flashcard(
    flashcard_id: str,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> FlashcardDeleteResponse:
    fc = session.get(Flashcard, flashcard_id)
    if not fc:
        raise HTTPException(status_code=404, detail="Flashcard not found")
    require_document_owner(fc.document_id, current_user.id, session)
    # Also remove linked review items
    review_items = session.exec(
        select(ReviewItem).where(ReviewItem.source_ref == f"flashcard:{flashcard_id}")
    ).all()
    for ri in review_items:
        session.delete(ri)
    session.delete(fc)
    session.commit()
    return FlashcardDeleteResponse(id=flashcard_id, deleted=True)


# ── AI generate flashcards for one slide ──────────────────────

@router.post("/slide/{slide_id}/generate", response_model=FlashcardGenerateResponse)
def generate_flashcards(
    slide_id: str,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> FlashcardGenerateResponse:
    slide = session.get(Slide, slide_id)
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")
    require_document_owner(slide.document_id, current_user.id, session)

    explanation = session.exec(
        select(SlideExplanation).where(SlideExplanation.slide_id == slide_id)
    ).first()
    if not explanation:
        raise HTTPException(status_code=404, detail="No explanation for this slide")

    gateway = ModelGateway(timeout=8.0)
    if not gateway.is_configured():
        raise HTTPException(status_code=503, detail="Model gateway not configured")

    prompt = FLASHCARD_GEN_PROMPT.format(explanation=explanation.markdown)
    raw = gateway.generate_text_markdown(prompt=prompt).strip()

    # Parse JSON array from response
    try:
        # Strip markdown code fences if present
        cleaned = raw.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1]
        if cleaned.endswith("```"):
            cleaned = cleaned.rsplit("```", 1)[0]
        cards_data = json.loads(cleaned.strip())
    except (json.JSONDecodeError, IndexError):
        raise HTTPException(status_code=502, detail="Failed to parse flashcard response")

    created: list[Flashcard] = []
    for item in cards_data:
        fc = Flashcard(
            document_id=slide.document_id,
            slide_id=slide_id,
            front_md=item.get("front", ""),
            back_md=item.get("back", ""),
            source="auto",
        )
        session.add(fc)
        created.append(fc)

    session.commit()
    for fc in created:
        session.refresh(fc)

    ls = _get_or_create_session(session, slide.document_id)
    _create_review_items(session, created, ls.id)
    session.commit()

    return FlashcardGenerateResponse(slide_id=slide_id, count=len(created))


# ── Batch generate for entire document ────────────────────────

@router.post("/{document_id}/generate-all", response_model=FlashcardBatchGenerateResponse)
def generate_all_flashcards(
    document_id: str,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> FlashcardBatchGenerateResponse:
    require_document_owner(document_id, current_user.id, session)

    # Find slides that already have auto flashcards
    existing_slide_ids = set()
    existing = session.exec(
        select(Flashcard.slide_id)
        .where(Flashcard.document_id == document_id)
        .where(Flashcard.source == "auto")
    ).all()
    for row in existing:
        existing_slide_ids.add(row)

    explanations = session.exec(
        select(SlideExplanation)
        .where(SlideExplanation.document_id == document_id)
        .order_by(SlideExplanation.page_num)
    ).all()

    gateway = ModelGateway(timeout=8.0)
    if not gateway.is_configured():
        raise HTTPException(status_code=503, detail="Model gateway not configured")

    ls = _get_or_create_session(session, document_id)
    total = 0

    for exp in explanations:
        if exp.slide_id in existing_slide_ids:
            continue
        prompt = FLASHCARD_GEN_PROMPT.format(explanation=exp.markdown)
        try:
            raw = gateway.generate_text_markdown(prompt=prompt).strip()
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1]
            if cleaned.endswith("```"):
                cleaned = cleaned.rsplit("```", 1)[0]
            cards_data = json.loads(cleaned.strip())
        except Exception as exc:
            logger.warning("generate flashcards for slide %s failed: %s", exp.slide_id, exc)
            continue

        created: list[Flashcard] = []
        for item in cards_data:
            fc = Flashcard(
                document_id=document_id,
                slide_id=exp.slide_id,
                front_md=item.get("front", ""),
                back_md=item.get("back", ""),
                source="auto",
            )
            session.add(fc)
            created.append(fc)
        session.commit()
        for fc in created:
            session.refresh(fc)
        _create_review_items(session, created, ls.id)
        total += len(created)

    session.commit()
    return FlashcardBatchGenerateResponse(document_id=document_id, total_count=total)


# ── Stats ─────────────────────────────────────────────────────

@router.get("/{document_id}/stats", response_model=FlashcardStatsResponse)
def flashcard_stats(
    document_id: str,
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> FlashcardStatsResponse:
    require_document_owner(document_id, current_user.id, session)

    cards = session.exec(
        select(Flashcard).where(Flashcard.document_id == document_id)
    ).all()

    # Build card_id -> review_item map
    card_ids = [c.id for c in cards]
    review_items = session.exec(
        select(ReviewItem).where(
            ReviewItem.source_ref.in_([f"flashcard:{cid}" for cid in card_ids])
        )
    ).all() if card_ids else []
    ri_map: dict[str, ReviewItem] = {}
    for ri in review_items:
        fc_id = ri.source_ref.replace("flashcard:", "")
        ri_map[fc_id] = ri

    # Group by slide
    slide_groups: dict[str, list[Flashcard]] = {}
    for c in cards:
        slide_groups.setdefault(c.slide_id, []).append(c)

    slides_from_db = session.exec(
        select(Slide).where(Slide.document_id == document_id)
    ).all()
    slide_page_map = {s.id: s.page_num for s in slides_from_db}

    now = _utcnow()
    slide_stats = []
    total_all = 0
    mastered_all = 0
    due_all = 0

    for slide_id, group in slide_groups.items():
        total = len(group)
        mastered = 0
        due = 0
        for c in group:
            ri = ri_map.get(c.id)
            if ri and ri.easiness > 2.5 and ri.interval_days > 7:
                mastered += 1
            elif ri and ri.due_at <= now and ri.status == "pending":
                due += 1
            elif not ri:
                due += 1  # No review item = not started = due
        slide_stats.append(FlashcardSlideStats(
            slide_id=slide_id,
            page_num=slide_page_map.get(slide_id, 0),
            total=total,
            mastered=mastered,
            due=due,
        ))
        total_all += total
        mastered_all += mastered
        due_all += due

    slide_stats.sort(key=lambda s: s.page_num)

    return FlashcardStatsResponse(
        document_id=document_id,
        slides=slide_stats,
        total=total_all,
        mastered=mastered_all,
        due=due_all,
        mastery_percent=round(mastered_all / total_all * 100) if total_all else 0,
    )
