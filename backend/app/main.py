from fastapi import FastAPI

app = FastAPI(title="FormCoach API")


# Minimal liveness endpoint for the container healthcheck; T-03 adds the DB check.
@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
