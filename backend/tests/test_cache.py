import fakeredis
import pytest
import redis
from sqlalchemy import delete

from app import cache
from app.models import Photo, UserSession

ALICE = {"username": "alice", "password": "Password123"}
PNG = b"\x89PNG\r\n\x1a\nfake-image"


@pytest.fixture
def fake_redis(monkeypatch):
    server = fakeredis.FakeRedis()
    monkeypatch.setattr(cache, "client", server)
    monkeypatch.setattr(cache, "unavailable_until", 0.0)
    return server


class BrokenRedis:
    def __getattr__(self, name):
        def fail(*args, **kwargs):
            raise redis.ConnectionError("redis is down")

        return fail


@pytest.fixture
def broken_redis(monkeypatch):
    monkeypatch.setattr(cache, "client", BrokenRedis())
    monkeypatch.setattr(cache, "unavailable_until", 0.0)


def lookups(name, result):
    return cache.CACHE_LOOKUPS.labels(name, result)._value.get()


def upload(client, content=PNG, filename="photo.png"):
    return client.post("/api/photos", files={"file": (filename, content, "image/png")})


def session_keys(server):
    return server.keys("session:*")


def test_session_is_served_from_the_cache(client, fake_redis, session_factory):
    client.post("/api/signup", json=ALICE)
    assert client.get("/api/me").status_code == 200
    assert len(session_keys(fake_redis)) == 1

    hits = lookups("session", "hit")
    with session_factory() as db:
        db.execute(delete(UserSession))
        db.commit()
    assert client.get("/api/me").json() == {"username": "alice"}
    assert lookups("session", "hit") == hits + 1


def test_session_cache_entry_expires_before_the_session(client, fake_redis):
    client.post("/api/signup", json=ALICE)
    client.get("/api/me")
    key = session_keys(fake_redis)[0]
    assert 0 < fake_redis.ttl(key) <= 120


def test_logout_removes_the_cached_session(client, fake_redis):
    client.post("/api/signup", json=ALICE)
    client.get("/api/me")
    token = client.cookies["session"]
    client.post("/api/logout")
    assert session_keys(fake_redis) == []
    client.cookies.set("session", token, path="/api")
    assert client.get("/api/me").status_code == 401


def test_photo_list_is_cached_and_invalidated_on_upload(client, fake_redis):
    client.post("/api/signup", json=ALICE)
    assert client.get("/api/photos").json()["count"] == 0
    assert fake_redis.exists("photos:1")

    upload(client)
    assert not fake_redis.exists("photos:1")
    assert client.get("/api/photos").json()["count"] == 1

    hits = lookups("photo_list", "hit")
    client.get("/api/photos/duplicates")
    assert lookups("photo_list", "hit") == hits + 1


def test_delete_invalidates_the_list_and_the_content(client, fake_redis):
    client.post("/api/signup", json=ALICE)
    photo_id = upload(client).json()["photo"]["id"]
    client.get("/api/photos")
    client.get(f"/api/photos/{photo_id}/content")
    assert fake_redis.exists(f"photo:1:{photo_id}")

    assert client.delete(f"/api/photos/{photo_id}").status_code == 204
    assert not fake_redis.exists("photos:1")
    assert not fake_redis.exists(f"photo:1:{photo_id}")
    assert client.get(f"/api/photos/{photo_id}/content").status_code == 404


def test_content_is_served_from_the_cache(client, fake_redis, session_factory):
    client.post("/api/signup", json=ALICE)
    photo_id = upload(client).json()["photo"]["id"]
    first = client.get(f"/api/photos/{photo_id}/content")

    with session_factory() as db:
        db.execute(delete(Photo))
        db.commit()
    second = client.get(f"/api/photos/{photo_id}/content")
    assert second.status_code == 200
    assert second.content == first.content == PNG
    assert second.headers["content-type"] == "image/png"


def test_large_photos_are_not_cached(client, fake_redis, monkeypatch):
    from app.routers import photos as photos_router

    monkeypatch.setattr(photos_router, "PHOTO_CONTENT_CACHE_MAX_BYTES", 5)
    client.post("/api/signup", json=ALICE)
    photo_id = upload(client).json()["photo"]["id"]
    assert client.get(f"/api/photos/{photo_id}/content").status_code == 200
    assert not fake_redis.exists(f"photo:1:{photo_id}")


def test_the_site_keeps_working_when_redis_is_down(client, broken_redis):
    errors = lookups("session", "error")
    assert client.post("/api/signup", json=ALICE).status_code == 200
    assert client.get("/api/me").json() == {"username": "alice"}
    photo_id = upload(client).json()["photo"]["id"]
    assert client.get("/api/photos").json()["count"] == 1
    assert client.get(f"/api/photos/{photo_id}/content").content == PNG
    assert client.delete(f"/api/photos/{photo_id}").status_code == 204
    assert lookups("session", "error") == errors + 1
    assert client.get("/api/ready").json()["cache"] == "unavailable"
