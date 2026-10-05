import uuid
from collections import Counter

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.aggregates import is_good_rep
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
        avg_score=float(s.avg_score) if s.avg_score is not None else None,
    )


@router.get("/{user_id}/stats", responses={404: {"description": "User not found"}})
def user_stats(user_id: uuid.UUID, db: DbSession) -> UserStats:
    """Per-exercise progress for one user.

    Only sessions with at least one stored rep count (in progress or finished), so sessions
    that were started and abandoned without a rep don't add empty points to the charts.
    Session aggregates are the server-computed columns; totals are computed from reps.
    """
    if db.get(User, user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")

    sessions = db.scalars(
        select(Session)
        .where(Session.user_id == user_id, Session.total_reps > 0)
        .order_by(Session.started_at)
    ).all()
    reps = db.execute(
        select(Session.exercise_id, Rep.score, Rep.errors)
        .join(Rep.session)
        .where(Session.user_id == user_id)
    ).all()

    result: list[ExerciseStats] = []
    for exercise in db.scalars(select(Exercise).order_by(Exercise.id)):
        ex_sessions = [s for s in sessions if s.exercise_id == exercise.id]
        ex_reps = [(score, errors) for ex_id, score, errors in reps if ex_id == exercise.id]
        error_counts = Counter(code for _, errors in ex_reps for code in errors)

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
                total_reps=len(ex_reps),
                good_reps=sum(1 for score, errors in ex_reps if is_good_rep(score, errors)),
                avg_score=round(sum(score for score, _ in ex_reps) / len(ex_reps), 2)
                if ex_reps
                else None,
                best_session=_point(best) if best else None,
                recent_sessions=[_point(s) for s in ex_sessions[-RECENT_SESSIONS:]],
                top_errors=[
                    ErrorCount(code=code, count=n)
                    for code, n in error_counts.most_common(TOP_ERRORS)
                ],
            )
        )
    return UserStats(user_id=user_id, exercises=result)
