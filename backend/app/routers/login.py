import re
from concurrent.futures import ThreadPoolExecutor

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User

router = APIRouter(prefix="/api")
password_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
hashing_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="argon2")

USERNAME_RULE = re.compile(r"^[a-zA-Z0-9_]{3,20}$")
PASSWORD_RULE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$")


class Credentials(BaseModel):
    username: str
    password: str


def format_error(credentials: Credentials) -> str | None:
    if not USERNAME_RULE.match(credentials.username):
        return "Invalid username format"
    if not PASSWORD_RULE.match(credentials.password):
        return "Invalid password format"
    return None


def hash_password(password: str) -> str:
    return hashing_pool.submit(password_hasher.hash, password).result()


def password_matches(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        return False
    try:
        return hashing_pool.submit(password_hasher.verify, password_hash, password).result()
    except (VerificationError, InvalidHashError):
        return False


@router.post("/signup")
def signup(credentials: Credentials, response: Response, db: Session = Depends(get_db)):
    error = format_error(credentials)
    if error:
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {"error": error}

    existing = db.scalars(select(User.id).where(User.username == credentials.username)).first()
    if existing is not None:
        response.status_code = status.HTTP_409_CONFLICT
        return {"error": "Username already exists"}

    db.add(User(username=credentials.username, password_hash=hash_password(credentials.password)))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        response.status_code = status.HTTP_409_CONFLICT
        return {"error": "Username already exists"}

    return {"message": "Signup successful"}


@router.post("/login")
def login(credentials: Credentials, response: Response, db: Session = Depends(get_db)):
    user = db.scalars(select(User).where(User.username == credentials.username)).first()
    if user is None or not password_matches(user.password_hash, credentials.password):
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return {"error": "Invalid username or password"}

    return {"message": "Login successful", "username": user.username}
