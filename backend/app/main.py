from fastapi import FastAPI
from app.routers import hello_world
from fastapi.middleware.cors import CORSMiddleware



app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500"],
    allow_methods=["GET"],
)

app.include_router(hello_world.router)