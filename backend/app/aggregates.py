"""Server-side session aggregates. Always computed from stored reps, never from client values.

Every attempt is stored. For a set:
- total_reps        counted reps
- good_reps         counted reps with score >= 70 and no form error
- missed_reps       attempts not counted (too shallow, too fast, too slow) — the user's miss
- unseen_reps       attempts lost because the camera lost sight — shown, never penalized
- attempts          total_reps + missed_reps (unseen ones excluded)
- avg_score         SET SCORE: average over attempts, a missed attempt scores 0
- counted_avg_score average over counted reps only
"""

from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.error_codes import FORM_ERROR_CODES, GOOD_REP_MIN_SCORE, UNSEEN_REASON
from app.models import Rep, Session


def is_good_rep(score: int, errors: list[str], counted: bool = True) -> bool:
    return counted and score >= GOOD_REP_MIN_SCORE and not FORM_ERROR_CODES.intersection(errors)


def _avg(total: int, n: int) -> Decimal | None:
    if n == 0:
        return None
    return (Decimal(total) / n).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def summarize(reps: Iterable[tuple[int, list[str], bool, str | None]]) -> dict[str, object]:
    """(score, errors, counted, miss_reason) rows → aggregate fields."""
    counted_scores: list[int] = []
    good = missed = unseen = 0
    for score, errors, counted, miss_reason in reps:
        if counted:
            counted_scores.append(score)
            good += is_good_rep(score, errors)
        elif miss_reason == UNSEEN_REASON:
            unseen += 1
        else:
            missed += 1
    attempts = len(counted_scores) + missed
    return {
        "total_reps": len(counted_scores),
        "good_reps": good,
        "missed_reps": missed,
        "unseen_reps": unseen,
        "attempts": attempts,
        # Missed attempts contribute 0 to the set score.
        "avg_score": _avg(sum(counted_scores), attempts),
        "counted_avg_score": _avg(sum(counted_scores), len(counted_scores)),
    }


def recompute_session_aggregates(db: DbSession, session: Session) -> None:
    """Recompute all aggregate columns (and duration_ms once ended) from the reps table."""
    rows = db.execute(
        select(Rep.score, Rep.errors, Rep.counted, Rep.miss_reason).where(
            Rep.session_id == session.id
        )
    ).all()
    for field, value in summarize((r[0], r[1], r[2], r[3]) for r in rows).items():
        setattr(session, field, value)
    if session.ended_at is not None:
        session.duration_ms = int((session.ended_at - session.started_at).total_seconds() * 1000)
