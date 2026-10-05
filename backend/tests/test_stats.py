from collections.abc import Callable

from fastapi.testclient import TestClient

LEAN, FAST = "SQUAT_TORSO_LEAN", "SQUAT_TOO_FAST"


def get_stats(client: TestClient, user_id: str) -> dict[str, dict]:
    response = client.get(f"/api/users/{user_id}/stats")
    assert response.status_code == 200
    return {e["exercise_slug"]: e for e in response.json()["exercises"]}


def test_new_user_gets_all_exercises_with_zeros(client: TestClient, user_id: str) -> None:
    stats = get_stats(client, user_id)
    assert list(stats) == ["squat", "bicep_curl", "shoulder_press"]
    assert stats["squat"] == {
        "exercise_slug": "squat",
        "exercise_name": "Squat",
        "total_sessions": 0,
        "total_reps": 0,
        "good_reps": 0,
        "missed_reps": 0,
        "attempts": 0,
        "avg_score": None,
        "best_session": None,
        "recent_sessions": [],
        "top_errors": [],
    }


def test_stats_per_exercise(
    client: TestClient, user_id: str, make_session: Callable[..., str]
) -> None:
    s1 = make_session("squat", [(100, []), (70, [LEAN]), (70, [LEAN])])  # avg 80
    s2 = make_session("squat", [(100, []), (85, [FAST]), (100, [])])  # avg 95 -> best
    s3 = make_session("squat", [(55, [LEAN, FAST])], finish=False)  # in progress: counts
    make_session("squat", [])  # no reps: ignored
    make_session("bicep_curl", [(100, []), (70, ["CURL_ELBOW_SWING"])])

    stats = get_stats(client, user_id)
    squat = stats["squat"]
    assert squat["total_sessions"] == 3
    assert squat["total_reps"] == 7
    assert squat["good_reps"] == 4  # 100, 100, 85 (too fast only), 100
    assert squat["avg_score"] == round((100 + 70 + 70 + 100 + 85 + 100 + 55) / 7, 2)
    assert squat["best_session"]["id"] == s2
    assert squat["best_session"]["avg_score"] == 95.0
    assert [p["id"] for p in squat["recent_sessions"]] == [s1, s2, s3]  # oldest first
    assert squat["top_errors"] == [{"code": LEAN, "count": 3}, {"code": FAST, "count": 2}]

    curl = stats["bicep_curl"]
    assert (curl["total_sessions"], curl["total_reps"], curl["good_reps"]) == (1, 2, 1)
    assert curl["top_errors"] == [{"code": "CURL_ELBOW_SWING", "count": 1}]

    assert stats["shoulder_press"]["total_sessions"] == 0


def test_best_session_tie_prefers_more_reps(
    client: TestClient, user_id: str, make_session: Callable[..., str]
) -> None:
    make_session("squat", [(100, [])])
    more = make_session("squat", [(100, []), (100, [])])
    make_session("squat", [(100, [])])
    assert get_stats(client, user_id)["squat"]["best_session"]["id"] == more


def test_recent_sessions_capped_at_ten(
    client: TestClient, user_id: str, make_session: Callable[..., str]
) -> None:
    ids = [make_session("shoulder_press", [(90, [])]) for _ in range(11)]
    press = get_stats(client, user_id)["shoulder_press"]
    assert press["total_sessions"] == 11
    assert [p["id"] for p in press["recent_sessions"]] == ids[1:]


def test_stats_only_include_this_user(
    client: TestClient, user_id: str, make_session: Callable[..., str]
) -> None:
    make_session("squat", [(100, [])])
    other = client.post("/api/users", json={"name": "Other"}).json()["id"]
    assert get_stats(client, other)["squat"]["total_sessions"] == 0


def test_stats_unknown_user_404(client: TestClient) -> None:
    response = client.get("/api/users/00000000-0000-0000-0000-000000000000/stats")
    assert response.status_code == 404


def test_stats_malformed_user_id_422(client: TestClient) -> None:
    assert client.get("/api/users/not-a-uuid/stats").status_code == 422
