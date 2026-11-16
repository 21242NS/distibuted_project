import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app import cache
from app.config import SESSION_CACHE_SECONDS, SESSION_COOKIE_NAME, SESSION_COOKIE_SECURE, SESSION_TTL_HOURS
from app.database import get_db
from app.models import User, UserSession


@dataclass(frozen=True)
class CurrentUser:
    """authenticated user attached to a request"""
    id: int
    username: str | None


def _hash_token(token: str) -> str:
    """hash a session token, the raw token is never stored"""
    return hashlib.sha256(token.encode()).hexdigest()


def _cache_key(token_hash: str) -> str:
    """Redis key of a session"""
    return f"session:{token_hash}"


def _as_utc(moment: datetime) -> datetime:
    """treat naive datetimes as UTC"""
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def open_session(db: Session, user: User, response: Response) -> None:
    """create a session in the database and set the cookie"""
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=SESSION_TTL_HOURS)
    db.add(UserSession(token_hash=_hash_token(token), user_id=user.id, expires_at=expires_at))
    db.commit()
    response.set_cookie(
        SESSION_COOKIE_NAME,
        token,
        max_age=SESSION_TTL_HOURS * 3600,
        httponly=True,
        secure=SESSION_COOKIE_SECURE,
        samesite="lax",
        path="/api",
    )


def close_session(db: Session, token: str | None, response: Response) -> None:
    """delete the session from the database and the cache"""
    if token:
        token_hash = _hash_token(token)
        db.execute(delete(UserSession).where(UserSession.token_hash == token_hash))
        db.commit()
        cache.delete(_cache_key(token_hash))
    response.delete_cookie(SESSION_COOKIE_NAME, path="/api", httponly=True, samesite="lax", secure=SESSION_COOKIE_SECURE)


def user_from_token(db: Session, token: str | None) -> CurrentUser | None:
    """resolve a session token to a user, Redis first then the database"""
    if not token:
        return None
    token_hash = _hash_token(token)
    cached = cache.get_json("session", _cache_key(token_hash))
    if cached is not None:
        return CurrentUser(id=cached["id"], username=cached["username"])

    session = db.get(UserSession, token_hash)
    if session is None:
        return None
    remaining = _as_utc(session.expires_at) - datetime.now(timezone.utc)
    if remaining.total_seconds() <= 0:
        db.delete(session)
        db.commit()
        return None
    user = db.get(User, session.user_id)
    if user is None:
        return None

    # never cache a session longer than it is valid
    ttl = int(min(SESSION_CACHE_SECONDS, remaining.total_seconds()))
    cache.set_json(_cache_key(token_hash), {"id": user.id, "username": user.username}, ttl)
    return CurrentUser(id=user.id, username=user.username)


def require_user(
    db: Session = Depends(get_db),
    token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> CurrentUser:
    """FastAPI dependency that rejects unauthenticated requests"""
    user = user_from_token(db, token)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user
