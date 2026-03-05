from __future__ import annotations

from fastapi import Request
from sqlmodel import Session


def get_db_session(request: Request):
    engine = request.app.state.engine
    with Session(engine) as session:
        yield session
