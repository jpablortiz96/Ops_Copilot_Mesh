import os
import logging
import requests
from typing import Any, Dict, List, Tuple

logger = logging.getLogger(__name__)

API_VERSION = os.getenv("AZURE_SEARCH_API_VERSION", "2023-11-01")


class SearchNotConfiguredError(RuntimeError):
    pass


def _env(name: str) -> str:
    v = os.getenv(name, "").strip()
    if not v:
        raise SearchNotConfiguredError(f"{name} missing")
    return v


def _resolve_config() -> Tuple[str, str, str]:
    endpoint = _env("AZURE_SEARCH_ENDPOINT").rstrip("/")
    key = _env("AZURE_SEARCH_KEY")
    index = os.getenv("AZURE_SEARCH_INDEX", "").strip() or "opsmesh-sops"
    return endpoint, key, index


def sop_search(query: str, top: int = 5, *, fail_on_unconfigured: bool = True) -> List[Dict[str, Any]]:
    """
    Azure AI Search query against the SOP index.
    Returns list of {id,title,domain,source,score,snippet}
    """
    try:
        endpoint, key, index = _resolve_config()
    except SearchNotConfiguredError:
        if fail_on_unconfigured:
            raise
        logger.warning("sop_search.unconfigured returning_empty_results")
        return []

    url = f"{endpoint}/indexes/{index}/docs/search?api-version={API_VERSION}"
    headers = {
        "Content-Type": "application/json",
        "api-key": key,
    }
    payload = {
        "search": query,
        "top": int(top),
        "queryType": "simple",
        "select": "id,title,domain,content,source,updatedAt",
    }

    r = requests.post(url, headers=headers, json=payload, timeout=30)
    if r.status_code >= 400:
        raise RuntimeError(f"Search error: status={r.status_code}")

    data = r.json()
    logger.info(
        "sop_search.response_type type=%s keys=%s",
        type(data).__name__,
        list(data.keys())[:8] if isinstance(data, dict) else [],
    )

    out: List[Dict[str, Any]] = []
    for doc in data.get("value", []):
        content = (doc.get("content") or "").strip()
        out.append({
            "id": str(doc.get("id") or "").strip(),
            "title": doc.get("title") or doc.get("id"),
            "domain": doc.get("domain") or "operations",
            "source": doc.get("source") or "",
            "score": doc.get("@search.score", 0.0),
            "snippet": content[:260],
        })

    out = [item for item in out if item["id"]]
    logger.info("sop_search.normalized_hits count=%s query_len=%s", len(out), len(query or ""))
    return out

