from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

from app.api.analytics import router as analytics_router
from app.api.chat import router as chat_router
from app.api.documents import router as documents_router
from app.api.folders import router as folders_router
from app.api.notebooks import router as notebooks_router
from app.api.notes import router as notes_router
from app.api.quizzes import router as quizzes_router
from app.api.review import router as review_router
from app.api.sessions import router as sessions_router
from app.db import create_db_engine, ensure_storage, init_db


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
    app = FastAPI(title="PPT Learning Assistant API")

    db_url = database_url or "sqlite:///./storage/app.db"
    resolved_storage = storage_dir or Path("./storage")
    ensure_storage(resolved_storage)

    engine = create_db_engine(db_url)
    app.state.engine = engine
    app.state.storage_dir = resolved_storage.resolve()

    cors_origins_env = os.getenv("CORS_ORIGINS", "")
    allow_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()] or ["*"]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(documents_router)
    app.include_router(folders_router)
    app.include_router(sessions_router)
    app.include_router(chat_router)
    app.include_router(notes_router)
    app.include_router(notebooks_router)
    app.include_router(quizzes_router)
    app.include_router(review_router)
    app.include_router(analytics_router)

    init_db(engine)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.mount("/storage", StaticFiles(directory=app.state.storage_dir), name="storage")

    return app


app = create_app()
