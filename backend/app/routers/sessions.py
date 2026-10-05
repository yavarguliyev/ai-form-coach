import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.aggregates import recompute_session_aggregates
from app.db import DbSession
from app.error_codes import EXERCISE_ERROR_CODES, EXERCISE_MISS_CODES
from app.models import Exercise, Rep, Session, User
from app.schemas import (
    ExerciseSlug,
    RepCreate,
    RepOut,
    SessionCreate,
    SessionDetail,
    SessionFinish,
    SessionOut,
)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

NOT_FOUND = {404: {"description": "Session not found"}}

# Tolerated difference between the browser's clock and the server's.
MAX_CLOCK_SKEW = timedelta(minutes=5)
# Longest session we accept; also keeps duration_ms well inside the INT column.
MAX_SESSION_DURATION = timedelta(hours=24)


def _session_out(session: Session) -> SessionOut:
    return SessionOut(
        id=session.id,
        user_id=session.user_id,
        exercise_slug=session.exercise.slug,  # type: ignore[arg-type]  # DB holds valid slugs
        started_at=session.started_at,
        ended_at=session.ended_at,
        total_reps=session.total_reps,
        good_reps=session.good_reps,
        missed_reps=session.missed_reps,
        unseen_reps=session.unseen_reps,
        attempts=session.attempts,
        avg_score=float(session.avg_score) if session.avg_score is not None else None,
        counted_avg_score=(
            float(session.counted_avg_score) if session.counted_avg_score is not None else None
        ),
        duration_ms=session.duration_ms,
    )


def _get_session(db: DbSession, session_id: uuid.UUID, *, lock: bool = False) -> Session:
    stmt = select(Session).where(Session.id == session_id)
    if lock:
        # Serializes rep posts and finish for the same session.
        stmt = stmt.with_for_update()
    session = db.scalar(stmt)
    if session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    return session


def _same_rep(rep: Rep, body: RepCreate) -> bool:
    return (
        rep.started_at == body.started_at
        and rep.duration_ms == body.duration_ms
        and rep.min_angle == Decimal(str(body.min_angle))
        and rep.max_angle == Decimal(str(body.max_angle))
        and rep.score == body.score
        and rep.errors == body.errors
        and rep.metrics == body.metrics
        and rep.counted == body.counted
        and rep.miss_reason == body.miss_reason
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    responses={404: {"description": "User or exercise not found"}},
)
def create_session(body: SessionCreate, db: DbSession) -> SessionOut:
    if db.get(User, body.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    exercise = db.scalar(select(Exercise).where(Exercise.slug == body.exercise_slug))
    if exercise is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Exercise not found")

    session = Session(user_id=body.user_id, exercise=exercise, started_at=datetime.now(UTC))
    db.add(session)
    db.commit()
    db.refresh(session)
    return _session_out(session)


@router.post(
    "/{session_id}/reps",
    status_code=status.HTTP_201_CREATED,
    responses={
        200: {"description": "Identical rep already stored (safe retry)"},
        409: {"description": "Session finished, or a different rep exists at this rep_index"},
        **NOT_FOUND,
    },
)
def add_rep(session_id: uuid.UUID, body: RepCreate, response: Response, db: DbSession) -> RepOut:
    session = _get_session(db, session_id, lock=True)

    codes = EXERCISE_ERROR_CODES if body.counted else EXERCISE_MISS_CODES
    allowed = codes[session.exercise.slug]
    if invalid := [e for e in body.errors if e not in allowed]:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Error codes {invalid} are not valid for exercise '{session.exercise.slug}'",
        )

    # The frontend retries posts it didn't get an answer for. If the rep already
    # landed, an identical retry succeeds; a conflicting one is rejected.
    existing = db.scalar(
        select(Rep).where(Rep.session_id == session_id, Rep.rep_index == body.rep_index)
    )
    if existing is not None:
        if _same_rep(existing, body):
            response.status_code = status.HTTP_200_OK
            return RepOut.model_validate(existing)
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A different rep #{body.rep_index} is already stored"
        )

    if session.ended_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Session is already finished")

    rep = Rep(session_id=session_id, **body.model_dump())
    db.add(rep)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Rep #{body.rep_index} is already stored"
        ) from None
    # Keep totals live so they update in Adminer during the session.
    recompute_session_aggregates(db, session)
    db.commit()
    db.refresh(rep)
    return RepOut.model_validate(rep)


@router.post(
    "/{session_id}/finish",
    responses={
        200: {"description": "Finished (or was already finished: returned unchanged)"},
        **NOT_FOUND,
    },
)
def finish_session(session_id: uuid.UUID, body: SessionFinish, db: DbSession) -> SessionOut:
    session = _get_session(db, session_id, lock=True)
    if session.ended_at is not None:
        # Idempotent so the client can safely retry a finish whose response was lost.
        return _session_out(session)
    if body.ended_at < session.started_at:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "ended_at is before the session started"
        )
    if body.ended_at > datetime.now(UTC) + MAX_CLOCK_SKEW:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "ended_at is in the future")
    if body.ended_at - session.started_at > MAX_SESSION_DURATION:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, "Session is longer than 24 hours"
        )
    session.ended_at = body.ended_at
    recompute_session_aggregates(db, session)
    db.commit()
    return _session_out(session)


@router.get("")
def list_sessions(
    db: DbSession,
    user_id: uuid.UUID | None = None,
    exercise_slug: ExerciseSlug | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> list[SessionOut]:
    stmt = (
        select(Session)
        .options(selectinload(Session.exercise))
        .order_by(Session.started_at.desc())
        .limit(limit)
    )
    if user_id is not None:
        stmt = stmt.where(Session.user_id == user_id)
    if exercise_slug is not None:
        stmt = stmt.join(Session.exercise).where(Exercise.slug == exercise_slug)
    return [_session_out(s) for s in db.scalars(stmt)]


@router.get("/{session_id}", responses=NOT_FOUND)
def get_session(session_id: uuid.UUID, db: DbSession) -> SessionDetail:
    session = _get_session(db, session_id)
    return SessionDetail(
        **_session_out(session).model_dump(),
        reps=[RepOut.model_validate(r) for r in session.reps],
    )


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT, responses=NOT_FOUND)
def delete_session(session_id: uuid.UUID, db: DbSession) -> None:
    db.delete(_get_session(db, session_id))
    db.commit()
