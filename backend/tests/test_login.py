from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

def test_login_successful():
    # First, sign up a new user
    signup_response = client.post("/api/signup", params={"username": "testuser", "password": "Password123"})
    assert signup_response.status_code == 200
    assert signup_response.json()["message"] == "Signup successful"

    # Now, attempt to log in with the same credentials
    login_response = client.post("/api/login", params={"username": "testuser", "password": "Password123"})
    assert login_response.status_code == 200
    assert login_response.json()["message"] == "Login successful"