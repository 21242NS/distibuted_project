from fastapi import FastAPI
from app.routers import hello_world
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health
from prometheus_fastapi_instrumentator import Instrumentator



app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500"],
    allow_methods=["GET"],
)

app.include_router(hello_world.router)
app.include_router(health.router)

Instrumentator().instrument(app).expose(app)