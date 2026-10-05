"""Realistic past workouts for "Demo User", so the History charts have something to show.

    python -m app.demo_data            # (re)create the demo sets
    python -m app.demo_data --remove   # delete only the demo sets

Every demo rep carries metrics.demo = true. Re-running first deletes the sessions that contain
demo reps, so it is idempotent and never touches real workouts. Scores follow the same rules as
the app (100, −30 per form error, −15 for too fast) and aggregates are computed by the server's
own recompute_session_aggregates.
"""

import argparse
import random
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from app.aggregates import recompute_session_aggregates
from app.db import SessionLocal
from app.models import Exercise, Rep, Session, User
from app.seed import DEMO_USER_NAME

DEMO_FLAG = "demo"
SESSIONS_PER_EXERCISE = 8
DAYS_BACK = 21
SEED = 42  # deterministic: the same demo history every time

FORM_PENALTY = 30
FAST_PENALTY = 15


@dataclass(frozen=True)
class Profile:
    form_error: str
    too_fast: str
    too_fast_ms: int
    # (min, max) primary-angle ranges for a counted rep
    low: tuple[float, float]
    high: tuple[float, float]
    metric: str  # per-rep metric stored like the real app (max_<frameMetric>)
    metric_ok: tuple[float, float]
    metric_bad: tuple[float, float]
    partial_code: str  # stored on "not deep enough" misses
    # (min, max) primary-angle ranges for an attempt that stopped short
    shallow_low: tuple[float, float]
    shallow_high: tuple[float, float]


PROFILES: dict[str, Profile] = {
    "squat": Profile(
        "SQUAT_TORSO_LEAN",
        "SQUAT_TOO_FAST",
        1000,
        (80, 98),
        (161, 170),
        "max_torsoLean",
        (18, 40),
        (47, 62),
        "SQUAT_SHALLOW",
        (108, 132),
        (161, 170),
    ),
    "bicep_curl": Profile(
        "CURL_ELBOW_SWING",
        "CURL_TOO_FAST",
        800,
        (34, 48),
        (151, 166),
        "max_upperArmSwing",
        (6, 20),
        (27, 40),
        "CURL_PARTIAL",
        (62, 95),
        (151, 166),
    ),
    "shoulder_press": Profile(
        "PRESS_UNEVEN",
        "PRESS_TOO_FAST",
        800,
        (92, 100),
        (157, 172),
        "max_armAsymmetry",
        (3, 14),
        (22, 34),
        "PRESS_PARTIAL",
        (92, 100),
        (128, 150),
    ),
}


def remove_demo_sessions(db: DbSession) -> int:
    demo_session_ids = select(Rep.session_id).where(Rep.metrics[DEMO_FLAG].as_boolean().is_(True))
    result = db.execute(delete(Session).where(Session.id.in_(demo_session_ids)))
    return result.rowcount or 0


def _add_missed_attempt(
    db: DbSession, rng: random.Random, session: Session, profile: Profile, index: int, t: datetime
) -> datetime:
    """An attempt that didn't count: mostly not deep enough, sometimes too fast."""
    shallow = rng.random() < 0.75
    duration = rng.randint(1200, 2000) if shallow else rng.randint(380, 560)
    low, high = (
        (profile.shallow_low, profile.shallow_high) if shallow else (profile.low, profile.high)
    )
    db.add(
        Rep(
            session_id=session.id,
            rep_index=index,
            started_at=t,
            duration_ms=duration,
            min_angle=round(rng.uniform(*low), 2),
            max_angle=round(rng.uniform(*high), 2),
            score=0,
            errors=[profile.partial_code if shallow else profile.too_fast],
            metrics={DEMO_FLAG: True},
            counted=False,
            miss_reason="partial" if shallow else "too_short",
        )
    )
    return t + timedelta(milliseconds=duration + rng.randint(600, 1500))


def _make_session(
    db: DbSession,
    rng: random.Random,
    user: User,
    exercise: Exercise,
    started: datetime,
    progress: float,
) -> Session:
    """progress 0 → 1: older sets have more mistakes, newer ones fewer."""
    profile = PROFILES[exercise.slug]
    session = Session(user_id=user.id, exercise_id=exercise.id, started_at=started)
    db.add(session)
    db.flush()

    p_form = 0.45 - 0.35 * progress  # 45 % of reps → 10 %
    p_fast = 0.25 - 0.18 * progress
    p_miss = 0.35 - 0.30 * progress  # attempts that don't count: 35 % → 5 %
    t = started + timedelta(seconds=4)
    for index in range(1, rng.randint(9, 13) + 1):
        if rng.random() < p_miss:
            t = _add_missed_attempt(db, rng, session, profile, index, t)
            continue
        form = rng.random() < p_form
        fast = rng.random() < p_fast
        errors = ([profile.form_error] if form else []) + ([profile.too_fast] if fast else [])
        duration = (
            rng.randint(profile.too_fast_ms - 250, profile.too_fast_ms - 60)
            if fast
            else rng.randint(1300, 2400)
        )
        metric = rng.uniform(*(profile.metric_bad if form else profile.metric_ok))
        db.add(
            Rep(
                session_id=session.id,
                rep_index=index,
                started_at=t,
                duration_ms=duration,
                min_angle=round(rng.uniform(*profile.low), 2),
                max_angle=round(rng.uniform(*profile.high), 2),
                score=max(0, 100 - FORM_PENALTY * form - FAST_PENALTY * fast),
                errors=errors,
                metrics={profile.metric: round(metric, 2), DEMO_FLAG: True},
            )
        )
        t += timedelta(milliseconds=duration + rng.randint(600, 1500))

    session.ended_at = t + timedelta(seconds=3)
    db.flush()
    recompute_session_aggregates(db, session)
    return session


def create_demo_data(db: DbSession, now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    rng = random.Random(SEED)
    user = db.scalar(select(User).where(User.name == DEMO_USER_NAME))
    if user is None:
        raise SystemExit(f"'{DEMO_USER_NAME}' not found — start the app once so the seed runs.")
    exercises = {e.slug: e for e in db.scalars(select(Exercise))}

    remove_demo_sessions(db)
    created = 0
    for offset, slug in enumerate(PROFILES):
        for i in range(SESSIONS_PER_EXERCISE):
            progress = i / (SESSIONS_PER_EXERCISE - 1)
            days_ago = DAYS_BACK - i * (DAYS_BACK - 1) / (SESSIONS_PER_EXERCISE - 1)
            started = (now - timedelta(days=days_ago)).replace(
                hour=7 + offset * 4, minute=rng.randint(0, 50), second=0, microsecond=0
            )
            _make_session(db, rng, user, exercises[slug], started, progress)
            created += 1
    return created


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--remove", action="store_true", help="only delete the demo sets")
    args = parser.parse_args()
    with SessionLocal.begin() as db:
        if args.remove:
            print(f"demo-data: removed {remove_demo_sessions(db)} demo sets")
        else:
            n = create_demo_data(db)
            print(f"demo-data: created {n} demo sets for {DEMO_USER_NAME} (old demo sets replaced)")


if __name__ == "__main__":
    main()
