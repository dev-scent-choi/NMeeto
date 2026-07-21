"""JWT 인증 유틸리티. 구현명세서 §10.1."""

from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import get_db
from .models import User

settings = get_settings()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/v1/auth/login")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(sub: str, expires_delta: int) -> str:
    exp = datetime.now(timezone.utc) + timedelta(seconds=expires_delta)
    return jwt.encode({"sub": sub, "exp": exp}, settings.jwt_secret, algorithm="HS256")


def create_access_token(user_id: str) -> str:
    return create_token(user_id, settings.jwt_expiry)


def create_refresh_token(user_id: str) -> str:
    return create_token(f"refresh:{user_id}", settings.jwt_refresh_expiry)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="인증 정보가 유효하지 않습니다.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        user_id: Optional[str] = payload.get("sub")
        if user_id is None or user_id.startswith("refresh:"):
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    result = await db.execute(select(User).where(User.id == user_id, User.deleted_at.is_(None)))
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user
