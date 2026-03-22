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


def _connect_args_for(url: str) -> dict[str, bool | float]:
    if url.startswith("sqlite"):
        return {
            "check_same_thread": False,
            "timeout": _sqlite_busy_timeout_ms() / 1000,
        }
    return {}


def create_db_engine(database_url: str):
    engine = create_engine(database_url, connect_args=_connect_args_for(database_url))
    if database_url.startswith("sqlite"):
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
    },
    "learningsession": {
        "current_slide_id": "TEXT",
        "follow_current_page": "BOOLEAN NOT NULL DEFAULT 1",
        "learning_state_summary": "TEXT NOT NULL DEFAULT ''",
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


def init_db(engine) -> None:
    SQLModel.metadata.create_all(engine)
    _backfill_sqlite_columns(engine)


def get_session(engine) -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def ensure_storage(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
