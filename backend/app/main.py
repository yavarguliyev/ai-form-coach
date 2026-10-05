from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import exercises, health, sessions, users

app = FastAPI(
    title="FormCoach API",
    description="Stores workout sessions and reps computed by the in-browser pose engine.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(users.router)
app.include_router(exercises.router)
app.include_router(sessions.router)
