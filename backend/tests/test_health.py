from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_reports_db_ok() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": "ok"}


def test_cors_allows_frontend_origin() -> None:
    response = client.options(
        "/api/health",
        headers={"Origin": "http://localhost:5180", "Access-Control-Request-Method": "GET"},
    )
    assert response.headers["access-control-allow-origin"] == "http://localhost:5180"
