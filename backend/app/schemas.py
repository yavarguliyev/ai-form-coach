"""Pydantic request/response schemas — API contract from CLAUDE.md §7."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

ExerciseSlug = Literal["squat", "bicep_curl", "shoulder_press"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- users -----------------------------------------------------------------

UserName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]


class UserCreate(BaseModel):
    name: UserName


class UserOut(ORMModel):
    id: uuid.UUID
    name: str
    created_at: datetime


# --- exercises -------------------------------------------------------------


class ExerciseOut(ORMModel):
    id: int
    slug: ExerciseSlug
    name: str
    body_part: Literal["legs", "arms", "shoulders"]
    camera_view: Literal["side", "front"]
    instructions: str
