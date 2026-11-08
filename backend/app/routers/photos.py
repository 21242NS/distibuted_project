import hashlib
import uuid
from collections import defaultdict
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, undefer

from app.database import get_db
from app.models import Photo, User
from app.sessions import require_user

router = APIRouter(prefix="/api/photos")

MAX_PHOTO_BYTES = 10 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}


class PhotoOut(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    size: int
    sha256: str
    created_at: datetime


class PhotoList(BaseModel):
    photos: list[PhotoOut]
    count: int


class UploadResult(BaseModel):
    photo: PhotoOut
    duplicate: bool


class DuplicateGroup(BaseModel):
    sha256: str
    size: int
    count: int
    photos: list[PhotoOut]


class DuplicateReport(BaseModel):
    groups: list[DuplicateGroup]
    duplicate_count: int
    recoverable_bytes: int


def to_out(photo: Photo) -> PhotoOut:
    return PhotoOut(
        id=photo.id,
        filename=photo.filename,
        content_type=photo.content_type,
        size=photo.size,
        sha256=photo.sha256,
        created_at=photo.created_at,
    )


def photos_of(db: Session, user: User) -> list[Photo]:
    return list(
        db.scalars(
            select(Photo).where(Photo.user_id == user.id).order_by(Photo.created_at.desc())
        ).all()
    )


def clean_filename(name: str | None) -> str:
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
    return base[:255] or "photo"


@router.get("", response_model=PhotoList)
def list_photos(user: User = Depends(require_user), db: Session = Depends(get_db)):
    photos = photos_of(db, user)
    return PhotoList(photos=[to_out(photo) for photo in photos], count=len(photos))


@router.post("", response_model=UploadResult, status_code=status.HTTP_201_CREATED)
def upload_photo(
    file: UploadFile = File(...),
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "Unsupported image type")

    content = file.file.read(MAX_PHOTO_BYTES + 1)
    if len(content) > MAX_PHOTO_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Photo too large")
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")

    digest = hashlib.sha256(content).hexdigest()
    duplicate = (
        db.scalars(
            select(Photo.id).where(Photo.user_id == user.id, Photo.sha256 == digest)
        ).first()
        is not None
    )

    photo = Photo(
        user_id=user.id,
        id=uuid.uuid4(),
        filename=clean_filename(file.filename),
        content_type=file.content_type,
        size=len(content),
        sha256=digest,
        content=content,
    )
    db.add(photo)
    db.commit()
    return UploadResult(photo=to_out(photo), duplicate=duplicate)


@router.get("/duplicates", response_model=DuplicateReport)
def list_duplicates(user: User = Depends(require_user), db: Session = Depends(get_db)):
    by_hash: dict[str, list[Photo]] = defaultdict(list)
    for photo in reversed(photos_of(db, user)):
        by_hash[photo.sha256].append(photo)

    groups = [
        DuplicateGroup(
            sha256=digest,
            size=photos[0].size,
            count=len(photos),
            photos=[to_out(photo) for photo in photos],
        )
        for digest, photos in by_hash.items()
        if len(photos) > 1
    ]
    return DuplicateReport(
        groups=groups,
        duplicate_count=sum(group.count - 1 for group in groups),
        recoverable_bytes=sum(group.size * (group.count - 1) for group in groups),
    )


@router.get("/{photo_id}/content")
def photo_content(photo_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    photo = db.scalars(
        select(Photo)
        .options(undefer(Photo.content))
        .where(Photo.user_id == user.id, Photo.id == photo_id)
    ).first()
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    return Response(
        content=photo.content,
        media_type=photo.content_type,
        headers={
            "Cache-Control": "private, max-age=86400, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.delete("/{photo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_photo(photo_id: uuid.UUID, user: User = Depends(require_user), db: Session = Depends(get_db)):
    result = db.execute(delete(Photo).where(Photo.user_id == user.id, Photo.id == photo_id))
    if result.rowcount == 0:
        db.rollback()
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
