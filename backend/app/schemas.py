"""Pydantic request/response schemas — API contract from CLAUDE.md §7."""

import uuid
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    model_validator,
)

from app.error_codes import RepErrorCode

ExerciseSlug = Literal["squat", "bicep_curl", "shoulder_press"]

# Upper bound for a stored rep's duration. The engine discards reps > 8 s (MAX_REP_MS);
# this only rejects obviously broken data.
MAX_REP_DURATION_MS = 60_000


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


# --- sessions & reps -------------------------------------------------------


class SessionCreate(BaseModel):
    user_id: uuid.UUID
    exercise_slug: ExerciseSlug


class RepCreate(BaseModel):
    rep_index: int = Field(ge=1)
    started_at: AwareDatetime
    duration_ms: int = Field(ge=0, le=MAX_REP_DURATION_MS)
    min_angle: float = Field(ge=0, le=180)
    max_angle: float = Field(ge=0, le=180)
    score: int = Field(ge=0, le=100)
    errors: list[RepErrorCode] = Field(default_factory=list, max_length=10)
    metrics: dict[str, JsonValue] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check(self) -> Self:
        if self.min_angle > self.max_angle:
            raise ValueError("min_angle must be <= max_angle")
        if len(set(self.errors)) != len(self.errors):
            raise ValueError("errors must not contain duplicates")
        # Two decimals is what the DB stores; round now so idempotency checks compare equal.
        self.min_angle = round(self.min_angle, 2)
        self.max_angle = round(self.max_angle, 2)
        return self


class RepOut(ORMModel):
    id: uuid.UUID
    rep_index: int
    started_at: datetime
    duration_ms: int
    min_angle: float
    max_angle: float
    score: int
    errors: list[str]
    metrics: dict[str, JsonValue]


class SessionFinish(BaseModel):
    ended_at: AwareDatetime


class SessionOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    exercise_slug: ExerciseSlug
    started_at: datetime
    ended_at: datetime | None
    total_reps: int
    good_reps: int
    avg_score: float | None
    duration_ms: int | None


class SessionDetail(SessionOut):
    reps: list[RepOut]


# --- stats -----------------------------------------------------------------


class SessionPoint(BaseModel):
    """One session, as a point on the History charts."""

    id: uuid.UUID
    started_at: datetime
    total_reps: int
    good_reps: int
    avg_score: float | None


class ErrorCount(BaseModel):
    code: str
    count: int


class ExerciseStats(BaseModel):
    exercise_slug: ExerciseSlug
    exercise_name: str
    total_sessions: int
    total_reps: int
    good_reps: int
    avg_score: float | None  # mean over all reps, not over session averages
    best_session: SessionPoint | None
    recent_sessions: list[SessionPoint]  # last N, oldest first (chart order)
    top_errors: list[ErrorCount]  # most frequent first


class UserStats(BaseModel):
    user_id: uuid.UUID
    exercises: list[ExerciseStats]
