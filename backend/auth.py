import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import delete, select
from pwdlib import PasswordHash
from sqlalchemy.orm import Session

from .database import get_db
from .models import RevokedToken, User

password_hash = PasswordHash.recommended()
bearer_scheme = HTTPBearer(auto_error=False)
JWT_SECRET = os.getenv("JWT_SECRET") or secrets.token_urlsafe(48)
JWT_ALGORITHM = "HS256"
TOKEN_LIFETIME_HOURS = 24


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


def create_access_token(user_id: int) -> str:
    expires = datetime.now(timezone.utc) + timedelta(hours=TOKEN_LIFETIME_HOURS)
    return jwt.encode(
        {"sub": str(user_id), "exp": expires, "jti": secrets.token_urlsafe(24)},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )


def verify_google_id_token(credential: str) -> dict[str, str]:
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google Sign-In is not configured. Set GOOGLE_CLIENT_ID in backend/.env and restart the API.",
        )
    try:
        claims = id_token.verify_oauth2_token(credential, Request(), audience=client_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google credential is invalid or expired.") from exc
    except GoogleAuthError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google verification is temporarily unavailable.") from exc

    if claims.get("iss") not in {"accounts.google.com", "https://accounts.google.com"}:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google credential has an invalid issuer.")
    if claims.get("email_verified") is not True:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="A verified Google email address is required.")

    subject = claims.get("sub")
    email = claims.get("email")
    name = claims.get("name")
    if not isinstance(subject, str) or not subject or not isinstance(email, str):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google credential is missing required profile information.")
    try:
        normalized_email = str(TypeAdapter(EmailStr).validate_python(email)).lower()
    except ValidationError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google credential contains an invalid email address.") from exc

    display_name = name.strip() if isinstance(name, str) else ""
    if not display_name:
        display_name = normalized_email.split("@", 1)[0]
    picture = claims.get("picture")
    picture_url = picture if isinstance(picture, str) and picture.startswith("https://") else ""
    return {"sub": subject, "email": normalized_email, "name": display_name[:120], "picture_url": picture_url}


def revoke_access_token(token: str, user_id: int, db: Session) -> None:
    payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    if int(payload["sub"]) != user_id:
        raise jwt.InvalidTokenError("Token owner does not match the authenticated user.")
    jti = payload["jti"]
    expires_at = datetime.fromtimestamp(payload["exp"], timezone.utc)
    db.execute(delete(RevokedToken).where(RevokedToken.expires_at < datetime.now(timezone.utc)))
    if db.get(RevokedToken, jti) is None:
        db.add(RevokedToken(jti=jti, expires_at=expires_at))
    db.commit()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Please sign in to continue.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None:
        raise unauthorized
    try:
        payload = jwt.decode(credentials.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
        jti = payload["jti"]
    except (jwt.PyJWTError, KeyError, TypeError, ValueError):
        raise unauthorized
    if db.get(RevokedToken, jti) is not None:
        raise unauthorized
    user = db.get(User, user_id)
    if user is None:
        raise unauthorized
    return user
