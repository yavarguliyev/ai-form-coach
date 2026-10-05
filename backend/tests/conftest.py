"""Test setup: every test runs against a separate `<db>_test` database, never the demo DB.

DATABASE_URL is rewritten BEFORE any app module is imported, so the app's engine, Alembic and
the seed all point at the test database.
"""

import os
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

_dev_url = make_url(os.environ["DATABASE_URL"])
TEST_DB_NAME = f"{_dev_url.database}_test"
os.environ["DATABASE_URL"] = _dev_url.set(database=TEST_DB_NAME).render_as_string(
    hide_password=False
)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402


def _recreate_test_database() -> None:
    admin = create_engine(
        _dev_url.set(database="postgres").render_as_string(hide_password=False),
        isolation_level="AUTOCOMMIT",
    )
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{TEST_DB_NAME}" WITH (FORCE)'))
        conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
    admin.dispose()


@pytest.fixture(scope="session", autouse=True)
def test_database() -> Iterator[None]:
    assert engine.url.database == TEST_DB_NAME, "refusing to run tests against a non-test DB"
    _recreate_test_database()
    command.upgrade(Config("alembic.ini"), "head")  # also proves the migrations apply cleanly
    seed()
    yield
    engine.dispose()


@pytest.fixture(autouse=True)
def clean_tables() -> Iterator[None]:
    yield
    # Exercises are seed data and stay; everything a test creates goes.
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE users, sessions, reps CASCADE"))


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def user_id(client: TestClient) -> str:
    response = client.post("/api/users", json={"name": "Test User"})
    assert response.status_code == 201
    return response.json()["id"]


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def rep_payload(
    rep_index: int = 1, score: int = 100, errors: list[str] | None = None, **overrides: Any
) -> dict[str, Any]:
    return {
        "rep_index": rep_index,
        "started_at": "2026-10-05T10:00:00.123456Z",
        "duration_ms": 1500,
        "min_angle": 92.5,
        "max_angle": 168.2,
        "score": score,
        "errors": errors or [],
        "metrics": {"max_torso_lean": 31.5},
    } | overrides


@pytest.fixture
def make_session(client: TestClient, user_id: str) -> Callable[..., str]:
    """Create a session with the given (score, errors) reps; optionally finish it."""

    def _make(
        slug: str = "squat", reps: list[tuple[int, list[str]]] = (), *, finish: bool = True
    ) -> str:
        sid = client.post("/api/sessions", json={"user_id": user_id, "exercise_slug": slug})
        assert sid.status_code == 201
        session_id: str = sid.json()["id"]
        for i, (score, errors) in enumerate(reps, start=1):
            r = client.post(f"/api/sessions/{session_id}/reps", json=rep_payload(i, score, errors))
            assert r.status_code == 201, r.text
        if finish:
            assert (
                client.post(
                    f"/api/sessions/{session_id}/finish", json={"ended_at": now_iso()}
                ).status_code
                == 200
            )
        return session_id

    return _make
