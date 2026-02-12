import os
from datetime import datetime, timezone
from fastapi import APIRouter, UploadFile, File, HTTPException
from azure.storage.blob import BlobServiceClient

router = APIRouter(prefix="/v1/sop", tags=["sop"])

def _blob_client():
    conn = os.getenv("AZURE_STORAGE_CONNECTION_STRING")
    if not conn:
        raise RuntimeError("AZURE_STORAGE_CONNECTION_STRING missing")
    return BlobServiceClient.from_connection_string(conn)

@router.post("/upload")
async def upload_sop(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    # Solo permitimos primeros formatos (hackathon safe)
    allowed = (".md", ".txt")
    if not file.filename.lower().endswith(allowed):
        raise HTTPException(status_code=400, detail="Only .md/.txt supported for now")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    blob = _blob_client()
    container = "sops"
    path = f"uploads/{datetime.now(timezone.utc).strftime('%Y%m%d')}/{file.filename}"

    blob.get_container_client(container).upload_blob(
        name=path,
        data=data,
        overwrite=True,
        content_type=file.content_type or "text/plain"
    )

    return {"ok": True, "container": container, "path": path, "bytes": len(data)}
