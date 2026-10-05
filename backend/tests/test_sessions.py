from collections.abc import Callable
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from tests.conftest import now_iso, rep_payload

UNKNOWN_ID = "00000000-0000-0000-0000-000000000000"


def iso(delta: timedelta) -> str:
    return (datetime.now(UTC) + delta).isoformat()


# --- create ----------------------------------------------------------------


def test_create_session(client: TestClient, user_id: str) -> None:
    response = client.post("/api/sessions", json={"user_id": user_id, "exercise_slug": "squat"})
    assert response.status_code == 201
    body = response.json()
    assert body["exercise_slug"] == "squat"
    assert body["ended_at"] is None
    assert (body["total_reps"], body["good_reps"], body["avg_score"]) == (0, 0, None)


def test_create_session_unknown_user_404(client: TestClient) -> None:
    response = client.post("/api/sessions", json={"user_id": UNKNOWN_ID, "exercise_slug": "squat"})
    assert response.status_code == 404


def test_create_session_unknown_exercise_422(client: TestClient, user_id: str) -> None:
    response = client.post("/api/sessions", json={"user_id": user_id, "exercise_slug": "lunge"})
    assert response.status_code == 422


# --- reps ------------------------------------------------------------------


def test_add_rep_and_live_aggregates(client: TestClient, make_session: Callable[..., str]) -> None:
    sid = make_session("squat", finish=False)
    assert client.post(f"/api/sessions/{sid}/reps", json=rep_payload(1, 100)).status_code == 201
    assert (
        client.post(
            f"/api/sessions/{sid}/reps", json=rep_payload(2, 70, ["SQUAT_TORSO_LEAN"])
        ).status_code
        == 201
    )
    # Totals update after every rep, before finish (shown live in Adminer).
    session = client.get(f"/api/sessions/{sid}").json()
    assert (session["total_reps"], session["good_reps"], session["avg_score"]) == (2, 1, 85.0)
    assert session["ended_at"] is None


def test_rep_round_trip(client: TestClient, make_session: Callable[..., str]) -> None:
    sid = make_session("squat", finish=False)
    payload = rep_payload(1, 85, ["SQUAT_TOO_FAST"], min_angle=92.346)
    client.post(f"/api/sessions/{sid}/reps", json=payload)
    rep = client.get(f"/api/sessions/{sid}").json()["reps"][0]
    assert rep["min_angle"] == 92.35  # stored with 2 decimals
    assert rep["max_angle"] == 168.2
    assert rep["errors"] == ["SQUAT_TOO_FAST"]
    assert rep["metrics"] == {"max_torso_lean": 31.5}
    assert rep["duration_ms"] == 1500


def test_identical_rep_retry_returns_200(
    client: TestClient, make_session: Callable[..., str]
) -> None:
    sid = make_session("squat", finish=False)
    assert client.post(f"/api/sessions/{sid}/reps", json=rep_payload(1)).status_code == 201
    retry = client.post(f"/api/sessions/{sid}/reps", json=rep_payload(1))
    assert retry.status_code == 200
    assert client.get(f"/api/sessions/{sid}").json()["total_reps"] == 1


def test_different_rep_same_index_returns_409(
    client: TestClient, make_session: Callable[..., str]
) -> None:
    sid = make_session("squat", finish=False)
    client.post(f"/api/sessions/{sid}/reps", json=rep_payload(1, 100))
    assert client.post(f"/api/sessions/{sid}/reps", json=rep_payload(1, 50)).status_code == 409


@pytest.mark.parametrize(
    "overrides",
    [
        {"score": 101},
        {"score": -1},
        {"rep_index": 0},
        {"max_angle": 181},
        {"min_angle": -1},
        {"min_angle": 170, "max_angle": 100},
        {"duration_ms": -1},
        {"duration_ms": 60_001},
        {"errors": ["NOT_A_CODE"]},
        {"errors": ["SQUAT_TOO_FAST", "SQUAT_TOO_FAST"]},
        {"started_at": "2026-10-05T10:00:00"},  # no timezone
        {"metrics": "nope"},
    ],
)
def test_invalid_rep_returns_422(
    client: TestClient, make_session: Callable[..., str], overrides: dict
) -> None:
    sid = make_session("squat", finish=False)
    response = client.post(f"/api/sessions/{sid}/reps", json=rep_payload(1) | overrides)
    assert response.status_code == 422, overrides


@pytest.mark.parametrize(
    ("slug", "code"),
    [
        ("squat", "CURL_ELBOW_SWING"),
        ("bicep_curl", "PRESS_UNEVEN"),
        ("shoulder_press", "SQUAT_TOO_FAST"),
    ],
)
def test_error_code_from_other_exercise_returns_422(
    client: TestClient, make_session: Callable[..., str], slug: str, code: str
) -> None:
    sid = make_session(slug, finish=False)
    response = client.post(f"/api/sessions/{sid}/reps", json=rep_payload(1, 70, [code]))
    assert response.status_code == 422


def test_rep_on_unknown_session_404(client: TestClient) -> None:
    assert client.post(f"/api/sessions/{UNKNOWN_ID}/reps", json=rep_payload()).status_code == 404


# --- finish ----------------------------------------------------------------


