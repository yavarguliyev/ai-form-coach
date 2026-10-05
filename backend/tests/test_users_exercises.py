from fastapi.testclient import TestClient


def test_list_exercises_returns_seeded_three(client: TestClient) -> None:
    response = client.get("/api/exercises")
    assert response.status_code == 200
    by_slug = {e["slug"]: e for e in response.json()}
    assert set(by_slug) == {"squat", "bicep_curl", "shoulder_press"}
    assert (by_slug["squat"]["body_part"], by_slug["squat"]["camera_view"]) == ("legs", "side")
    assert (by_slug["bicep_curl"]["body_part"], by_slug["bicep_curl"]["camera_view"]) == (
        "arms",
        "side",
    )
    assert (
        by_slug["shoulder_press"]["body_part"],
        by_slug["shoulder_press"]["camera_view"],
    ) == ("shoulders", "front")
    assert all(e["instructions"] for e in by_slug.values())


def test_create_and_list_users(client: TestClient) -> None:
    response = client.post("/api/users", json={"name": "  Alice  "})
    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Alice"  # trimmed

    users = client.get("/api/users").json()
    assert [u["id"] for u in users] == [created["id"]]


def test_duplicate_user_name_returns_409(client: TestClient) -> None:
    assert client.post("/api/users", json={"name": "Bob"}).status_code == 201
    response = client.post("/api/users", json={"name": " Bob "})
    assert response.status_code == 409
    assert len(client.get("/api/users").json()) == 1


def test_invalid_user_names_return_422(client: TestClient) -> None:
    for body in ({}, {"name": ""}, {"name": "   "}, {"name": "x" * 51}, {"name": 5}):
        assert client.post("/api/users", json=body).status_code == 422, body
