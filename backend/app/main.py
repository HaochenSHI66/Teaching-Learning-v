from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.chat import router as chat_router
from app.api.documents import router as documents_router
from app.api.notes import router as notes_router
from app.api.quizzes import router as quizzes_router
from app.api.sessions import router as sessions_router
from app.db import create_db_engine, ensure_storage, init_db


def create_app(
    *,
    database_url: str | None = None,
    storage_dir: Path | None = None,
) -> FastAPI:
    app = FastAPI(title="PPT Learning Assistant API")

    db_url = database_url or "sqlite:///./storage/app.db"
    resolved_storage = storage_dir or Path("./storage")
    ensure_storage(resolved_storage)

    engine = create_db_engine(db_url)
    app.state.engine = engine
    app.state.storage_dir = resolved_storage.resolve()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(documents_router)
    app.include_router(sessions_router)
    app.include_router(chat_router)
    app.include_router(notes_router)
    app.include_router(quizzes_router)

    init_db(engine)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.mount("/storage", StaticFiles(directory=app.state.storage_dir), name="storage")

    return app


app = create_app()
