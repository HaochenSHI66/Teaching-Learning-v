from __future__ import annotations

from datetime import datetime, timedelta, timezone
from dataclasses import dataclass


@dataclass
class SM2State:
    repetitions: int
    interval_days: float
    easiness: float


def sm2_next(state: SM2State, quality: int) -> tuple[SM2State, datetime]:
    """
    Apply one SM-2 review step.

    quality: 0–5 rating (0 = complete blackout, 5 = perfect recall).
    Returns updated state and the next due datetime.

    SM-2 algorithm reference: https://www.supermemo.com/en/blog/application-of-a-computer-to-improve-the-results-taught-in-the-process-of-learning
    """
    q = max(0, min(5, quality))

    # Update easiness factor
    new_easiness = state.easiness + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    new_easiness = max(1.3, new_easiness)

    if q < 3:
        # Failed recall: reset repetitions, short interval
        new_repetitions = 0
        new_interval = 1.0
    else:
        if state.repetitions == 0:
            new_interval = 1.0
        elif state.repetitions == 1:
            new_interval = 6.0
        else:
            new_interval = state.interval_days * new_easiness

        new_repetitions = state.repetitions + 1

    due_at = datetime.now(timezone.utc) + timedelta(days=new_interval)
    return SM2State(
        repetitions=new_repetitions,
        interval_days=new_interval,
        easiness=new_easiness,
    ), due_at
