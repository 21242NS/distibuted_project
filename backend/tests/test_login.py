from sqlalchemy import select

from app.models import User

VALID = {"username": "testuser", "password": "Password123"}


def test_signup_then_login(client):
    signup = client.post("/api/signup", json=VALID)
    assert signup.status_code == 200
    assert signup.json()["message"] == "Signup successful"

    login = client.post("/api/login", json=VALID)
    assert login.status_code == 200
    assert login.json() == {"message": "Login successful", "username": "testuser"}


def test_password_is_stored_hashed(client, session_factory):
    client.post("/api/signup", json=VALID)

    with session_factory() as db:
        user = db.scalars(select(User).where(User.username == "testuser")).one()
    assert user.password_hash != VALID["password"]
    assert user.password_hash.startswith("$argon2")


def test_login_wrong_password(client):
    client.post("/api/signup", json=VALID)

    response = client.post("/api/login", json={"username": "testuser", "password": "Wrong12345"})
    assert response.status_code == 401
    assert response.json() == {"error": "Invalid username or password"}


def test_login_unknown_user(client):
    response = client.post("/api/login", json={"username": "nobody", "password": "Password123"})
    assert response.status_code == 401
    assert response.json() == {"error": "Invalid username or password"}


def test_signup_duplicate_username(client):
    client.post("/api/signup", json=VALID)

    response = client.post("/api/signup", json=VALID)
    assert response.status_code == 409
    assert response.json() == {"error": "Username already exists"}


def test_signup_invalid_username(client):
    response = client.post("/api/signup", json={"username": "a!", "password": "Password123"})
    assert response.status_code == 400
    assert response.json() == {"error": "Invalid username format"}


def test_signup_weak_password(client):
    response = client.post("/api/signup", json={"username": "testuser", "password": "short"})
    assert response.status_code == 400
    assert response.json() == {"error": "Invalid password format"}


def test_credentials_in_url_are_rejected(client):
    response = client.post("/api/login", params=VALID)
    assert response.status_code == 422
