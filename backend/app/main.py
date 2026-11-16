from fastapi import FastAPI

from app.routers import health
from app.routers import login
from app.routers import photos
from app.routers import albums


from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator


# CORS only for the local frontend served by Live Server
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500"],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
    allow_credentials=True,
)

# API routes
app.include_router(health.router)
app.include_router(login.router)
app.include_router(photos.router)
app.include_router(albums.router)


# expose Prometheus metrics on /metrics
Instrumentator().instrument(app).expose(app)