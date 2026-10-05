"""SQLAlchemy models — schema from CLAUDE.md §6."""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    name: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class Exercise(Base):
    __tablename__ = "exercises"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(Text, unique=True)
    name: Mapped[str] = mapped_column(Text)
    body_part: Mapped[str] = mapped_column(Text)
    camera_view: Mapped[str] = mapped_column(Text)
    instructions: Mapped[str] = mapped_column(Text)

    __table_args__ = (
        CheckConstraint("camera_view IN ('side', 'front')", name="ck_exercises_camera_view"),
    )


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    # NULL while the session is in progress
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Aggregates below are recomputed by the server from `reps` on finish
    total_reps: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    good_reps: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    avg_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    user: Mapped[User] = relationship(back_populates="sessions")
    exercise: Mapped[Exercise] = relationship()
    reps: Mapped[list["Rep"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="Rep.rep_index",
    )

    __table_args__ = (Index("ix_sessions_user_started", "user_id", "started_at"),)


class Rep(Base):
    __tablename__ = "reps"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("sessions.id", ondelete="CASCADE")
    )
    rep_index: Mapped[int] = mapped_column(Integer)  # 1, 2, 3 ...
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int] = mapped_column(Integer)
    min_angle: Mapped[Decimal] = mapped_column(Numeric(6, 2))  # primary angle min during rep
    max_angle: Mapped[Decimal] = mapped_column(Numeric(6, 2))  # primary angle max during rep
    score: Mapped[int] = mapped_column(Integer)  # 0..100
    errors: Mapped[list[str]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    metrics: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )

    session: Mapped[Session] = relationship(back_populates="reps")

    __table_args__ = (
        UniqueConstraint("session_id", "rep_index", name="uq_reps_session_rep_index"),
        CheckConstraint("rep_index >= 1", name="ck_reps_rep_index"),
        CheckConstraint("score BETWEEN 0 AND 100", name="ck_reps_score"),
        CheckConstraint("duration_ms >= 0", name="ck_reps_duration"),
        CheckConstraint(
            "min_angle BETWEEN 0 AND 180 AND max_angle BETWEEN 0 AND 180",
            name="ck_reps_angles",
        ),
    )
