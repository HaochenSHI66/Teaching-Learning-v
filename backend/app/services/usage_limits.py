from __future__ import annotations

import os
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlmodel import Session, select, func

from app.models import Document

MAX_DOCUMENTS = int(os.getenv("MAX_DOCUMENTS_PER_USER", "200"))
MAX_STORAGE_MB = int(os.getenv("MAX_STORAGE_MB_PER_USER", "2000"))
MAX_PAGES_PER_MONTH = int(os.getenv("MAX_PAGES_PER_MONTH", "5000"))
MAX_CHAT_PER_DAY = int(os.getenv("MAX_CHAT_PER_DAY", "200"))


def check_document_limit(session: Session, user_id: str) -> None:
    """Raise 429 if user has reached document limit."""
    count = session.exec(
        select(func.count()).select_from(Document).where(Document.user_id == user_id)
    ).one()
    if count >= MAX_DOCUMENTS:
        raise HTTPException(
            status_code=429,
            detail=f"已达到文档上限 ({MAX_DOCUMENTS}个)"
        )


def check_monthly_page_limit(session: Session, user_id: str) -> int:
    """Return pages used this month. Raise 429 if over limit."""
    now = datetime.now(timezone.utc)
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used = session.exec(
        select(func.coalesce(func.sum(Document.page_count), 0))
        .where(Document.user_id == user_id)
        .where(Document.created_at >= start_of_month)
    ).one()
    if used >= MAX_PAGES_PER_MONTH:
        raise HTTPException(
            status_code=429,
            detail=f"本月页面生成已达上限 ({used}/{MAX_PAGES_PER_MONTH})"
        )
    return used


def get_usage_stats(session: Session, user_id: str) -> dict:
    """Return current usage stats for the user."""
    now = datetime.now(timezone.utc)
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    doc_count = session.exec(
        select(func.count()).select_from(Document).where(Document.user_id == user_id)
    ).one()

    pages_used = session.exec(
        select(func.coalesce(func.sum(Document.page_count), 0))
        .where(Document.user_id == user_id)
        .where(Document.created_at >= start_of_month)
    ).one()

    return {
        "documents": {"used": doc_count, "limit": MAX_DOCUMENTS},
        "pages_this_month": {"used": pages_used, "limit": MAX_PAGES_PER_MONTH},
    }
