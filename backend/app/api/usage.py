from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlmodel import Session

from app.api.deps import get_db_session
from app.auth import get_current_user
from app.models import User
from app.services.usage_limits import get_usage_stats

router = APIRouter(prefix="/api/v1", tags=["usage"])


@router.get("/usage")
def get_user_usage(
    session: Session = Depends(get_db_session),
    current_user: User = Depends(get_current_user),
) -> dict:
    return get_usage_stats(session, current_user.id)
