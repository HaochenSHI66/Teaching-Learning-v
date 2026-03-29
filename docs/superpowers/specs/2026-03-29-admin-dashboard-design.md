# Admin Dashboard

## Problem

No way to manage users, monitor system health, or view usage statistics. The app owner needs visibility into how the platform is being used.

## Solution

Single-page admin dashboard at `/admin` with 4 modules: user management, usage statistics, system monitoring, content management. Access restricted to users with `is_admin=True`.

## Permission Model

- `User.is_admin: bool = False` field added to User model
- Backend: `require_admin` FastAPI dependency — checks `user.is_admin`, returns 403 if not
- Frontend: middleware blocks `/admin` for non-admin users (redirect to `/`)
- Bootstrap: manually set `is_admin=True` in DB for the owner's account

## Backend API

All endpoints require admin authentication.

### `GET /api/v1/admin/stats`

Returns aggregated statistics:

```json
{
  "total_users": 5,
  "total_documents": 47,
  "total_explanations": 2459,
  "today_explanations": 59,
  "daily_explanations": [
    {"date": "2026-03-29", "count": 59},
    {"date": "2026-03-28", "count": 0},
    ...
  ]
}
```

### `GET /api/v1/admin/users`

Returns all users with their document counts:

```json
{
  "users": [
    {
      "id": "...",
      "email": "user@example.com",
      "display_name": "Alice",
      "is_admin": false,
      "is_disabled": false,
      "created_at": "2026-03-01T...",
      "document_count": 12
    }
  ]
}
```

### `PATCH /api/v1/admin/users/{user_id}`

Toggle disable/enable:

```json
{"is_disabled": true}
```

### `GET /api/v1/admin/documents`

Returns all documents across all users with explanation coverage:

```json
{
  "documents": [
    {
      "id": "...",
      "filename": "lecture8.pdf",
      "owner_email": "user@example.com",
      "owner_name": "Alice",
      "page_count": 59,
      "explanation_count": 59,
      "coverage": 1.0,
      "created_at": "2026-03-26T..."
    }
  ]
}
```

### `DELETE /api/v1/admin/documents/{document_id}`

Deletes document and all related records (slides, explanations, concepts, notes).

### `GET /api/v1/admin/system`

Returns system health info:

```json
{
  "status": "running",
  "db_size_mb": 45.2,
  "storage_size_mb": 1200.5,
  "llm_configured": true,
  "vision_configured": true,
  "uptime_seconds": 3600
}
```

## Database Changes

### User model

Add two fields:

```python
is_admin: bool = Field(default=False)
is_disabled: bool = Field(default=False)
```

### Auth changes

- `require_admin` dependency: calls `get_current_user`, checks `is_admin`, raises 403 if not
- `get_current_user`: check `is_disabled`, raise 401 if disabled

## Frontend

### `/admin` page

Single page with 4 card sections, all data fetched on mount.

**Header:** "管理后台" title

**Section 1 — Usage Statistics:**
- 4 stat cards in a row: total users, total documents, total explanations, today's explanations
- Bar chart: daily explanation generation count (last 7 days) — use simple div-based bars, no chart library

**Section 2 — User Management:**
- Table: display_name, email, document_count, created_at, status (active/disabled), action button
- Action: toggle disable/enable

**Section 3 — Content Management:**
- Table: filename, owner, page_count, coverage (as percentage), created_at, delete button
- Coverage shown as colored bar (green >80%, amber >50%, red <50%)

**Section 4 — System Monitoring:**
- Info cards: DB size, storage size, LLM config status, uptime
- Status indicators: green dot for healthy, red for issues

### Middleware

Add `/admin` to the middleware matcher. Check if user has admin flag via a lightweight API call or a cookie/localStorage flag set at login.

Simpler approach: the admin page itself checks on mount — if user is not admin, redirect. No middleware change needed for admin specifically since auth middleware already requires login.

## Files to Create/Modify

| File | Action |
|------|--------|
| `backend/app/models.py` | Modify — add `is_admin`, `is_disabled` to User |
| `backend/app/api/admin.py` | Create — all admin API endpoints |
| `backend/app/auth.py` | Modify — add `require_admin`, check `is_disabled` |
| `backend/app/main.py` | Modify — register admin router |
| `frontend/app/admin/page.tsx` | Create — dashboard page |
| `frontend/lib/api.ts` | Modify — add admin API functions |

## What Does NOT Change

- Existing user-facing features
- Document upload/generation flow
- Explanation rendering
- Chat/追问 functionality