def test_finish_recomputes_aggregates_from_reps(
    client: TestClient, make_session: Callable[..., str]
) -> None:
    sid = make_session(
        "squat",
        [
            (100, []),
            (70, ["SQUAT_TORSO_LEAN"]),
            (85, ["SQUAT_TOO_FAST"]),
            (55, ["SQUAT_TORSO_LEAN", "SQUAT_TOO_FAST"]),
        ],
        finish=False,
    )
    response = client.post(f"/api/sessions/{sid}/finish", json={"ended_at": now_iso()})
    assert response.status_code == 200
    s = response.json()
    assert s["total_reps"] == 4
    # good = score >= 70 and no FORM errors: the clean rep and the too-fast-only rep
    assert s["good_reps"] == 2
    assert s["avg_score"] == 77.5
    assert s["ended_at"] is not None
    assert s["duration_ms"] is not None and s["duration_ms"] >= 0


def test_finish_empty_session(client: TestClient, make_session: Callable[..., str]) -> None:
    sid = make_session("bicep_curl", finish=False)
    s = client.post(f"/api/sessions/{sid}/finish", json={"ended_at": now_iso()}).json()
    assert (s["total_reps"], s["good_reps"], s["avg_score"]) == (0, 0, None)


@pytest.mark.parametrize(
    ("scores", "expected"), [([100, 100, 99], 99.67), ([100, 99, 99], 99.33), ([100, 85], 92.5)]
)
def test_avg_score_rounds_to_two_decimals(
    client: TestClient, make_session: Callable[..., str], scores: list[int], expected: float
) -> None:
    sid = make_session("squat", [(score, []) for score in scores])
    assert client.get(f"/api/sessions/{sid}").json()["avg_score"] == expected


def test_rep_on_finished_session_returns_409(
    client: TestClient, make_session: Callable[..., str]
) -> None:
    sid = make_session("squat", [(100, [])])
    assert client.post(f"/api/sessions/{sid}/reps", json=rep_payload(2)).status_code == 409


def test_retry_of_stored_rep_after_finish_returns_200(
    client: TestClient, make_session: Callable[..., str]
) -> None:
    sid = make_session("squat", [(100, [])])
    assert client.post(f"/api/sessions/{sid}/reps", json=rep_payload(1, 100)).status_code == 200


def test_finish_is_idempotent(client: TestClient, make_session: Callable[..., str]) -> None:
    sid = make_session("squat", [(100, [])], finish=False)
    first = client.post(f"/api/sessions/{sid}/finish", json={"ended_at": now_iso()}).json()
    again = client.post(f"/api/sessions/{sid}/finish", json={"ended_at": iso(timedelta(minutes=1))})
    assert again.status_code == 200
    assert again.json() == first


@pytest.mark.parametrize(
    "ended_at",
    [
        "2020-01-01T00:00:00Z",  # before the session started
        "2099-01-01T00:00:00Z",  # far future (used to overflow duration_ms)
        "2026-10-05T10:00:00",  # no timezone
    ],
)
def test_finish_rejects_bad_ended_at(
    client: TestClient, make_session: Callable[..., str], ended_at: str
) -> None:
    sid = make_session("squat", finish=False)
    assert (
        client.post(f"/api/sessions/{sid}/finish", json={"ended_at": ended_at}).status_code == 422
    )
    assert client.get(f"/api/sessions/{sid}").json()["ended_at"] is None


def test_finish_unknown_session_404(client: TestClient) -> None:
    response = client.post(f"/api/sessions/{UNKNOWN_ID}/finish", json={"ended_at": now_iso()})
    assert response.status_code == 404


# --- list / get / delete ---------------------------------------------------


def test_list_sessions_newest_first_with_filters(
    client: TestClient, user_id: str, make_session: Callable[..., str]
) -> None:
    s1 = make_session("squat")
    s2 = make_session("bicep_curl")
    s3 = make_session("squat")
    other_user = client.post("/api/users", json={"name": "Other"}).json()["id"]
    client.post("/api/sessions", json={"user_id": other_user, "exercise_slug": "squat"})

    mine = client.get("/api/sessions", params={"user_id": user_id}).json()
    assert [s["id"] for s in mine] == [s3, s2, s1]

    squats = client.get("/api/sessions", params={"user_id": user_id, "exercise_slug": "squat"})
    assert [s["id"] for s in squats.json()] == [s3, s1]

    limited = client.get("/api/sessions", params={"user_id": user_id, "limit": 1}).json()
    assert [s["id"] for s in limited] == [s3]

    assert len(client.get("/api/sessions").json()) == 4


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 201}, {"exercise_slug": "lunge"}, {"user_id": "x"}]
)
def test_list_sessions_invalid_params_422(client: TestClient, params: dict) -> None:
    assert client.get("/api/sessions", params=params).status_code == 422


def test_get_session_includes_reps_in_order(
    client: TestClient, make_session: Callable[..., str]
) -> None:
    sid = make_session("squat", [(100, []), (85, ["SQUAT_TOO_FAST"]), (100, [])])
    body = client.get(f"/api/sessions/{sid}").json()
    assert [r["rep_index"] for r in body["reps"]] == [1, 2, 3]


def test_get_unknown_session_404(client: TestClient) -> None:
    assert client.get(f"/api/sessions/{UNKNOWN_ID}").status_code == 404


def test_delete_session_cascades_reps(client: TestClient, make_session: Callable[..., str]) -> None:
    sid = make_session("squat", [(100, []), (100, [])])
    assert client.delete(f"/api/sessions/{sid}").status_code == 204
    assert client.get(f"/api/sessions/{sid}").status_code == 404
    assert client.delete(f"/api/sessions/{sid}").status_code == 404
