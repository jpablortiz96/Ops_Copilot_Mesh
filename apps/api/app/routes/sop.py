from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from app.services.search import SearchNotConfiguredError, sop_search

router = APIRouter(prefix="/v1/sop")


class SopQuery(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    top: int = Field(default=3, ge=1, le=20)

    @field_validator("query")
    @classmethod
    def _strip_query(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("query must not be empty")
        return normalized


@router.post("/search")
def search_sop(payload: SopQuery):
    try:
        results = sop_search(payload.query, top=payload.top, fail_on_unconfigured=True)
    except SearchNotConfiguredError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {"query": payload.query, "results": results}
