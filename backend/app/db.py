from __future__ import annotations

import os
import sqlite3
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import event
from sqlalchemy.exc import OperationalError
from sqlmodel import Session, SQLModel, create_engine


def _sqlite_busy_timeout_ms() -> int:
    return int(os.getenv("SQLITE_BUSY_TIMEOUT_MS", "30000"))


def get_database_url() -> str:
    """Return the configured DATABASE_URL, falling back to local SQLite."""
    return os.getenv("DATABASE_URL", "sqlite:///./storage/app.db")


def _is_sqlite(url: str) -> bool:
    return url.startswith("sqlite")


def _connect_args_for(url: str) -> dict[str, bool | float]:
    if _is_sqlite(url):
        return {
            "check_same_thread": False,
            "timeout": _sqlite_busy_timeout_ms() / 1000,
        }
    return {}


def _engine_kwargs_for(url: str) -> dict:
    """Return extra create_engine kwargs based on the database backend."""
    if _is_sqlite(url):
        return {}
    # PostgreSQL pool settings
    return {
        "pool_size": int(os.getenv("DB_POOL_SIZE", "5")),
        "max_overflow": int(os.getenv("DB_MAX_OVERFLOW", "10")),
        "pool_pre_ping": True,
    }


def create_db_engine(database_url: str):
    engine = create_engine(
        database_url,
        connect_args=_connect_args_for(database_url),
        **_engine_kwargs_for(database_url),
    )
    if _is_sqlite(database_url):
        busy_timeout_ms = _sqlite_busy_timeout_ms()

        @event.listens_for(engine, "connect")
        def _set_sqlite_pragmas(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute(f"PRAGMA busy_timeout = {busy_timeout_ms}")
            try:
                cursor.execute("PRAGMA journal_mode = WAL")
                cursor.execute("PRAGMA synchronous = NORMAL")
            except sqlite3.OperationalError:
                # If another connection is briefly holding a write lock, keep the
                # connection usable with busy_timeout rather than failing startup.
                pass
            cursor.execute("PRAGMA foreign_keys = ON")
            cursor.close()

    return engine


_SQLITE_COLUMN_BACKFILLS: dict[str, dict[str, str]] = {
    "document": {
        "folder_id": "TEXT",
        "sort_order": "INTEGER NOT NULL DEFAULT 0",
        "user_id": "TEXT",
    },
    "folder": {
        "user_id": "TEXT",
    },
    "learningsession": {
        "current_slide_id": "TEXT",
        "follow_current_page": "BOOLEAN NOT NULL DEFAULT 1",
        "learning_state_summary": "TEXT NOT NULL DEFAULT ''",
        "user_id": "TEXT",
    },
    "message": {
        "slide_id": "TEXT",
        "mode": "TEXT NOT NULL DEFAULT 'slide'",
        "context": "JSON NOT NULL DEFAULT '{}'",
    },
    "quizattempt": {
        "detail": "JSON NOT NULL DEFAULT '[]'",
    },
    "reviewitem": {
        "repetitions": "INTEGER NOT NULL DEFAULT 0",
        "interval_days": "REAL NOT NULL DEFAULT 1.0",
        "easiness": "REAL NOT NULL DEFAULT 2.5",
    },
    "flashcard": {
        "concept_id": "TEXT",
    },
    "concept": {
        "importance": "INTEGER NOT NULL DEFAULT 3",
    },
    "slideexplanation": {
        "version": "INTEGER NOT NULL DEFAULT 1",
        "meta": "JSON NOT NULL DEFAULT '{}'",
    },
}


def _sqlite_table_columns(connection, table_name: str) -> set[str]:
    rows = connection.exec_driver_sql(f"PRAGMA table_info({table_name})").fetchall()
    return {row[1] for row in rows}


def _backfill_sqlite_columns(engine) -> None:
    if engine.dialect.name != "sqlite":
        return

    with engine.begin() as connection:
        existing_tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        for table_name, columns in _SQLITE_COLUMN_BACKFILLS.items():
            if table_name not in existing_tables:
                continue
            current_columns = _sqlite_table_columns(connection, table_name)
            for column_name, column_sql in columns.items():
                if column_name in current_columns:
                    continue
                try:
                    connection.exec_driver_sql(
                        f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"
                    )
                except OperationalError as exc:
                    if "duplicate column name" not in str(exc).lower():
                        raise
                current_columns.add(column_name)


def _create_sqlite_indexes(engine) -> None:
    """Create indexes for new columns on SQLite (idempotent)."""
    if engine.dialect.name != "sqlite":
        return

    indexes = [
        "CREATE INDEX IF NOT EXISTS ix_document_user_id ON document(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_folder_user_id ON folder(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_learningsession_user_id ON learningsession(user_id)",
        "CREATE INDEX IF NOT EXISTS ix_llmusage_user_id ON llmusage(user_id)",
    ]
    with engine.begin() as connection:
        existing_tables = {
            row[0]
            for row in connection.exec_driver_sql(
                "SELECT name FROM sqlite_master WHERE type='table'"
            ).fetchall()
        }
        for stmt in indexes:
            # Extract table name from the statement to check if it exists
            # Format: CREATE INDEX IF NOT EXISTS ix_name ON table(col)
            table_name = stmt.split(" ON ")[1].split("(")[0].strip()
            if table_name in existing_tables:
                try:
                    connection.exec_driver_sql(stmt)
                except OperationalError:
                    pass


def init_db(engine) -> None:
    SQLModel.metadata.create_all(engine)
    _backfill_sqlite_columns(engine)
    _create_sqlite_indexes(engine)


def get_session(engine) -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def ensure_storage(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
