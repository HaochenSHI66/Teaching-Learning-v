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


def init_db(engine) -> None:
    SQLModel.metadata.create_all(engine)


def get_session(engine) -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


def ensure_storage(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
