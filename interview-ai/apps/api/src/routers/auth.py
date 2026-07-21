"""인증 라우터. POST /v1/auth/signup, /login, /refresh."""

from fastapi import APIRouter, Depends, HTTPException, status
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import (
    create_access_token, create_refresh_token,
    hash_password, verify_password,
)
from ..config import get_settings
from ..db import get_db
from ..models import User

router = APIRouter(prefix="/v1/auth", tags=["auth"])
settings = get_settings()


class SignupRequest(BaseModel):
    email: EmailStr
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(body: SignupRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(User).where(User.email == body.email.lower()))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="이미 사용 중인 이메일입니다.")

    user = User(email=body.email.lower(), password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == body.email.lower(), User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()

    if user is None or not verify_password(body.password, user.password_hash or ""):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")

    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(get_db)):
    try:
        payload = jwt.decode(body.refresh_token, settings.jwt_secret, algorithms=["HS256"])
        sub: str = payload.get("sub", "")
        if not sub.startswith("refresh:"):
            raise ValueError("not a refresh token")
        user_id = sub.removeprefix("refresh:")
    except (JWTError, ValueError):
        raise HTTPException(status_code=401, detail="리프레시 토큰이 유효하지 않습니다.")

    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    if result.scalar_one_or_none() is None:
        raise HTTPException(status_code=401, detail="사용자를 찾을 수 없습니다.")

    return TokenResponse(
        access_token=create_access_token(user_id),
        refresh_token=create_refresh_token(user_id),
    )
