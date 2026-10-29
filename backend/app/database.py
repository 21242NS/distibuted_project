from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import DATABASE_URL


class Base(DeclarativeBase):
    """Classe parente de tous les modèles (tables)."""


# Connexion au coordinator Citus. pool_pre_ping : vérifie la connexion avant de la réutiliser
# (utile après un redémarrage de la base).
engine = (
    create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={"connect_timeout": 3})
    if DATABASE_URL
    else None
)
SessionLocal = sessionmaker(bind=engine) if engine is not None else None


def get_db():
    """Dépendance FastAPI : une session par requête, toujours refermée."""
    if SessionLocal is None:
        raise RuntimeError("DATABASE_URL n'est pas configurée")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
