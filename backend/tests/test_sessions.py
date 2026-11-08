from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import UserSession

CREDENTIALS = {"username": "alice", "password": "Password123"}


def login(client):
    client.post("/api/signup", json=CREDENTIALS)
    client.post("/api/logout")
    return client.post("/api/login", json=CREDENTIALS)


def test_me_requires_a_session(client):
    response = client.get("/api/me")
    assert response.status_code == 401


def test_login_sets_an_httponly_session_cookie(client):
    response = login(client)
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert cookie.startswith("session=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/api" in cookie


def test_me_returns_the_logged_in_user(client):
    login(client)
    response = client.get("/api/me")
    assert response.status_code == 200
    assert response.json() == {"username": "alice"}


def test_only_the_token_hash_is_stored(client, session_factory):
    token = login(client).cookies["session"]
    with session_factory() as db:
        stored = db.scalars(select(UserSession)).one()
    assert stored.token_hash != token
    assert len(stored.token_hash) == 64


def test_each_login_creates_a_new_token(client):
    first = login(client).cookies["session"]
    second = client.post("/api/login", json=CREDENTIALS).cookies["session"]
    assert first != second


def test_logout_ends_the_session(client, session_factory):
    login(client)
    response = client.post("/api/logout")
    assert response.status_code == 200
    assert client.get("/api/me").status_code == 401
    with session_factory() as db:
        assert db.scalars(select(UserSession)).first() is None


def test_unknown_token_is_rejected(client):
    client.cookies.set("session", "forged-token", path="/api")
    assert client.get("/api/me").status_code == 401


def test_expired_session_is_rejected_and_removed(client, session_factory):
    login(client)
    with session_factory() as db:
        stored = db.scalars(select(UserSession)).one()
        stored.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.commit()

    assert client.get("/api/me").status_code == 401
    with session_factory() as db:
        assert db.scalars(select(UserSession)).first() is None


def test_failed_login_does_not_create_a_session(client, session_factory):
    client.post("/api/signup", json=CREDENTIALS)
    client.post("/api/logout")
    response = client.post("/api/login", json={"username": "alice", "password": "Wrong12345"})
    assert response.status_code == 401
    assert "set-cookie" not in response.headers
    with session_factory() as db:
        assert db.scalars(select(UserSession)).first() is None


def test_signup_logs_the_new_user_in(client):
    response = client.post("/api/signup", json={"username": "newbie", "password": "Password123"})
    assert response.status_code == 200
    assert response.json()["username"] == "newbie"
    assert "HttpOnly" in response.headers["set-cookie"]
    assert client.get("/api/me").json() == {"username": "newbie"}


def test_failed_signup_does_not_log_in(client):
    response = client.post("/api/signup", json={"username": "a!", "password": "Password123"})
    assert response.status_code == 400
    assert "set-cookie" not in response.headers
    assert client.get("/api/me").status_code == 401
