"""Les modèles fonctionnent sur une base SQLite en mémoire : pas besoin de Citus pour les tests unitaires."""
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Photo, User


def make_session() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_photo_is_saved_with_generated_id():
    with make_session() as db:
        db.add(User(id=1, email="a@test", name="A"))
        db.add(Photo(user_id=1, filename="a.jpg", content_type="image/jpeg", size=3, sha256="x" * 64, content=b"abc"))
        db.commit()

        photo = db.scalars(select(Photo)).one()
        assert photo.id is not None
        assert photo.content == b"abc"
        assert photo.created_at is not None


def test_ready_without_database(monkeypatch):
    # Sans DATABASE_URL (tests, dev local), /api/ready répond quand même
    from fastapi.testclient import TestClient

    from app.main import app

    assert TestClient(app).get("/api/ready").json() == {"status": "ready"}
