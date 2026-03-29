# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin dashboard at `/admin` with user management, usage statistics, system monitoring, and content management.

**Architecture:** Backend adds `is_admin`/`is_disabled` fields to User model, a `require_admin` dependency, and a new `admin.py` router with 6 endpoints. Frontend adds a single `/admin` page with 4 card sections fetching data on mount.

**Tech Stack:** FastAPI, SQLModel, Next.js 15, React 19, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-29-admin-dashboard-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/app/models.py` | Modify | Add `is_admin`, `is_disabled` to User |
| `backend/app/auth.py` | Modify | Add `require_admin` dep, check `is_disabled` |
| `backend/app/api/admin.py` | Create | All admin API endpoints |
| `backend/app/main.py` | Modify | Register admin router |
| `frontend/app/admin/page.tsx` | Create | Dashboard UI |
| `frontend/lib/api.ts` | Modify | Admin API client functions |

---

## Task 1: User Model + Auth Changes

**Files:**
- Modify: `backend/app/models.py`
- Modify: `backend/app/auth.py`

- [ ] **Step 1: Add fields to User model**

In `backend/app/models.py`, add to the `User` class:

```python
is_admin: bool = Field(default=False)
is_disabled: bool = Field(default=False)
```

- [ ] **Step 2: Add `require_admin` and disabled check to auth.py**

In `backend/app/auth.py`, add after `get_optional_user`:

```python
def require_admin(request: Request) -> User:
    """FastAPI dependency: requires admin user. Raises 403 if not admin."""
    user = get_current_user(request)
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
```

Also modify `get_current_user` to check `is_disabled` — after getting the user from DB (around line 82-89), add:

```python
        if user.is_disabled:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Account is disabled",
            )
```

- [ ] **Step 3: Run DB migration**

SQLite with SQLModel — just need to add columns. Run:

```python
# In a one-off script or shell:
import sqlite3
conn = sqlite3.connect("storage/app.db")
conn.execute("ALTER TABLE user ADD COLUMN is_admin BOOLEAN DEFAULT 0")
conn.execute("ALTER TABLE user ADD COLUMN is_disabled BOOLEAN DEFAULT 0")
conn.commit()
conn.close()
```

- [ ] **Step 4: Set yourself as admin**

```python
conn.execute("UPDATE user SET is_admin = 1 WHERE email = '<your-email>'")
conn.commit()
```

- [ ] **Step 5: Commit**

```bash
git add backend/app/models.py backend/app/auth.py
git commit -m "feat: add is_admin/is_disabled to User model and require_admin dependency"
```

---

## Task 2: Admin API Endpoints

**Files:**
- Create: `backend/app/api/admin.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Create admin.py with all endpoints**

Create `backend/app/api/admin.py`:

```python
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

    # Daily counts for last 7 days
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
            is_admin=u.is_admin,
            is_disabled=u.is_disabled,
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
            owner_email=owner.email if owner else "unknown",
            owner_name=owner.display_name if owner else "unknown",
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

    # Delete related records
    from app.api.documents import _delete_document_related_records
    _delete_document_related_records(session=session, document_id=document_id)
    session.delete(document)
    session.commit()

    # Delete files
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

    # DB size
    db_path = storage_dir / "app.db"
    db_size_mb = db_path.stat().st_size / (1024 * 1024) if db_path.exists() else 0.0

    # Storage size
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
```

- [ ] **Step 2: Register router in main.py**

In `backend/app/main.py`, add import and include:

```python
from app.api.admin import router as admin_router
# ... in create_app():
app.include_router(admin_router)
```

- [ ] **Step 3: Commit**

```bash
git add backend/app/api/admin.py backend/app/main.py
git commit -m "feat: add admin API endpoints"
```

---

## Task 3: Frontend Admin Dashboard

**Files:**
- Create: `frontend/app/admin/page.tsx`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add admin API functions to api.ts**

At the end of `frontend/lib/api.ts`, add:

```typescript
// ── Admin API ────────────────────────────────────────────────

export type AdminStats = {
  total_users: number;
  total_documents: number;
  total_explanations: number;
  today_explanations: number;
  daily_explanations: { date: string; count: number }[];
};

export type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  is_disabled: boolean;
  created_at: string;
  document_count: number;
};

export type AdminDocument = {
  id: string;
  filename: string;
  owner_email: string;
  owner_name: string;
  page_count: number;
  explanation_count: number;
  coverage: number;
  created_at: string;
};

export type AdminSystem = {
  status: string;
  db_size_mb: number;
  storage_size_mb: number;
  llm_configured: boolean;
  vision_configured: boolean;
  uptime_seconds: number;
};

export async function fetchAdminStats(): Promise<AdminStats> {
  return request<AdminStats>("/api/v1/admin/stats");
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const data = await request<{ users: AdminUser[] }>("/api/v1/admin/users");
  return data.users;
}

export async function updateAdminUser(userId: string, body: { is_disabled?: boolean; is_admin?: boolean }): Promise<void> {
  await request("/api/v1/admin/users/" + userId, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function fetchAdminDocuments(): Promise<AdminDocument[]> {
  const data = await request<{ documents: AdminDocument[] }>("/api/v1/admin/documents");
  return data.documents;
}

export async function deleteAdminDocument(documentId: string): Promise<void> {
  await request("/api/v1/admin/documents/" + documentId, { method: "DELETE" });
}

export async function fetchAdminSystem(): Promise<AdminSystem> {
  return request<AdminSystem>("/api/v1/admin/system");
}
```

- [ ] **Step 2: Create admin page**

Create `frontend/app/admin/page.tsx` — full dashboard with 4 sections. Uses existing Tailwind CSS variables for consistent theming.

(Full code provided in implementation — a single-file React component with useState/useEffect, 4 sections rendered as cards with tables and stat blocks.)

- [ ] **Step 3: Build and verify**

```bash
cd frontend && npx next build --no-lint
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/admin/page.tsx frontend/lib/api.ts
git commit -m "feat: add admin dashboard frontend"
```

---

## Task 4: DB Migration + Set Admin

- [ ] **Step 1: Add columns to existing DB**

```bash
cd backend && python3 -c "
import sqlite3
conn = sqlite3.connect('../storage/app.db')
try: conn.execute('ALTER TABLE user ADD COLUMN is_admin BOOLEAN DEFAULT 0')
except: pass
try: conn.execute('ALTER TABLE user ADD COLUMN is_disabled BOOLEAN DEFAULT 0')
except: pass
conn.commit()
conn.close()
print('done')
"
```

- [ ] **Step 2: Set admin user**

```bash
python3 -c "
import sqlite3
conn = sqlite3.connect('../storage/app.db')
conn.execute('UPDATE user SET is_admin = 1 WHERE rowid = 1')
conn.commit()
print('Updated', conn.total_changes, 'rows')
conn.close()
"
```

- [ ] **Step 3: Rebuild frontend and restart**

```bash
pkill -f 'next start'; cd frontend && npx next build --no-lint && nohup npx next start -p 3000 > /tmp/frontend.log 2>&1 &
```
