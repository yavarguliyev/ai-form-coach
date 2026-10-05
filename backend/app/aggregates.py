"""Server-side session aggregates. Always computed from stored reps, never from client values."""

from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.error_codes import FORM_ERROR_CODES, GOOD_REP_MIN_SCORE
from app.models import Rep, Session


def is_good_rep(score: int, errors: list[str]) -> bool:
    return score >= GOOD_REP_MIN_SCORE and not FORM_ERROR_CODES.intersection(errors)


def recompute_session_aggregates(db: DbSession, session: Session) -> None:
    """Set total_reps, good_reps, avg_score (and duration_ms once ended) from the reps table."""
    reps = db.execute(select(Rep.score, Rep.errors).where(Rep.session_id == session.id)).all()
    session.total_reps = len(reps)
    session.good_reps = sum(1 for score, errors in reps if is_good_rep(score, errors))
    session.avg_score = (
        (Decimal(sum(score for score, _ in reps)) / len(reps)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        if reps
        else None
    )
    if session.ended_at is not None:
        session.duration_ms = int((session.ended_at - session.started_at).total_seconds() * 1000)
