import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Album, AlbumPhoto, Photo
from app.routers.photos import PhotoList, to_out
from app.sessions import CurrentUser, require_user

router = APIRouter(prefix="/api/albums")

MAX_PHOTOS_PER_REQUEST = 500  # upper bound for a single add/remove request


class AlbumName(BaseModel):
    """class for validating album name in requests"""
    name: str

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        """collapse whitespace and enforce 1 to 60 characters"""
        value = " ".join(value.split())
        if not 1 <= len(value) <= 60:
            raise ValueError("Album name must be 1 to 60 characters")
        return value


class PhotoIds(BaseModel):
    """class for validating photo IDs in requests"""
    photo_ids: list[uuid.UUID] = Field(min_length=1, max_length=MAX_PHOTOS_PER_REQUEST)


class AlbumOut(BaseModel):
    """class for returning album data in responses"""
    id: uuid.UUID
    name: str
    created_at: datetime
    photo_count: int
    cover_photo_id: uuid.UUID | None


class AlbumList(BaseModel):
    """class for returning a list of albums in responses"""
    albums: list[AlbumOut]
    count: int


class AlbumChange(BaseModel):
    """class for returning album change data in responses"""
    album: AlbumOut
    changed: int


def album_of(db: Session, user: CurrentUser, album_id: uuid.UUID) -> Album:
    """get an album by ID for the current user"""
    album = db.scalars(select(Album).where(Album.user_id == user.id, Album.id == album_id)).first()
    if album is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Album not found")
    return album


def album_out(db: Session, album: Album) -> AlbumOut:
    """convert an Album model to an AlbumOut response"""
    links = db.execute(
        select(AlbumPhoto.photo_id)
        .where(AlbumPhoto.user_id == album.user_id, AlbumPhoto.album_id == album.id)
        .order_by(AlbumPhoto.added_at.desc())
    ).scalars().all()
    return AlbumOut(
        id=album.id,
        name=album.name,
        created_at=album.created_at,
        photo_count=len(links),
        cover_photo_id=links[0] if links else None,
    )


def commit_name(db: Session) -> None:
    """commit the current transaction, handling name conflicts"""
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An album with this name already exists")


def name_taken(db: Session, user: CurrentUser, name: str, except_id: uuid.UUID | None = None) -> bool:
    """check if an album name is already taken by the user, excluding a specific album ID"""
    query = select(Album.id).where(Album.user_id == user.id, Album.name == name)
    if except_id is not None:
        query = query.where(Album.id != except_id)
    return db.scalars(query).first() is not None


@router.get("", response_model=AlbumList)
def list_albums(user: CurrentUser = Depends(require_user), db: Session = Depends(get_db)):
    """list all albums for the current user"""
    albums = db.scalars(select(Album).where(Album.user_id == user.id).order_by(Album.created_at)).all()
    counts = dict(
        db.execute(
            select(AlbumPhoto.album_id, func.count())
            .where(AlbumPhoto.user_id == user.id)
            .group_by(AlbumPhoto.album_id)
        ).all()
    )
    covers: dict[uuid.UUID, uuid.UUID] = {} #album_id -> photo_id mapping for cover photos
    for album_id, photo_id in db.execute(
        select(AlbumPhoto.album_id, AlbumPhoto.photo_id)
        .where(AlbumPhoto.user_id == user.id)
        .order_by(AlbumPhoto.added_at.desc())
    ):
        covers.setdefault(album_id, photo_id)
    items = [
        AlbumOut(
            id=album.id,
            name=album.name,
            created_at=album.created_at,
            photo_count=counts.get(album.id, 0),
            cover_photo_id=covers.get(album.id),
        )
        for album in albums
    ]
    return AlbumList(albums=items, count=len(items))


@router.post("", response_model=AlbumOut, status_code=status.HTTP_201_CREATED)
def create_album(body: AlbumName, user: CurrentUser = Depends(require_user), db: Session = Depends(get_db)):
    """create a new album for the current user"""
    if name_taken(db, user, body.name):
        raise HTTPException(status.HTTP_409_CONFLICT, "An album with this name already exists")
    album = Album(user_id=user.id, id=uuid.uuid4(), name=body.name)
    db.add(album)
    commit_name(db)
    return album_out(db, album)


@router.patch("/{album_id}", response_model=AlbumOut)
def rename_album(
    album_id: uuid.UUID,
    body: AlbumName,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_db),
):
    """rename an existing album for the current user"""
    album = album_of(db, user, album_id)
    if name_taken(db, user, body.name, except_id=album.id):
        raise HTTPException(status.HTTP_409_CONFLICT, "An album with this name already exists")
    album.name = body.name
    commit_name(db)
    return album_out(db, album)


@router.delete("/{album_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_album(album_id: uuid.UUID, user: CurrentUser = Depends(require_user), db: Session = Depends(get_db)):
    """delete an existing album for the current user"""
    album = album_of(db, user, album_id)
    db.execute(delete(AlbumPhoto).where(AlbumPhoto.user_id == user.id, AlbumPhoto.album_id == album.id))
    db.delete(album)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{album_id}/photos", response_model=PhotoList)
def album_photos(album_id: uuid.UUID, user: CurrentUser = Depends(require_user), db: Session = Depends(get_db)):
    """list the photos of an album, newest first"""
    album = album_of(db, user, album_id)
    photos = [
        to_out(photo)
        for photo in db.scalars(
            select(Photo)
            .join(AlbumPhoto, (AlbumPhoto.user_id == Photo.user_id) & (AlbumPhoto.photo_id == Photo.id))
            .where(Photo.user_id == user.id, AlbumPhoto.user_id == user.id, AlbumPhoto.album_id == album.id)
            .order_by(Photo.created_at.desc())
        )
    ]
    return PhotoList(photos=photos, count=len(photos))


@router.post("/{album_id}/photos", response_model=AlbumChange)
def add_photos(
    album_id: uuid.UUID,
    body: PhotoIds,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_db),
):
    """add photos to an album, ignoring the ones already in it"""
    album = album_of(db, user, album_id)
    wanted = set(body.photo_ids)
    owned = set(db.scalars(select(Photo.id).where(Photo.user_id == user.id, Photo.id.in_(wanted))))  # only photos owned by the current user can be added
    if owned != wanted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Photo not found")
    present = set(
        db.scalars(
            select(AlbumPhoto.photo_id).where(
                AlbumPhoto.user_id == user.id,
                AlbumPhoto.album_id == album.id,
                AlbumPhoto.photo_id.in_(wanted),
            )
        )
    )
    new_ids = [photo_id for photo_id in dict.fromkeys(body.photo_ids) if photo_id not in present]  # dedupe the request while keeping its order
    db.add_all(AlbumPhoto(user_id=user.id, album_id=album.id, photo_id=photo_id) for photo_id in new_ids)
    db.commit()
    return AlbumChange(album=album_out(db, album), changed=len(new_ids))


@router.delete("/{album_id}/photos", response_model=AlbumChange)
def remove_photos(
    album_id: uuid.UUID,
    body: PhotoIds,
    user: CurrentUser = Depends(require_user),
    db: Session = Depends(get_db),
):
    """remove photos from an album without deleting them from the library"""
    album = album_of(db, user, album_id)
    result = db.execute(
        delete(AlbumPhoto).where(
            AlbumPhoto.user_id == user.id,
            AlbumPhoto.album_id == album.id,
            AlbumPhoto.photo_id.in_(set(body.photo_ids)),
        )
    )
    db.commit()
    return AlbumChange(album=album_out(db, album), changed=result.rowcount)
