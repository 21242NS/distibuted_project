import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import Photo, User
from app.routers import photos as photos_router

ALICE = {"username": "alice", "password": "Password123"}
BOB = {"username": "bob", "password": "Password123"}
PNG = b"\x89PNG\r\n\x1a\nfake-image"


def signup_and_login(client, credentials):
    client.post("/api/signup", json=credentials)
    client.post("/api/login", json=credentials)


def upload(client, content=PNG, filename="photo.png", content_type="image/png"):
    return client.post("/api/photos", files={"file": (filename, content, content_type)})


def user_id(session_factory, username):
    with session_factory() as db:
        return db.scalars(select(User.id).where(User.username == username)).one()


def add_photo(session_factory, owner_id, filename, created_at, sha256="a" * 64):
    with session_factory() as db:
        db.add(
            Photo(
                user_id=owner_id,
                id=uuid.uuid4(),
                filename=filename,
                content_type="image/jpeg",
                size=3,
                sha256=sha256,
                content=b"abc",
                created_at=created_at,
            )
        )
        db.commit()


def test_every_photo_route_requires_a_session(client):
    photo_id = uuid.uuid4()
    assert client.get("/api/photos").status_code == 401
    assert upload(client).status_code == 401
    assert client.get("/api/photos/duplicates").status_code == 401
    assert client.get(f"/api/photos/{photo_id}/content").status_code == 401
    assert client.delete(f"/api/photos/{photo_id}").status_code == 401


def test_list_is_empty_for_a_new_user(client):
    signup_and_login(client, ALICE)
    response = client.get("/api/photos")
    assert response.status_code == 200
    assert response.json() == {"photos": [], "count": 0}


def test_list_shows_only_my_photos_newest_first(client, session_factory):
    client.post("/api/signup", json=BOB)
    signup_and_login(client, ALICE)
    now = datetime.now(timezone.utc)
    add_photo(session_factory, user_id(session_factory, "alice"), "old.jpg", now - timedelta(days=1))
    add_photo(session_factory, user_id(session_factory, "alice"), "new.jpg", now)
    add_photo(session_factory, user_id(session_factory, "bob"), "bob.jpg", now)

    body = client.get("/api/photos").json()
    assert body["count"] == 2
    assert [photo["filename"] for photo in body["photos"]] == ["new.jpg", "old.jpg"]
    assert "content" not in body["photos"][0]


def test_upload_computes_metadata_on_the_server(client):
    signup_and_login(client, ALICE)
    response = upload(client, filename="../../vacances.png")
    assert response.status_code == 201
    body = response.json()
    assert body["duplicate"] is False
    assert body["photo"]["filename"] == "vacances.png"
    assert body["photo"]["size"] == len(PNG)
    assert len(body["photo"]["sha256"]) == 64


def test_upload_flags_a_duplicate(client):
    signup_and_login(client, ALICE)
    upload(client)
    second = upload(client, filename="copie.png")
    assert second.status_code == 201
    assert second.json()["duplicate"] is True


def test_upload_rejects_non_images(client):
    signup_and_login(client, ALICE)
    response = upload(client, content=b"hello", filename="a.txt", content_type="text/plain")
    assert response.status_code == 415


def test_upload_rejects_empty_files(client):
    signup_and_login(client, ALICE)
    assert upload(client, content=b"").status_code == 400


def test_upload_rejects_files_that_are_too_large(client, monkeypatch):
    monkeypatch.setattr(photos_router, "MAX_PHOTO_BYTES", 5)
    signup_and_login(client, ALICE)
    assert upload(client).status_code == 413


def test_content_returns_the_image_bytes(client):
    signup_and_login(client, ALICE)
    photo_id = upload(client).json()["photo"]["id"]
    response = client.get(f"/api/photos/{photo_id}/content")
    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_content_of_someone_else_is_not_found(client):
    signup_and_login(client, BOB)
    photo_id = upload(client).json()["photo"]["id"]
    client.post("/api/logout")
    signup_and_login(client, ALICE)
    assert client.get(f"/api/photos/{photo_id}/content").status_code == 404


def test_duplicates_groups_identical_photos(client):
    signup_and_login(client, ALICE)
    original = upload(client, filename="original.png").json()["photo"]["id"]
    upload(client, filename="copie.png")
    upload(client, filename="copie2.png")
    upload(client, content=b"other-image", filename="autre.png")

    body = client.get("/api/photos/duplicates").json()
    assert len(body["groups"]) == 1
    group = body["groups"][0]
    assert group["count"] == 3
    assert group["photos"][0]["id"] == original
    assert body["duplicate_count"] == 2
    assert body["recoverable_bytes"] == 2 * len(PNG)


def test_delete_removes_the_photo(client):
    signup_and_login(client, ALICE)
    photo_id = upload(client).json()["photo"]["id"]
    assert client.delete(f"/api/photos/{photo_id}").status_code == 204
    assert client.get("/api/photos").json()["count"] == 0
    assert client.delete(f"/api/photos/{photo_id}").status_code == 404


def test_cannot_delete_someone_elses_photo(client):
    signup_and_login(client, BOB)
    photo_id = upload(client).json()["photo"]["id"]
    client.post("/api/logout")
    signup_and_login(client, ALICE)
    assert client.delete(f"/api/photos/{photo_id}").status_code == 404
