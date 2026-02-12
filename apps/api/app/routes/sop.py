import os
import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/v1/sop")

class SopQuery(BaseModel):
    query: str
    top: int = 3

@router.post("/search")
def search_sop(payload: SopQuery):
    endpoint = os.getenv("AZURE_SEARCH_ENDPOINT")
    key = os.getenv("AZURE_SEARCH_KEY")
    index = os.getenv("AZURE_SEARCH_INDEX", "ops-sop")

    if not endpoint or not key:
        raise HTTPException(status_code=500, detail="Search not configured")

    url = f"{endpoint}/indexes/{index}/docs/search?api-version=2023-11-01"
    headers = {"Content-Type": "application/json", "api-key": key}
    body = {"search": payload.query, "top": payload.top}

    r = requests.post(url, headers=headers, json=body, timeout=20)
    if r.status_code >= 400:
        raise HTTPException(status_code=500, detail=f"Search error: {r.text}")

    data = r.json()
    results = []
    for item in data.get("value", []):
        results.append({
            "id": item.get("id"),
            "title": item.get("title"),
            "domain": item.get("domain"),
            "source": item.get("source"),
            "score": item.get("@search.score"),
            "snippet": (item.get("content") or "")[:300]
        })


    return {"query": payload.query, "results": results}
