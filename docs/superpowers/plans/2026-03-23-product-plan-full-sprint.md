# Product Plan Full Sprint Implementation

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all code-actionable items from PRODUCT_PLAN.md — security hardening, auth enforcement, production deployment config, usage limits, UX improvements, legal pages, and account management.

**Architecture:** Backend-first approach. Fix security/auth across all 14 routers, add frontend auth integration (token storage + login/register UI), create production Docker configs with Caddy, add usage limits and monitoring, then UX and legal pages.

**Tech Stack:** FastAPI, Next.js 15, React 19, PostgreSQL 16, Docker Compose, Caddy, Tailwind CSS

---

## Chunk 1: Backend Security Hardening

### Task 1.1: Fix JWT_SECRET Default

**Files:**
- Modify: `backend/app/auth.py:12`

- [ ] **Step 1: Remove insecure default from JWT_SECRET**

```python
# auth.py line 12 — change from:
JWT_SECRET = os.getenv("JWT_SECRET", "dev-secret-change-in-production")
# to:
JWT_SECRET = os.getenv("JWT_SECRET", "")
if not JWT_SECRET:
    import warnings
    warnings.warn(
        "JWT_SECRET is not set! Using random secret (tokens won't survive restarts).",
        stacklevel=2,
    )
    import secrets
    JWT_SECRET = secrets.token_hex(32)
```

- [ ] **Step 2: Run existing auth tests**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && python -m pytest tests/ -q --tb=short 2>&1 | tail -20`

- [ ] **Step 3: Commit**

```bash
git add backend/app/auth.py
git commit -m "security: remove hardcoded JWT_SECRET default, warn and use random if unset"
```

### Task 1.2: Fix CORS Wildcard Fallback

**Files:**
- Modify: `backend/app/main.py:60`

- [ ] **Step 1: Remove `or ["*"]` fallback**

```python
# main.py line 60 — change from:
    allow_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()] or ["*"]
# to:
    allow_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
    if not allow_origins:
        import warnings
        warnings.warn(
            "CORS_ORIGINS is not set! Defaulting to localhost origins only.",
            stacklevel=2,
        )
        allow_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && python -m pytest tests/test_bootstrap.py -q`

- [ ] **Step 3: Commit**

```bash
git add backend/app/main.py
git commit -m "security: replace CORS wildcard fallback with localhost-only default"
```

### Task 1.3: Update Docker Compose Credentials

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env`

- [ ] **Step 1: Generate secure defaults and update docker-compose.yml**

Replace `teaching_pass` with env var reference:
```yaml
services:
  postgres:
    environment:
      POSTGRES_USER: teaching
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-teaching_pass_CHANGE_ME}
      POSTGRES_DB: teaching_learning
  backend:
    environment:
      - DATABASE_URL=postgresql://teaching:${POSTGRES_PASSWORD:-teaching_pass_CHANGE_ME}@postgres:5432/teaching_learning
```

- [ ] **Step 2: Add template vars to .env**

Append to `.env`:
```
# Database
POSTGRES_PASSWORD=teaching_pass_CHANGE_ME
# Auth
JWT_SECRET=CHANGE_ME_TO_RANDOM_64_CHAR_SECRET
```

- [ ] **Step 3: Update .env.example with all required vars**

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml .env .env.example
git commit -m "security: parameterize PostgreSQL password and JWT_SECRET in docker-compose"
```

### Task 1.4: Enforce Auth on ALL Data Routers

This is the largest security task. Currently 8/13 data routers have ZERO auth. Every endpoint that reads/writes user data must use `get_current_user`.

**Files to modify (all in `backend/app/api/`):**
- `documents.py` — change `get_optional_user` to `get_current_user`, add auth to all GET/DELETE endpoints
- `folders.py` — same pattern
- `sessions.py` — add `get_current_user` to all endpoints
- `chat.py` — add `get_current_user` to all endpoints
- `notes.py` — add `get_current_user` to all endpoints
- `notebooks.py` — add `get_current_user` to all endpoints
- `quizzes.py` — add `get_current_user` to all endpoints
- `review.py` — add `get_current_user` to all endpoints
- `analytics.py` — add `get_current_user` to all endpoints
- `slide_notes.py` — add `get_current_user` to all endpoints
- `bookmarks.py` — add `get_current_user` to all endpoints
- `flashcards.py` — add `get_current_user` to all endpoints
- `knowledge_graph.py` — add `get_current_user` to all endpoints

**Pattern for each router:**

1. Add import: `from app.auth import get_current_user`
2. Add `current_user: User = Depends(get_current_user)` to every endpoint function signature
3. Add `user_id` filter to all database queries (e.g., `.where(Document.user_id == current_user.id)`)
4. For creation endpoints, set `user_id = current_user.id` on new records

- [ ] **Step 1: Update documents.py** — switch all endpoints to `get_current_user`, filter by `user_id`
- [ ] **Step 2: Update folders.py** — same pattern
- [ ] **Step 3: Update sessions.py** — add auth, filter by `user_id`
- [ ] **Step 4: Update chat.py** — add auth, validate session belongs to user
- [ ] **Step 5: Update notes.py** — add auth, filter by user
- [ ] **Step 6: Update notebooks.py** — add auth, filter by user (via document ownership)
- [ ] **Step 7: Update quizzes.py** — add auth
- [ ] **Step 8: Update review.py** — add auth
- [ ] **Step 9: Update analytics.py** — add auth
- [ ] **Step 10: Update slide_notes.py** — add auth
- [ ] **Step 11: Update bookmarks.py** — add auth
- [ ] **Step 12: Update flashcards.py** — add auth
- [ ] **Step 13: Update knowledge_graph.py** — add auth
- [ ] **Step 14: Run full backend test suite, fix failures**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/backend && python -m pytest tests/ -q --tb=short`

