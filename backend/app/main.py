from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from app.logging_config import setup_logging, RequestLoggingMiddleware
from app.api.account import router as account_router
from app.api.analytics import router as analytics_router
from app.api.auth import router as auth_router
from app.api.bookmarks import router as bookmarks_router
from app.api.chat import router as chat_router
from app.api.documents import router as documents_router
from app.api.export_notes import router as export_notes_router
from app.api.flashcards import router as flashcards_router
from app.api.folders import router as folders_router
from app.api.knowledge_graph import router as knowledge_graph_router
from app.api.notebooks import router as notebooks_router
from app.api.notes import router as notes_router
from app.api.quizzes import router as quizzes_router
from app.api.review import router as review_router
from app.api.sessions import router as sessions_router
from app.api.slide_notes import router as slide_notes_router
from app.api.sync import router as sync_router
from app.api.admin import router as admin_router
from app.api.usage import router as usage_router
from app.db import create_db_engine, ensure_storage, get_database_url, init_db


def _load_environment_files() -> None:
    candidates = [
        Path.cwd() / ".env",
        Path(__file__).resolve().parents[2] / ".env",  # backend/.env
        Path(__file__).resolve().parents[3] / ".env",  # project-root .env
    ]
    seen: set[Path] = set()
    for env_file in candidates:
        resolved = env_file.resolve()
        if resolved in seen or not resolved.exists():
            continue
        load_dotenv(resolved, override=False)
        seen.add(resolved)


def create_app(
    *,
    database_url: str | None = None,
    storage_dir: Path | None = None,
) -> FastAPI:
    _load_environment_files()
    setup_logging()
    app = FastAPI(title="PPT Learning Assistant API")

    db_url = database_url or get_database_url()
    resolved_storage = storage_dir or Path("./storage")
    ensure_storage(resolved_storage)

    engine = create_db_engine(db_url)
    app.state.engine = engine
    app.state.storage_dir = resolved_storage.resolve()

    # Starlette applies middleware in reverse add order — last added = outermost.
    # RequestLoggingMiddleware must be added first so CORSMiddleware wraps it
    # and injects CORS headers on all responses, including errors.
    app.add_middleware(RequestLoggingMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(account_router)
    app.include_router(auth_router)
    app.include_router(documents_router)
    app.include_router(export_notes_router)
    app.include_router(folders_router)
    app.include_router(sessions_router)
    app.include_router(chat_router)
    app.include_router(notes_router)
    app.include_router(notebooks_router)
    app.include_router(quizzes_router)
    app.include_router(review_router)
    app.include_router(analytics_router)
    app.include_router(slide_notes_router)
    app.include_router(bookmarks_router)
    app.include_router(flashcards_router)
    app.include_router(knowledge_graph_router)
    app.include_router(sync_router)
    app.include_router(usage_router)
    app.include_router(admin_router)

    init_db(engine)

    @app.get("/health")
    def health_check(request: Request):
        db_ok = True
        try:
            from sqlmodel import Session, text
            engine = request.app.state.engine
            with Session(engine) as session:
                session.exec(text("SELECT 1"))
        except Exception:
            db_ok = False
        return {"status": "ok" if db_ok else "degraded", "db": "connected" if db_ok else "disconnected"}

    app.mount("/storage", StaticFiles(directory=app.state.storage_dir), name="storage")

    # Cache static files (slide images) for 7 days
    @app.middleware("http")
    async def add_cache_headers(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/storage/"):
            response.headers["Cache-Control"] = "public, max-age=604800, immutable"
        return response

    return app


app = create_app()
