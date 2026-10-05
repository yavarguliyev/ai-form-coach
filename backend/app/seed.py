"""Seeds the 3 exercises + the demo user. Idempotent: safe to run on every backend start.

Exercises are upserted by slug, so edits to names/instructions here reach an existing DB.
The demo user is only inserted if missing.
"""

from sqlalchemy import func, select

from app.db import SessionLocal
from app.models import Exercise, User

DEMO_USER_NAME = "Demo User"

EXERCISES: list[dict[str, str]] = [
    {
        "slug": "squat",
        "name": "Squat",
        "body_part": "legs",
        "camera_view": "side",
        "instructions": (
            "Stand sideways to the camera, 2–3 m away, with your whole body in frame. "
            "Feet shoulder-width apart. Lower until your thighs are at least parallel to the "
            "floor, keep your chest up, then stand all the way back up."
        ),
    },
    {
        "slug": "bicep_curl",
        "name": "Bicep Curl",
        "body_part": "arms",
        "camera_view": "side",
        "instructions": (
            "Stand sideways to the camera with your working arm closest to it. "
            "Keep your elbow pinned to your side, curl your hand up to your shoulder, "
            "then lower until your arm is fully straight."
        ),
    },
    {
        "slug": "shoulder_press",
        "name": "Shoulder Press",
        "body_part": "shoulders",
        "camera_view": "front",
        "instructions": (
            "Face the camera with your upper body and head in frame. "
            "Start with your hands at shoulder height, press both arms straight up "
            "until your hands are above your head, then lower back to your shoulders."
        ),
    },
]


def seed() -> None:
    # Look up existing rows instead of INSERT ... ON CONFLICT: the latter consumes a SERIAL
    # value on every attempt, which would leave gaps in exercises.id after each restart.
    with SessionLocal.begin() as db:
        existing = {e.slug: e for e in db.scalars(select(Exercise))}
        for data in EXERCISES:
            exercise = existing.get(data["slug"])
            if exercise is None:
                db.add(Exercise(**data))
            else:
                for field, value in data.items():
                    setattr(exercise, field, value)

        if db.scalar(select(User).where(User.name == DEMO_USER_NAME)) is None:
            db.add(User(name=DEMO_USER_NAME))

        db.flush()
        exercises = db.scalar(select(func.count()).select_from(Exercise))
        users = db.scalar(select(func.count()).select_from(User))
    print(f"seed: ok ({exercises} exercises, {users} users)")


if __name__ == "__main__":
    seed()
