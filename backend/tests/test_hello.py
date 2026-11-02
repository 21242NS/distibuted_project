from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_hello_returns_200():
    response = client.get("/api/")
    assert response.status_code == 200
    assert response.json()["message"] == "Hello, World!"


def test_pod_name_defaults_to_local(monkeypatch):
    monkeypatch.delenv("POD_NAME", raising=False)
    assert client.get("/api/").json()["pod_name"] == "local"