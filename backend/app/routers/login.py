from fastapi import APIRouter, Response, status
from sqlalchemy import text
from argon2 import PasswordHasher 
import re 

from app.database import engine

router = APIRouter(prefix="/api")

@router.post("/login")
async def login(response: Response, username: str, password: str):
    # Validate username and password format
    if not re.match(r"^[a-zA-Z0-9_]{3,20}$", username):
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {"error": "Invalid username format"}
    
    if not re.match(r"^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$", password):
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {"error": "Invalid password format"}

    # Query the database for the user
    with engine.connect() as connection:
        result = connection.execute(text("SELECT password FROM users WHERE username = :username"), {"username": username})
        user = result.fetchone()

    if user is None:
        response.status_code = status.HTTP_401_UNAUTHORIZED
        return {"error": "Invalid username or password"}

    stored_password_hash = user[0]
    ph = PasswordHasher()

    ph.verify(stored_password_hash, password)

    # If verification is successful, return a success message
    return {"message": "Login successful"}
@router.post("/signup")
async def signup(response: Response, username: str, password: str):
    # Validate username and password format
    if not re.match(r"^[a-zA-Z0-9_]{3,20}$", username):
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {"error": "Invalid username format"}
    
    if not re.match(r"^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d@$!%*#?&]{8,}$", password):
        response.status_code = status.HTTP_400_BAD_REQUEST
        return {"error": "Invalid password format"}

    # Hash the password
    ph = PasswordHasher()
    hashed_password = ph.hash(password)

    # Insert the new user into the database
    with engine.begin() as connection:
        existing = connection.execute(text("SELECT 1 FROM users WHERE username = :username"), {"username": username}).fetchone()
        if existing is not None:
            response.status_code = status.HTTP_400_BAD_REQUEST
            return {"error": "Username already exists"}
        connection.execute(text("INSERT INTO users (username, password) VALUES (:username, :password)"), {"username": username, "password": hashed_password})

    return {"message": "Signup successful"}