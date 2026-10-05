"""Every attempt is stored — counted reps AND attempts that didn't count."""

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import now_iso, rep_payload


def miss(index: int, reason: str = "partial", errors: list[str] | None = None, **kw: Any) -> dict:
    default = {"partial": ["SQUAT_SHALLOW"], "too_short": ["SQUAT_TOO_FAST"]}.get(reason, [])
    body = rep_payload(index, 0, errors if errors is not None else default)
    return body | {"counted": False, "miss_reason": reason} | kw


@pytest.fixture
def squat_session(client: TestClient, user_id: str) -> str:
    r = client.post("/api/sessions", json={"user_id": user_id, "exercise_slug": "squat"})
    return r.json()["id"]


def post(client: TestClient, sid: str, body: dict) -> int:
    return client.post(f"/api/sessions/{sid}/reps", json=body).status_code


def test_three_clean_and_nine_half_reps_score_25(client: TestClient, squat_session: str) -> None:
    """The user's example: 3 good reps + 9 too-shallow attempts must not show 100."""
    sid = squat_session
    for i in range(1, 4):
        assert post(client, sid, rep_payload(i, 100)) == 201
    for i in range(4, 13):
        assert post(client, sid, miss(i)) == 201
    s = client.post(f"/api/sessions/{sid}/finish", json={"ended_at": now_iso()}).json()
    assert (s["total_reps"], s["good_reps"], s["missed_reps"], s["attempts"]) == (3, 3, 9, 12)
    assert s["avg_score"] == 25.0  # set score: missed attempts count as 0
    assert s["counted_avg_score"] == 100.0  # counted reps on their own


def test_attempts_lost_by_the_camera_are_shown_but_not_penalized(
    client: TestClient, squat_session: str
) -> None:
    sid = squat_session
    post(client, sid, rep_payload(1, 100))
    post(client, sid, miss(2, "lost_tracking"))
    post(client, sid, rep_payload(3, 70, ["SQUAT_TORSO_LEAN"]))
    s = client.get(f"/api/sessions/{sid}").json()
    assert (s["total_reps"], s["missed_reps"], s["unseen_reps"], s["attempts"]) == (2, 0, 1, 2)
    assert s["avg_score"] == 85.0


def test_too_fast_and_too_slow_misses_count_against_the_score(
    client: TestClient, squat_session: str
) -> None:
    sid = squat_session
    post(client, sid, rep_payload(1, 100))
    post(client, sid, miss(2, "too_short"))
    post(client, sid, miss(3, "too_long"))
    s = client.get(f"/api/sessions/{sid}").json()
    assert (s["missed_reps"], s["attempts"]) == (2, 3)
    assert s["avg_score"] == pytest.approx(33.33)


def test_missed_attempts_are_returned_in_attempt_order(
    client: TestClient, squat_session: str
) -> None:
    sid = squat_session
    post(client, sid, rep_payload(1, 100))
    post(client, sid, miss(2))
    reps = client.get(f"/api/sessions/{sid}").json()["reps"]
    assert [(r["rep_index"], r["counted"], r["miss_reason"]) for r in reps] == [
        (1, True, None),
        (2, False, "partial"),
    ]
    assert reps[1]["errors"] == ["SQUAT_SHALLOW"]


@pytest.mark.parametrize(
    "body",
    [
        rep_payload(1, 0, counted=False),  # no reason
        rep_payload(1, 100, miss_reason="partial"),  # counted but has a reason
        miss(1, score=40),  # a miss must score 0
        miss(1, "bogus"),  # unknown reason
        rep_payload(1, 70, ["SQUAT_SHALLOW"]),  # "shallow" can't be on a counted rep
        miss(1, errors=["CURL_PARTIAL"]),  # code from another exercise
        miss(1, errors=["SQUAT_TORSO_LEAN"]),  # form code on a missed attempt
    ],
)
def test_invalid_attempts_return_422(client: TestClient, squat_session: str, body: dict) -> None:
    assert post(client, squat_session, body) == 422


def test_identical_missed_attempt_retry_is_safe(client: TestClient, squat_session: str) -> None:
    sid = squat_session
    assert post(client, sid, miss(1)) == 201
    assert post(client, sid, miss(1)) == 200
    assert post(client, sid, rep_payload(1, 100)) == 409  # different content at the same index


def test_stats_include_misses_and_their_codes(
    client: TestClient, user_id: str, make_session: Callable[..., str], squat_session: str
) -> None:
    sid = squat_session
    post(client, sid, rep_payload(1, 100))
    for i in (2, 3):
        post(client, sid, miss(i))
    client.post(f"/api/sessions/{sid}/finish", json={"ended_at": now_iso()})
    squat = next(
        e
        for e in client.get(f"/api/users/{user_id}/stats").json()["exercises"]
        if e["exercise_slug"] == "squat"
    )
    assert (squat["total_reps"], squat["missed_reps"], squat["attempts"]) == (1, 2, 3)
    assert squat["avg_score"] == pytest.approx(33.33)
    assert squat["top_errors"][0] == {"code": "SQUAT_SHALLOW", "count": 2}
    assert squat["recent_sessions"][0]["missed_reps"] == 2


def test_a_set_with_only_missed_attempts_appears_in_stats(
    client: TestClient, user_id: str, squat_session: str
) -> None:
    post(client, squat_session, miss(1))
    squat = next(
        e
        for e in client.get(f"/api/users/{user_id}/stats").json()["exercises"]
        if e["exercise_slug"] == "squat"
    )
    assert squat["total_sessions"] == 1
    assert squat["avg_score"] == 0.0
