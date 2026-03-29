from __future__ import annotations

import os
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func as sa_func
from sqlmodel import Session, select

from app.api.deps import get_db_session
from app.auth import require_admin
from app.models import Document, User, Slide, SlideExplanation

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

_start_time = time.time()


# ── Response Models ───────────────────────────────────────────

class DailyCount(BaseModel):
    date: str
    count: int

class StatsResponse(BaseModel):
    total_users: int
    total_documents: int
    total_explanations: int
    today_explanations: int
    daily_explanations: list[DailyCount]

class UserItem(BaseModel):
    id: str
    email: str
    display_name: str
    is_admin: bool
    is_disabled: bool
    created_at: datetime
    document_count: int

class UsersResponse(BaseModel):
    users: list[UserItem]

class UserUpdateRequest(BaseModel):
    is_disabled: bool | None = None
    is_admin: bool | None = None

class DocumentItem(BaseModel):
    id: str
    filename: str
    owner_email: str
    owner_name: str
    page_count: int
    explanation_count: int
    coverage: float
    created_at: datetime

class DocumentsResponse(BaseModel):
    documents: list[DocumentItem]

class SystemResponse(BaseModel):
    status: str
    db_size_mb: float
    storage_size_mb: float
    llm_configured: bool
    vision_configured: bool
    uptime_seconds: int


# ── Endpoints ─────────────────────────────────────────────────

@router.get("/stats", response_model=StatsResponse)
def get_stats(
    session: Session = Depends(get_db_session),
    _admin: User = Depends(require_admin),
) -> StatsResponse:
    total_users = session.exec(select(sa_func.count(User.id))).one()
    total_documents = session.exec(select(sa_func.count(Document.id))).one()
    total_explanations = session.exec(select(sa_func.count(SlideExplanation.id))).one()

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_explanations = session.exec(
        select(sa_func.count(SlideExplanation.id))
        .where(SlideExplanation.generated_at >= today_start)
    ).one()

    daily: list[DailyCount] = []
    for i in range(6, -1, -1):
        day = today_start - timedelta(days=i)
        next_day = day + timedelta(days=1)
        count = session.exec(
            select(sa_func.count(SlideExplanation.id))
            .where(SlideExplanation.generated_at >= day)
            .where(SlideExplanation.generated_at < next_day)
        ).one()
        daily.append(DailyCount(date=day.strftime("%m-%d"), count=count))

    return StatsResponse(
        total_users=total_users,
        total_documents=total_documents,
        total_explanations=total_explanations,
        today_explanations=today_explanations,
        daily_explanations=daily,
    )


@router.get("/users", response_model=UsersResponse)
def list_users(
    session: Session = Depends(get_db_session),
    _admin: User = Depends(require_admin),
) -> UsersResponse:
    users = session.exec(select(User).order_by(User.created_at.desc())).all()
    items = []
    for u in users:
        doc_count = session.exec(
            select(sa_func.count(Document.id)).where(Document.user_id == u.id)
        ).one()
        items.append(UserItem(
            id=u.id,
            email=u.email,
            display_name=u.display_name,
            is_admin=getattr(u, "is_admin", False),
            is_disabled=getattr(u, "is_disabled", False),
            created_at=u.created_at,
            document_count=doc_count,
        ))
    return UsersResponse(users=items)


@router.patch("/users/{user_id}")
def update_user(
    user_id: str,
    body: UserUpdateRequest,
    session: Session = Depends(get_db_session),
    _admin: User = Depends(require_admin),
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.is_disabled is not None:
        user.is_disabled = body.is_disabled
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    session.add(user)
    session.commit()
    return {"ok": True}


@router.get("/documents", response_model=DocumentsResponse)
def list_documents(
    session: Session = Depends(get_db_session),
    _admin: User = Depends(require_admin),
) -> DocumentsResponse:
    documents = session.exec(select(Document).order_by(Document.created_at.desc())).all()
    items = []
    for doc in documents:
        owner = session.get(User, doc.user_id) if doc.user_id else None
        explanation_count = session.exec(
            select(sa_func.count(SlideExplanation.id))
            .where(SlideExplanation.document_id == doc.id)
        ).one()
        coverage = (explanation_count / doc.page_count) if doc.page_count > 0 else 0.0
        items.append(DocumentItem(
            id=doc.id,
            filename=doc.filename,
            owner_email=owner.email if owner else "—",
            owner_name=owner.display_name if owner else "—",
            page_count=doc.page_count,
            explanation_count=explanation_count,
            coverage=round(min(coverage, 1.0), 2),
            created_at=doc.created_at,
        ))
    return DocumentsResponse(documents=items)


@router.delete("/documents/{document_id}")
def delete_document(
    document_id: str,
    request: Request,
    session: Session = Depends(get_db_session),
    _admin: User = Depends(require_admin),
):
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    from app.api.documents import _delete_document_related_records
    _delete_document_related_records(session=session, document_id=document_id)
    session.delete(document)
    session.commit()

    document_dir = request.app.state.storage_dir / document.storage_path
    if document_dir.exists():
        import shutil
        shutil.rmtree(document_dir, ignore_errors=True)

    return {"ok": True}


@router.get("/system", response_model=SystemResponse)
def get_system_info(
    request: Request,
    _admin: User = Depends(require_admin),
) -> SystemResponse:
    storage_dir: Path = request.app.state.storage_dir

    db_path = storage_dir / "app.db"
    db_size_mb = db_path.stat().st_size / (1024 * 1024) if db_path.exists() else 0.0

    storage_size_mb = sum(
        f.stat().st_size for f in storage_dir.rglob("*") if f.is_file()
    ) / (1024 * 1024)

    return SystemResponse(
        status="running",
        db_size_mb=round(db_size_mb, 1),
        storage_size_mb=round(storage_size_mb, 1),
        llm_configured=bool(os.getenv("TEXT_API_KEY")),
        vision_configured=bool(os.getenv("VISION_API_KEY")),
        uptime_seconds=int(time.time() - _start_time),
    )
