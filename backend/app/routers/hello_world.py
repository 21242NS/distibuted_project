from fastapi import APIRouter


router = APIRouter(prefix="/api")

@router.get("/")
async def read_hello():
    return {"message": "Hello, World!"}