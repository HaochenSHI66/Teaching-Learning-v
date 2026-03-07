from __future__ import annotations

from collections.abc import Generator
from pathlib import Path

from sqlmodel import Session, SQLModel, create_engine


def _connect_args_for(url: str) -> dict[str, bool]:
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


def create_db_engine(database_url: str):
    return create_engine(database_url, connect_args=_connect_args_for(database_url))


_SQLITE_COLUMN_BACKFILLS: dict[str, dict[str, str]] = {
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
                connection.exec_driver_sql(
                    f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"
                )
                current_columns.add(column_name)


def init_db(engine) -> None:
    SQLModel.metadata.create_all(engine)
    _backfill_sqlite_columns(engine)


def get_session(engine) -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def ensure_storage(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
