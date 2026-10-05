from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import DbSession
from app.models import User
from app.schemas import UserCreate, UserOut

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("")
def list_users(db: DbSession) -> list[UserOut]:
    users = db.scalars(select(User).order_by(User.created_at, User.name))
    return [UserOut.model_validate(u) for u in users]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "A user with this name already exists"}},
)
def create_user(body: UserCreate, db: DbSession) -> UserOut:
    user = User(name=body.name)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # Rely on the UNIQUE constraint rather than a pre-check, so concurrent creates are safe.
        db.rollback()
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"User '{body.name}' already exists"
        ) from None
    db.refresh(user)
    return UserOut.model_validate(user)
