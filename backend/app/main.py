from fastapi import FastAPI

from app.routers import hello_world
from app.routers import health
from app.routers import login


from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500"],
    allow_methods=["GET"],
)

app.include_router(hello_world.router)
app.include_router(health.router)
app.include_router(login.router)


Instrumentator().instrument(app).expose(app)