#!/usr/bin/env python3
"""Admin stats -- quick overview of the Teaching-Learning app."""

import os
import sys
from datetime import datetime, timezone

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from sqlmodel import Session, select, func, create_engine
from app.models import User, Document, LLMUsage
from app.db import get_database_url, create_db_engine


def main():
    engine = create_db_engine(get_database_url())
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    with Session(engine) as session:
        total_users = session.exec(select(func.count()).select_from(User)).one()
        total_docs = session.exec(select(func.count()).select_from(Document)).one()
        docs_today = session.exec(
            select(func.count()).select_from(Document)
            .where(Document.created_at >= today_start)
        ).one()
        llm_calls_today = session.exec(
            select(func.count()).select_from(LLMUsage)
            .where(LLMUsage.created_at >= today_start)
        ).one()
        cost_today = session.exec(
            select(func.coalesce(func.sum(LLMUsage.estimated_cost_cny), 0))
            .where(LLMUsage.created_at >= today_start)
        ).one()

    print(f"=== Admin Stats ({now.strftime('%Y-%m-%d %H:%M UTC')}) ===")
    print(f"Total users:        {total_users}")
    print(f"Total documents:    {total_docs}")
    print(f"Documents today:    {docs_today}")
    print(f"LLM calls today:    {llm_calls_today}")
    print(f"LLM cost today:     ¥{cost_today:.2f}")


if __name__ == "__main__":
    main()
