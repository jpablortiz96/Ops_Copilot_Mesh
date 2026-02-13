from __future__ import annotations

import json
import logging
import os
import uuid
from collections import deque
from copy import deepcopy
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Deque, Dict, List

from azure.storage.blob import BlobServiceClient

AUDIT_CONTAINER = os.getenv("AZURE_AUDIT_CONTAINER", "audit")
_EVENTS: Deque[Dict[str, Any]] = deque(maxlen=1000)
_LOCK = Lock()
logger = logging.getLogger(__name__)


def _blob_service() -> BlobServiceClient:
    conn = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not conn:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING missing")
    return BlobServiceClient.from_connection_string(conn)


def _write_to_blob(doc: Dict[str, Any]) -> Dict[str, Any]:
    svc = _blob_service()
    container = svc.get_container_client(AUDIT_CONTAINER)
    try:
        container.get_container_properties()
    except Exception:
        container.create_container()

    ts = datetime.fromisoformat(doc["ts"])
    day = ts.strftime("%Y%m%d")
    blob_path = f"events/{day}/{doc['type']}-{doc['id']}.json"
    container.upload_blob(blob_path, json.dumps(doc, ensure_ascii=False), overwrite=True)
    return {"container": AUDIT_CONTAINER, "path": blob_path}


def write_audit(event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    ts = datetime.now(timezone.utc).isoformat()
    event_id = str(uuid.uuid4())
    doc: Dict[str, Any] = {
        "id": event_id,
        "type": event_type,
        "ts": ts,
        "payload": deepcopy(payload),
    }

    with _LOCK:
        _EVENTS.appendleft(deepcopy(doc))

    out: Dict[str, Any] = {"id": event_id, "ts": ts}
    try:
        out.update(_write_to_blob(doc))
    except Exception:
        logger.info("audit_store.blob_write_skipped event_type=%s", event_type, exc_info=True)
    return out


def recent_audits(limit: int = 50) -> List[Dict[str, Any]]:
    safe_limit = max(1, min(int(limit), 200))
    with _LOCK:
        return [deepcopy(item) for item in list(_EVENTS)[:safe_limit]]