- [ ] **Step 15: Commit**

```bash
git add backend/app/api/
git commit -m "security: enforce auth on all data endpoints, filter by user_id"
```

---

## Chunk 2: Frontend Auth Integration

### Task 2.1: Add Auth Token Storage and API Headers

**Files:**
- Modify: `frontend/lib/api.ts` — add Authorization header to all requests
- Create: `frontend/lib/auth.ts` — token storage utilities

- [ ] **Step 1: Create auth utility** (`frontend/lib/auth.ts`)

```typescript
const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function setUser(user: AuthUser): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isAuthenticated(): boolean {
  return !!getToken();
}
```

- [ ] **Step 2: Update api.ts request function to include auth header**

In the `request()` function, add:
```typescript
import { getToken } from "./auth";

// Inside request(), before fetch():
const token = getToken();
const headers: Record<string, string> = {
  ...(init?.headers as Record<string, string>),
};
if (token) {
  headers["Authorization"] = `Bearer ${token}`;
}
```

- [ ] **Step 3: Add login/register API functions** to `api.ts`

```typescript
export async function login(email: string, password: string) {
  return request<{ access_token: string; user: AuthUser }>("/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
}

export async function register(email: string, password: string, displayName: string) {
  return request<{ access_token: string; user: AuthUser }>("/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, display_name: displayName }),
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/auth.ts frontend/lib/api.ts
git commit -m "feat: add frontend auth token storage and API auth headers"
```

### Task 2.2: Create Login/Register Page

**Files:**
- Create: `frontend/app/login/page.tsx`
- Create: `frontend/components/auth-form.tsx`
- Modify: `frontend/app/page.tsx` — add auth guard redirect

- [ ] **Step 1: Create auth-form component** with login/register tabs
- [ ] **Step 2: Create login page** at `frontend/app/login/page.tsx`
- [ ] **Step 3: Add auth guard** to main page — redirect to `/login` if not authenticated
- [ ] **Step 4: Commit**

```bash
git add frontend/app/login/ frontend/components/auth-form.tsx frontend/app/page.tsx
git commit -m "feat: add login/register page with auth guard"
```

### Task 2.3: Create Landing Page

**Files:**
- Create: `frontend/app/landing/page.tsx` or modify `frontend/app/page.tsx`

- [ ] **Step 1: Create landing page** with product description, features, and CTA to login/register
- [ ] **Step 2: Route logic**: unauthenticated → landing, authenticated → app
- [ ] **Step 3: Commit**

```bash
git add frontend/app/
git commit -m "feat: add landing page for unauthenticated users"
```

---

## Chunk 3: Production Deployment Config

### Task 3.1: Create Production Frontend Dockerfile

**Files:**
- Create: `frontend/Dockerfile.prod`

