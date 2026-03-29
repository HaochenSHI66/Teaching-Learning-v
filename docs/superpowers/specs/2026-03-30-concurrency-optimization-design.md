# Concurrency Optimization

## Problem

1. Multiple uvicorn processes linger — no unified process management, manual start/stop causes conflicts
2. SQLite single-writer lock — concurrent writes block each other
3. LLM API calls are synchronous blocking — one user generating explanations blocks all other requests
4. No startup script — manually starting each service is error-prone

## Solution

### 1. Unified start/stop script (`scripts/serve.sh`)

```bash
# scripts/serve.sh start  — kills old processes, starts backend + frontend + tunnel
# scripts/serve.sh stop   — kills all managed processes
# scripts/serve.sh restart — stop + start
```

Manages: uvicorn (backend), next (frontend), cloudflared (tunnel).
Writes PIDs to `/tmp/teaching-learning-*.pid` for clean shutdown.

### 2. SQLite WAL mode

Enable Write-Ahead Logging on database engine creation in `db.py`:

```python
engine = create_engine(url, connect_args={"check_same_thread": False})

@event.listens_for(engine, "connect")
def set_sqlite_pragma(dbapi_conn, connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()
```

WAL allows concurrent reads while writing. `busy_timeout=5000` waits up to 5s instead of failing immediately on lock contention.

### 3. LLM calls in thread pool

Wrap synchronous LLM calls in `asyncio.to_thread()` so they don't block the event loop. Convert the explanation generation endpoint to async:

```python
@router.post("/{document_id}/slides/{slide_id}/explanations/generate")
async def regenerate_slide_explanation(...):
    # ... setup ...
    explanation, overwrote = await asyncio.run_in_executor(
        None, _upsert_slide_explanation, ...
    )
    # ... response ...
```

This lets other requests (page loads, image serving, chat) proceed while LLM is processing.

### 4. CORS hardcoded

Replace environment-dependent CORS config with a simple `allow_origins=["*"]` — already done, just clean up the dead code.

## Files to Create/Modify

| File | Action |
|------|--------|
| `scripts/serve.sh` | Create — unified start/stop/restart |
| `backend/app/db.py` | Modify — add WAL mode pragma |
| `backend/app/api/documents.py` | Modify — async LLM endpoints |
| `backend/app/main.py` | Modify — clean up CORS dead code |

## What Does NOT Change

- Frontend code (no changes needed)
- Database schema
- LLM pipeline logic
- Cloudflare tunnel config
