from __future__ import annotations

from fastapi import APIRouter

from app.models import ValidatorInfo
from app.validators import list_validators

router = APIRouter(prefix="/validators", tags=["validators"])


@router.get("", response_model=list[ValidatorInfo])
def get_validators() -> list[ValidatorInfo]:
    return [
        ValidatorInfo(id=v.id, description=v.description, payload_schema=v.payload_schema())
        for v in list_validators()
    ]
