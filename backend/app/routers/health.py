from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.database import engine

router = APIRouter(prefix="/api")


@router.get("/health")
async def health_check():
    # Liveness : le process répond. Ne vérifie rien d'externe (un redémarrage ne réparerait pas la base).
    return {"status": "ok"}


@router.get("/ready")
def readiness_check(response: Response):
    # Readiness : capable de servir des requêtes, donc la base (si configurée) doit répondre.
    # Sinon 503 : Kubernetes retire le pod du Service sans le redémarrer.
    if engine is not None:
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception:
            response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
            return {"status": "database unavailable"}
    return {"status": "ready"}
