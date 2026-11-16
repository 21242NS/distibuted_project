import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, Index, Integer, LargeBinary, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class User(Base):
    """user account, reference table replicated on every Citus node"""

    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("username", name="uq_users_username"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str | None] = mapped_column(String(20), nullable=True)
    email: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)


class Photo(Base):
    """uploaded photo, distributed by user_id"""
    __tablename__ = "photos"
    __table_args__ = (Index("ix_photos_user_sha256", "user_id", "sha256"),)
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(BigInteger)
    sha256: Mapped[str] = mapped_column(String(64))  # used to detect duplicates
    content: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)  # deferred: not loaded when listing photos
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class UserSession(Base):
    """login session, only the SHA-256 of the token is stored"""

    __tablename__ = "sessions"
    __table_args__ = (Index("ix_sessions_user_id", "user_id"),)

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Album(Base):
    """named collection of photos, colocated with photos by user_id"""
    __tablename__ = "albums"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_albums_user_name"),)

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(60))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AlbumPhoto(Base):
    """link between an album and a photo, colocated with photos by user_id"""
    __tablename__ = "album_photos"
    __table_args__ = (Index("ix_album_photos_user_photo", "user_id", "photo_id"),)

    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    album_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    photo_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
