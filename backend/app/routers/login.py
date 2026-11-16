import re
from concurrent.futures import ThreadPoolExecutor

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, Cookie, Depends, Response, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import SESSION_COOKIE_NAME
from app.database import get_db
from app.models import User
from app.sessions import CurrentUser, close_session, open_session, require_user

router = APIRouter(prefix="/api")
# argon2 parameters recommended by OWASP, run in a bounded pool to cap memory use
password_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
hashing_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="argon2")

# 3 to 20 letters, digits or underscores
USERNAME_RULE = re.compile(r"^[a-zA-Z0-9_]{3,20}$")
# at least 8 characters with one letter and one digit
PASSWORD_RULE = re.compile(r"^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$")


class Credentials(BaseModel):
    """class for validating signup and login requests"""
    username: str
    password: str


def format_error(credentials: Credentials) -> str | None:
    """return the validation error of the credentials, or None"""
    if not USERNAME_RULE.match(credentials.username):
        return "Invalid username format"
    if not PASSWORD_RULE.match(credentials.password):
        return "Invalid password format"
    return None


def hash_password(password: str) -> str:
    """hash a password with argon2 in the dedicated thread pool"""
    return hashing_pool.submit(password_hasher.hash, password).result()


def password_matches(password_hash: str | None, password: str) -> bool:
    """verify a password against its argon2 hash"""
    if not password_hash:
        return False
    try:
        return hashing_pool.submit(password_hasher.verify, password_hash, password).result()
    except (VerificationError, InvalidHashError):
        return False


@router.post("/signup")
def signup(credentials: Credentials, response: Response, db: Session = Depends(get_db)):
    """create an account and open a session"""
    error = format_error(credentials)
    if error:
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {"error": error}

    existing = db.scalars(select(User.id).where(User.username == credentials.username)).first()
    if existing is not None:
        response.status_code = status.HTTP_409_CONFLICT
        return {"error": "Username already exists"}

    user = User(username=credentials.username, password_hash=hash_password(credentials.password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # two signups with the same name at the same time
        db.rollback()
        response.status_code = status.HTTP_409_CONFLICT
        return {"error": "Username already exists"}

    open_session(db, user, response)
    return {"message": "Signup successful", "username": user.username}


@router.post("/login")
def login(credentials: Credentials, response: Response, db: Session = Depends(get_db)):
    """check the credentials and open a session"""
    user = db.scalars(select(User).where(User.username == credentials.username)).first()
    if user is None or not password_matches(user.password_hash, credentials.password):
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return {"error": "Invalid username or password"}

    open_session(db, user, response)
    return {"message": "Login successful", "username": user.username}


@router.post("/logout")
def logout(
    response: Response,
    db: Session = Depends(get_db),
    token: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
):
    """close the current session and clear the cookie"""
    close_session(db, token, response)
    return {"message": "Logged out"}


@router.get("/me")
def me(user: CurrentUser = Depends(require_user)):
    """return the current user"""
    return {"username": user.username}
