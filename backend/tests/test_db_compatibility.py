import sqlite3
from pathlib import Path

from app.db import create_db_engine, init_db


def _columns(db_path: Path, table: str) -> set[str]:
    with sqlite3.connect(db_path) as connection:
        rows = connection.execute(f"PRAGMA table_info({table})").fetchall()
    return {row[1] for row in rows}


def test_init_db_backfills_columns_for_existing_sqlite_databases(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.db"

    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE message (
              id TEXT PRIMARY KEY,
              session_id TEXT,
              role TEXT,
              content TEXT,
              slide_id TEXT,
              mode TEXT,
              created_at TEXT
            );

            CREATE TABLE reviewitem (
              id TEXT PRIMARY KEY,
              session_id TEXT,
              slide_id TEXT,
              source_ref TEXT,
              prompt TEXT,
              due_at TEXT,
              status TEXT,
              created_at TEXT
            );
            """
        )
        connection.commit()

    engine = create_db_engine(f"sqlite:///{db_path}")
    init_db(engine)

    assert "context" in _columns(db_path, "message")
    assert {"repetitions", "interval_days", "easiness"} <= _columns(db_path, "reviewitem")
    assert {"folder_id", "sort_order"} <= _columns(db_path, "document")
    with sqlite3.connect(db_path) as connection:
        folder_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='folder'"
        ).fetchone()
    assert folder_table is not None


def test_init_db_is_idempotent_when_backfill_columns_already_exist(tmp_path: Path) -> None:
    db_path = tmp_path / "existing.db"
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            """
            CREATE TABLE slideexplanation (
              id TEXT PRIMARY KEY,
              document_id TEXT,
              slide_id TEXT,
              page_num INTEGER,
              markdown TEXT,
              version INTEGER DEFAULT 1,
              meta JSON NOT NULL DEFAULT '{}',
              generated_at TEXT
            );
            """
        )
        connection.commit()

    engine = create_db_engine(f"sqlite:///{db_path}")
    init_db(engine)
    init_db(engine)

    assert {"version", "meta"} <= _columns(db_path, "slideexplanation")


def test_create_db_engine_enables_sqlite_busy_timeout_and_wal(tmp_path: Path) -> None:
    db_path = tmp_path / "pragmas.db"

    engine = create_db_engine(f"sqlite:///{db_path}")

    with engine.connect() as connection:
        busy_timeout = connection.exec_driver_sql("PRAGMA busy_timeout").scalar_one()
        journal_mode = connection.exec_driver_sql("PRAGMA journal_mode").scalar_one()

    assert int(busy_timeout) >= 30000
    assert str(journal_mode).lower() == "wal"
