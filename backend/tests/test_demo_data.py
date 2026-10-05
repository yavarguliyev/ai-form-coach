from collections.abc import Callable

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.aggregates import is_good_rep
from app.db import SessionLocal
from app.demo_data import SESSIONS_PER_EXERCISE, create_demo_data, remove_demo_sessions
from app.error_codes import EXERCISE_ERROR_CODES, EXERCISE_MISS_CODES, FORM_ERROR_CODES
from app.models import Rep, Session, User
from app.seed import DEMO_USER_NAME


def demo_user_id(client: TestClient) -> str:
    users = client.get("/api/users").json()
    found = [u for u in users if u["name"] == DEMO_USER_NAME]
    if found:
        return found[0]["id"]
    return client.post("/api/users", json={"name": DEMO_USER_NAME}).json()["id"]


def run_demo() -> int:
    with SessionLocal.begin() as db:
        return create_demo_data(db)


def test_creates_sets_for_every_exercise(client: TestClient) -> None:
    uid = demo_user_id(client)
    assert run_demo() == 3 * SESSIONS_PER_EXERCISE
    stats = {
        e["exercise_slug"]: e for e in client.get(f"/api/users/{uid}/stats").json()["exercises"]
    }
    for slug in ("squat", "bicep_curl", "shoulder_press"):
        assert stats[slug]["total_sessions"] == SESSIONS_PER_EXERCISE
        assert len(stats[slug]["recent_sessions"]) == SESSIONS_PER_EXERCISE


def test_reps_follow_the_app_rules(client: TestClient) -> None:
    demo_user_id(client)
    run_demo()
    with SessionLocal() as db:
        for session in db.scalars(select(Session)):
            slug = session.exercise.slug
            good = missed = 0
            for rep in session.reps:
                assert rep.metrics["demo"] is True
                if not rep.counted:
                    missed += 1
                    assert rep.score == 0 and rep.miss_reason in ("partial", "too_short")
                    assert set(rep.errors) <= EXERCISE_MISS_CODES[slug]
                    continue
                assert set(rep.errors) <= EXERCISE_ERROR_CODES[slug]
                form = bool(FORM_ERROR_CODES.intersection(rep.errors))
                fast = any(e.endswith("TOO_FAST") for e in rep.errors)
                assert rep.score == 100 - 30 * form - 15 * fast
                assert 0 <= rep.min_angle <= rep.max_angle <= 180
                good += is_good_rep(rep.score, rep.errors)
            assert session.total_reps == len(session.reps) - missed
            assert session.missed_reps == missed
            assert session.attempts == len(session.reps)
            assert session.good_reps == good
            assert session.ended_at is not None and session.ended_at > session.started_at


def test_scores_improve_over_time(client: TestClient) -> None:
    uid = demo_user_id(client)
    run_demo()
    for e in client.get(f"/api/users/{uid}/stats").json()["exercises"]:
        scores = [p["avg_score"] for p in e["recent_sessions"]]
        first, last = sum(scores[:3]) / 3, sum(scores[-3:]) / 3
        assert last > first, (e["exercise_slug"], scores)


def test_rerun_replaces_demo_sets_and_keeps_real_ones(
    client: TestClient, make_session: Callable[..., str]
) -> None:
    demo_user_id(client)
    real = make_session("squat", [(100, [])])  # a real workout by another user
    run_demo()
    run_demo()
    with SessionLocal() as db:
        demo_count = db.scalar(
            select(func.count()).select_from(Session).join(User).where(User.name == DEMO_USER_NAME)
        )
        assert demo_count == 3 * SESSIONS_PER_EXERCISE  # not doubled
        assert db.get(Session, real) is not None
    assert client.get(f"/api/sessions/{real}").status_code == 200


def test_remove_deletes_only_demo_sets(
    client: TestClient, make_session: Callable[..., str]
) -> None:
    demo_user_id(client)
    real = make_session("bicep_curl", [(85, ["CURL_TOO_FAST"])])
    run_demo()
    with SessionLocal.begin() as db:
        assert remove_demo_sessions(db) == 3 * SESSIONS_PER_EXERCISE
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Session)) == 1
        assert db.scalar(select(func.count()).select_from(Rep)) == 1
    assert client.get(f"/api/sessions/{real}").status_code == 200
