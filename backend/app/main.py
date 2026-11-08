from fastapi import FastAPI

from app.routers import health
from app.routers import login
from app.routers import photos


from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
    allow_credentials=True,
)

app.include_router(health.router)
app.include_router(login.router)
app.include_router(photos.router)


Instrumentator().instrument(app).expose(app)