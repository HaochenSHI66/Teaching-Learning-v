from __future__ import annotations

import logging
import os
import threading
from typing import Any

from sqlmodel import Session, create_engine

from app.models import LLMUsage

logger = logging.getLogger(__name__)

# Approximate token-to-character ratios for estimation
# Chinese text: ~1.5 tokens per character; English: ~0.75 tokens per word / ~4 chars per token
_CHARS_PER_TOKEN = 3  # rough average for mixed Chinese/English content

# Approximate pricing per 1M tokens in CNY (defaults; override via env)
_DEFAULT_COST_TABLE: dict[str, tuple[float, float]] = {
    # (input_cost_per_1M, output_cost_per_1M) in CNY
    "qwen3-vl-flash": (0.0, 0.0),       # free tier
    "qwen3-max": (2.0, 6.0),            # approximate
    "qwen-vl-max": (3.0, 9.0),
    "qwen-turbo": (0.3, 0.6),
}


def estimate_tokens(text: str) -> int:
    """Estimate token count from text length."""
    if not text:
        return 0
    return max(1, len(text) // _CHARS_PER_TOKEN)


def estimate_cost_cny(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate cost in CNY based on model and token counts."""
    costs = _DEFAULT_COST_TABLE.get(model)
    if costs is None:
        # Unknown model -- try a generic fallback
        input_rate = 2.0
        output_rate = 6.0
    else:
        input_rate, output_rate = costs
    return (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000


def log_usage(
    *,
    model: str,
    input_text: str,
    output_text: str,
    endpoint: str,
    user_id: str | None = None,
    database_url: str | None = None,
) -> None:
    """Log LLM usage to the llmusage table.

    Runs in a background thread to avoid blocking the request path.
    """
    input_tokens = estimate_tokens(input_text)
    output_tokens = estimate_tokens(output_text)
    cost = estimate_cost_cny(model, input_tokens, output_tokens)

    def _persist() -> None:
        try:
            db_url = database_url or os.getenv("DATABASE_URL", "sqlite:///./storage/app.db")
            # Import here to avoid circular imports at module level
            from app.db import create_db_engine
            engine = create_db_engine(db_url)
            with Session(engine) as session:
                usage = LLMUsage(
                    user_id=user_id,
                    model=model,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    estimated_cost_cny=round(cost, 6),
                    endpoint=endpoint,
                )
                session.add(usage)
                session.commit()
        except Exception as exc:
            logger.warning("Failed to log LLM usage: %s", exc)

    thread = threading.Thread(target=_persist, daemon=True)
    thread.start()
