import uuid
from collections import Counter

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.aggregates import summarize
from app.db import DbSession
from app.models import Exercise, Rep, Session, User
from app.schemas import ErrorCount, ExerciseStats, SessionPoint, UserStats

router = APIRouter(prefix="/api/users", tags=["stats"])

RECENT_SESSIONS = 10  # points on the History line/bar charts
TOP_ERRORS = 5


def _point(s: Session) -> SessionPoint:
    return SessionPoint(
        id=s.id,
        started_at=s.started_at,
        total_reps=s.total_reps,
        good_reps=s.good_reps,
        missed_reps=s.missed_reps,
        attempts=s.attempts,
        avg_score=float(s.avg_score) if s.avg_score is not None else None,
    )


@router.get("/{user_id}/stats", responses={404: {"description": "User not found"}})
def user_stats(user_id: uuid.UUID, db: DbSession) -> UserStats:
    """Per-exercise progress for one user.

    Only sessions with at least one attempt count (in progress or finished), so sessions that
    were started and abandoned without trying a rep don't add empty points to the charts.
    Totals are computed from the reps table with the same rules as a session (aggregates.py):
    missed attempts count as 0 in the score, attempts lost by the camera are not penalized.
    """
    if db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    sessions = db.scalars(
        select(Session)
        .where(Session.user_id == user_id, Session.attempts > 0)
        .order_by(Session.started_at)
    ).all()
    reps = db.execute(
        select(Session.exercise_id, Rep.score, Rep.errors, Rep.counted, Rep.miss_reason)
        .join(Rep.session)
        .where(Session.user_id == user_id)
    ).all()

    result: list[ExerciseStats] = []
    for exercise in db.scalars(select(Exercise).order_by(Exercise.id)):
        ex_sessions = [s for s in sessions if s.exercise_id == exercise.id]
        ex_reps = [(r[1], r[2], r[3], r[4]) for r in reps if r[0] == exercise.id]
        totals = summarize(ex_reps)
        # Mistakes from counted reps AND missed attempts (e.g. SQUAT_SHALLOW).
        error_counts = Counter(code for _, errors, _, _ in ex_reps for code in errors)

        # Best = highest average; ties go to more reps, then to the most recent.
        best = max(
            ex_sessions,
            key=lambda s: (s.avg_score or 0, s.total_reps, s.started_at),
            default=None,
        )
        result.append(
            ExerciseStats(
                exercise_slug=exercise.slug,  # type: ignore[arg-type]  # DB holds valid slugs
                exercise_name=exercise.name,
                total_sessions=len(ex_sessions),
                total_reps=totals["total_reps"],  # type: ignore[arg-type]
                good_reps=totals["good_reps"],  # type: ignore[arg-type]
                missed_reps=totals["missed_reps"],  # type: ignore[arg-type]
                attempts=totals["attempts"],  # type: ignore[arg-type]
                avg_score=float(totals["avg_score"]) if totals["avg_score"] is not None else None,  # type: ignore[arg-type]
                best_session=_point(best) if best else None,
                recent_sessions=[_point(s) for s in ex_sessions[-RECENT_SESSIONS:]],
                top_errors=[
                    ErrorCount(code=code, count=n)
                    for code, n in error_counts.most_common(TOP_ERRORS)
                ],
            )
        )
    return UserStats(user_id=user_id, exercises=result)
