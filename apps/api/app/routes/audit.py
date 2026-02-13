from fastapi import APIRouter, Query

from app.services.audit_store import recent_audits

router = APIRouter(prefix="/v1/audit", tags=["audit"])


@router.get("/recent")
def get_recent_audit(limit: int = Query(default=50, ge=1, le=200)):
    items = recent_audits(limit=limit)
    return {"items": items, "count": len(items)}
