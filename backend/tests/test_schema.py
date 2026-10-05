from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient

from app.db import Base, engine
from app.seed import seed


def test_migrations_match_models() -> None:
    """The DB built by `alembic upgrade head` must equal the SQLAlchemy models."""
    with engine.connect() as conn:
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
    assert diff == []


def test_seed_is_idempotent(client: TestClient) -> None:
    seed()
    seed()
    exercises = client.get("/api/exercises").json()
    assert [e["slug"] for e in exercises] == ["squat", "bicep_curl", "shoulder_press"]
