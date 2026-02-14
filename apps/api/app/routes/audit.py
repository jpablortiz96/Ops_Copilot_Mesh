from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Query

from app.services.audit_store import recent_audits

router = APIRouter(prefix="/v1/audit", tags=["audit"])


def _parse_ts(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed


def _normalize_event(item: Any) -> Dict[str, Any] | None:
    if not isinstance(item, dict):
        return None

    payload = item.get("payload")
    if not isinstance(payload, dict):
        payload = {}

    ts_raw = item.get("ts")
    ts_parsed = _parse_ts(ts_raw)
    if ts_parsed is None:
        return None

    event = str(item.get("type") or item.get("event") or "").strip() or "unknown"
    action_id = str(payload.get("actionId") or item.get("actionId") or "").strip() or None
    return {
        "ts": ts_parsed.isoformat(),
        "event": event,
        "actionId": action_id,
        "data": payload,
    }


@router.get("/recent")
def get_recent_audit(
    action_id: str | None = Query(default=None, alias="actionId", min_length=1, max_length=128),
    limit: int = Query(default=50, ge=1, le=200),
):
    try:
        source_items = recent_audits(limit=200)
    except Exception:
        # Resilient for missing/unavailable backing store.
        return {"items": [], "count": 0}

    normalized: List[Dict[str, Any]] = []
    for raw in source_items:
        item = _normalize_event(raw)
        if item is None:
            continue
        if action_id and item.get("actionId") != action_id:
            continue
        normalized.append(item)

    normalized.sort(key=lambda event: event["ts"])
    if len(normalized) > limit:
        normalized = normalized[-limit:]
    return {"items": normalized, "count": len(normalized)}
