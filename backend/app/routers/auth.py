"""Email/password accounts + user settings (traits, memory, vaulted API key)."""
from __future__ import annotations

import time
from typing import Any

import jwt
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app import workspace_db as ws
from app.config import get_settings

router = APIRouter(prefix="/auth", tags=["auth"])
JWT_ALG = "HS256"
JWT_TTL = 7 * 24 * 3600


class RegisterIn(BaseModel):
    email: str
    password: str = Field(..., min_length=8)
    display_name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class SettingsIn(BaseModel):
    traits: list[str] | None = None
    memory: list[str] | None = None
    instructions: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False


def _token(user_id: str, email: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": user_id, "email": email, "iat": now, "exp": now + JWT_TTL},
        get_settings().kms_seed,
        algorithm=JWT_ALG,
    )


def current_user(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing_token")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, get_settings().kms_seed, algorithms=[JWT_ALG])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="invalid_token") from exc
    user = ws.get_profile(str(payload.get("sub") or ""))
    if not user:
        raise HTTPException(status_code=401, detail="unknown_user")
    return user


def _guard() -> None:
    try:
        ws._require()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"workspace_db: {exc}") from exc


@router.post("/register")
def register(body: RegisterIn) -> dict[str, Any]:
    _guard()
    try:
        user = ws.create_profile(body.email, body.password, body.display_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"user": user, "token": _token(user["id"], user["email"])}


@router.post("/login")
def login(body: LoginIn) -> dict[str, Any]:
    _guard()
    row = ws.get_profile_by_email(body.email)
    if not row or not ws.verify_password(body.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="bad_credentials")
    user = {"id": row["id"], "email": row["email"], "display_name": row["display_name"]}
    return {"user": user, "token": _token(user["id"], user["email"])}


@router.get("/me")
def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    settings = ws.get_user_settings(user["id"])
    return {"user": user, "settings": settings}


@router.put("/me/settings")
def put_settings(body: SettingsIn, user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
    patch = body.model_dump(exclude_none=True)
    return ws.put_user_settings(user["id"], patch)
