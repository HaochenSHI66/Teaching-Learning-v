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