- [ ] **Step 1: Create multi-stage production Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["npm", "start"]
```

- [ ] **Step 2: Test build**

Run: `cd /Users/shihaochen/github/Teaching-Learning-/frontend && docker build -f Dockerfile.prod -t tl-frontend-prod .`

- [ ] **Step 3: Commit**

```bash
git add frontend/Dockerfile.prod
git commit -m "feat: add production frontend Dockerfile with multi-stage build"
```

### Task 3.2: Add Frontend Health Check

**Files:**
- Create: `frontend/app/api/health/route.ts`

- [ ] **Step 1: Create health endpoint**

```typescript
import { NextResponse } from "next/server";
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/app/api/health/route.ts
git commit -m "feat: add frontend /api/health endpoint"
```

### Task 3.3: Create Production Docker Compose + Caddy

**Files:**
- Create: `docker-compose.prod.yml`
- Create: `Caddyfile`

- [ ] **Step 1: Create Caddyfile**

```
{$DOMAIN:localhost} {
    handle /api/* {
        reverse_proxy backend:8000
    }
    handle /storage/* {
        reverse_proxy backend:8000
    }
    handle {
        reverse_proxy frontend:3000
    }
}
```

- [ ] **Step 2: Create docker-compose.prod.yml** with Caddy, no exposed ports except 80/443, production frontend Dockerfile
- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml Caddyfile
git commit -m "feat: add production docker-compose with Caddy reverse proxy"
```

### Task 3.4: Create Backup Script

**Files:**
- Create: `scripts/backup-db.sh`

- [ ] **Step 1: Create backup script**

```bash
#!/usr/bin/env bash
set -euo pipefail
BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
FILENAME="db_$(date +%Y%m%d_%H%M%S).sql.gz"
docker exec postgres pg_dump -U teaching teaching_learning | gzip > "$BACKUP_DIR/$FILENAME"
echo "Backup created: $BACKUP_DIR/$FILENAME"
find "$BACKUP_DIR" -name "db_*.sql.gz" -mtime +"$KEEP_DAYS" -delete
echo "Old backups cleaned (kept last $KEEP_DAYS days)"
```

- [ ] **Step 2: Commit**

```bash
git add scripts/backup-db.sh
git commit -m "feat: add database backup script with retention policy"
```

---

## Chunk 4: Usage Limits & Monitoring

### Task 4.1: Add Per-User Usage Limits

**Files:**
- Create: `backend/app/services/usage_limits.py`
- Modify: `backend/app/api/documents.py` — check storage/document limits on upload
- Modify: `backend/app/services/explanation_engine.py` — check page generation limits

- [ ] **Step 1: Create usage_limits.py**

```python
import os
from fastapi import HTTPException
from sqlmodel import Session, select, func
from app.models import Document, LLMUsage, User

MAX_DOCUMENTS = int(os.getenv("MAX_DOCUMENTS_PER_USER", "20"))
MAX_STORAGE_MB = int(os.getenv("MAX_STORAGE_MB_PER_USER", "500"))
MAX_PAGES_PER_MONTH = int(os.getenv("MAX_PAGES_PER_MONTH", "100"))
MAX_CHAT_PER_DAY = int(os.getenv("MAX_CHAT_PER_DAY", "20"))

def check_document_limit(session: Session, user_id: str) -> None:
    count = session.exec(
        select(func.count()).select_from(Document).where(Document.user_id == user_id)
    ).one()
    if count >= MAX_DOCUMENTS:
        raise HTTPException(status_code=429, detail=f"Document limit reached ({MAX_DOCUMENTS})")

def check_monthly_page_limit(session: Session, user_id: str) -> int:
    """Returns pages used this month. Raises 429 if over limit."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    used = session.exec(
        select(func.count()).select_from(LLMUsage)
        .where(LLMUsage.user_id == user_id)
        .where(LLMUsage.created_at >= start_of_month)
    ).one()
    if used >= MAX_PAGES_PER_MONTH:
        raise HTTPException(
            status_code=429,
            detail=f"Monthly page limit reached ({used}/{MAX_PAGES_PER_MONTH})"
        )
    return used

def get_usage_stats(session: Session, user_id: str) -> dict:
    """Return current usage for display in UI."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    doc_count = session.exec(
        select(func.count()).select_from(Document).where(Document.user_id == user_id)
    ).one()
    pages_used = session.exec(
        select(func.count()).select_from(LLMUsage)
        .where(LLMUsage.user_id == user_id)
        .where(LLMUsage.created_at >= start_of_month)
    ).one()
    return {
        "documents": {"used": doc_count, "limit": MAX_DOCUMENTS},
        "pages_this_month": {"used": pages_used, "limit": MAX_PAGES_PER_MONTH},
    }
```

- [ ] **Step 2: Add limit checks to document upload and explanation generation**
- [ ] **Step 3: Add GET /usage endpoint** for frontend to display
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git add backend/app/services/usage_limits.py backend/app/api/
git commit -m "feat: add per-user usage limits (documents, pages/month, chat/day)"
```

### Task 4.2: Add Structured Logging

**Files:**
- Create: `backend/app/logging_config.py`
- Modify: `backend/app/main.py` — add logging middleware

- [ ] **Step 1: Create logging config with JSON structured output**
- [ ] **Step 2: Add request logging middleware** (request_id, user_id, endpoint, latency, status)
- [ ] **Step 3: Commit**

```bash
git add backend/app/logging_config.py backend/app/main.py
git commit -m "feat: add structured JSON logging with request_id and user context"
```

### Task 4.3: Add Admin CLI Script

**Files:**
- Create: `scripts/admin-stats.py`

- [ ] **Step 1: Create admin stats script** that queries PostgreSQL for:
  - Total users, documents uploaded today, LLM cost today, error count
- [ ] **Step 2: Commit**

```bash
git add scripts/admin-stats.py
git commit -m "feat: add admin CLI stats script for monitoring"
```

---

## Chunk 5: UX Improvements

### Task 5.1: Add Loading States for LLM Content

**Files:**
- Modify: `frontend/components/ai-panel.tsx` — add skeleton/spinner during generation
- Modify: relevant components that trigger LLM calls

- [ ] **Step 1: Add loading skeleton components**
- [ ] **Step 2: Add loading states to explanation generation, chat, quiz generation**
- [ ] **Step 3: Commit**

```bash
git add frontend/components/
git commit -m "feat: add loading skeletons for LLM-generated content"
```

### Task 5.2: Add Error Toast System

**Files:**
- Create: `frontend/components/toast.tsx` — toast notification component
- Create: `frontend/hooks/useToast.ts` — toast state management
- Modify: `frontend/app/layout.tsx` — add toast container
- Modify: `frontend/lib/api.ts` — surface errors to toast

- [ ] **Step 1: Create toast component and hook**
- [ ] **Step 2: Integrate toast into API error handling**
- [ ] **Step 3: Add toast container to layout**
- [ ] **Step 4: Commit**

```bash
git add frontend/components/toast.tsx frontend/hooks/useToast.ts frontend/app/layout.tsx frontend/lib/api.ts
git commit -m "feat: add error toast notification system"
```

---

## Chunk 6: Legal & Account Management

### Task 6.1: Add Terms of Service and Privacy Policy Pages

**Files:**
- Create: `frontend/app/terms/page.tsx`
- Create: `frontend/app/privacy/page.tsx`

- [ ] **Step 1: Create Terms of Service page** covering:
  - Users may only upload materials they have legitimate access to
  - Uploaded materials are for personal study use only
  - No sharing/redistribution of copyrighted content
  - Service provided as-is, maintained by solo student developer

- [ ] **Step 2: Create Privacy Policy page** covering:
  - Data collected: email, display name, usage data, uploaded documents
  - Why: to provide the learning service
  - Third-party: DashScope/Alibaba Cloud (data sent to mainland China servers)
  - Retention: until user requests deletion
  - User rights: access, correction, deletion

- [ ] **Step 3: Add links to registration page**
- [ ] **Step 4: Commit**

```bash
git add frontend/app/terms/ frontend/app/privacy/
git commit -m "feat: add Terms of Service and Privacy Policy pages"
```

### Task 6.2: Add Account Deletion Feature

**Files:**
- Create: `backend/app/api/account.py` — DELETE /account endpoint
- Modify: `backend/app/main.py` — include account router
- Create: `frontend/components/account-settings.tsx` — delete account UI

- [ ] **Step 1: Create backend DELETE /account endpoint** that:
  - Requires auth (`get_current_user`)
  - Deletes all user data: documents, slides, explanations, sessions, messages, notes, notebooks, quizzes, flashcards, bookmarks, concepts, review items, LLM usage records
  - Deletes uploaded files from storage
  - Deletes the user record
  - Returns 204

- [ ] **Step 2: Add account router to main.py**
- [ ] **Step 3: Create frontend account settings** with delete account button + confirmation dialog
- [ ] **Step 4: Run tests**
- [ ] **Step 5: Commit**

```bash
git add backend/app/api/account.py backend/app/main.py frontend/components/account-settings.tsx
git commit -m "feat: add account deletion (PDPO compliance)"
```

---

## Chunk 7: LLM Error Handling Improvements

### Task 7.1: Improve Error Handling in Explanation Engine

**Files:**
- Modify: `backend/app/services/explanation_engine.py:633` — log errors instead of silent `pass`

- [ ] **Step 1: Add error logging to dual pipeline fallback**

```python
# Line 633: change from:
except Exception:
    pass
# to:
except Exception as exc:
    import logging
    logging.getLogger(__name__).warning("Dual pipeline failed, falling back: %s", exc)
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/services/explanation_engine.py
git commit -m "fix: log errors in dual pipeline fallback instead of silent pass"
```
