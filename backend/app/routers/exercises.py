from fastapi import APIRouter
from sqlalchemy import select

from app.db import DbSession
from app.models import Exercise
from app.schemas import ExerciseOut

router = APIRouter(prefix="/api/exercises", tags=["exercises"])


@router.get("")
def list_exercises(db: DbSession) -> list[ExerciseOut]:
    return [
        ExerciseOut.model_validate(e) for e in db.scalars(select(Exercise).order_by(Exercise.id))
    ]
