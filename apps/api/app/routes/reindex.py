import os, uuid
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from azure.storage.blob import BlobServiceClient
import requests

router = APIRouter(prefix="/v1/sop", tags=["sop"])

def _blob_client():
    conn = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not conn:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING missing")
    return BlobServiceClient.from_connection_string(conn)

def _search():
    endpoint = os.getenv("AZURE_SEARCH_ENDPOINT")
    key = os.getenv("AZURE_SEARCH_KEY")
    index = os.getenv("AZURE_SEARCH_INDEX", "ops-sop")
    if not endpoint or not key:
        raise RuntimeError("Search env missing")
    return endpoint.rstrip("/"), key, index

@router.post("/reindex")
def reindex():
    try:
        blob = _blob_client()
        endpoint, key, index = _search()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    container = "sops"
    cc = blob.get_container_client(container)

    docs = []
    for b in cc.list_blobs(name_starts_with="uploads/"):
        bc = cc.get_blob_client(b.name)
        raw = bc.download_blob().readall()
        content = raw.decode("utf-8-sig", errors="ignore")

        docs.append({
            "id": f"blob-{uuid.uuid4().hex}",
            "title": b.name.split("/")[-1],
            "domain": "operations",
            "content": content,
            "source": f"blob:{container}/{b.name}",
            "updatedAt": datetime.now(timezone.utc).isoformat()
        })

    if not docs:
        return {"ok": True, "indexed": 0, "message": "No uploads found"}

    url = f"{endpoint}/indexes/{index}/docs/index?api-version=2023-11-01"
    payload = {"value": [{"@search.action":"mergeOrUpload", **d} for d in docs]}

    r = requests.post(
        url,
        headers={"Content-Type": "application/json", "api-key": key},
        json=payload,
        timeout=30
    )

    if r.status_code >= 300:
        raise HTTPException(status_code=500, detail=f"Index error: {r.text}")

    return {"ok": True, "indexed": len(docs)}
