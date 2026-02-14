import json
import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, Iterable, List, Mapping

logger = logging.getLogger(__name__)

@dataclass
class TriageInput:
    incident: str
    role: str = "operator"
    top: int = 5

def intake_agent(incident: str) -> Dict:
    text = incident.lower()
    # heurística simple (luego lo cambiamos por LLM)
    category = "unknown"
    if "500" in text or "error" in text or "down" in text:
        category = "availability"
    if "timeout" in text or "latency" in text or "slow" in text:
        category = "performance"
    if "access" in text or "unauthorized" in text or "forbidden" in text:
        category = "authz"
    if "cost" in text or "spike" in text:
        category = "finops"

    keywords = [w for w in ["500", "timeout", "latency", "unauthorized", "inventory", "duplicate", "capacity", "billing", "cost spike"] if w in text]
    suggested_queries = [incident] + keywords
    return {"category": category, "keywords": keywords, "queries": suggested_queries[:4]}

def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default

def _as_hits(raw: Any, query: str) -> List[Mapping[str, Any]]:
    if raw is None:
        return []

    parsed = raw
    if isinstance(parsed, str):
        try:
            parsed = json.loads(parsed)
        except json.JSONDecodeError as exc:
            raise TypeError(f"search_fn returned non-JSON string for query '{query}'") from exc

    if isinstance(parsed, dict):
        logger.info(
            "retrieval_agent.search_payload_type type=%s keys=%s",
            type(parsed).__name__,
            list(parsed.keys())[:8],
        )
        if "results" in parsed:
            parsed = parsed.get("results")
        else:
            parsed = [parsed]
    else:
        logger.info(
            "retrieval_agent.search_payload_type type=%s",
            type(parsed).__name__,
        )

    if parsed is None:
        return []
    if not isinstance(parsed, list):
        raise TypeError(
            f"search_fn must return list or dict(results), got {type(parsed).__name__} for query '{query}'"
        )

    hits: List[Mapping[str, Any]] = []
    for idx, item in enumerate(parsed):
        if not isinstance(item, dict):
            logger.warning(
                "retrieval_agent.skip_non_dict_hit query=%s index=%s type=%s",
                query,
                idx,
                type(item).__name__,
            )
            continue
        hits.append(item)
    return hits

def _normalize_hit(hit: Mapping[str, Any]) -> Dict[str, Any]:
    doc_id = str(hit.get("id") or "").strip()
    if not doc_id:
        raise TypeError("search result item missing non-empty 'id'")

    snippet_src = hit.get("snippet") if hit.get("snippet") is not None else hit.get("content")
    snippet = str(snippet_src or "").strip()[:260]

    return {
        "id": doc_id,
        "title": str(hit.get("title") or doc_id),
        "domain": str(hit.get("domain") or "operations"),
        "source": str(hit.get("source") or ""),
        "score": _to_float(hit.get("score", hit.get("@search.score"))),
        "snippet": snippet,
    }

def _normalize_queries(queries: Iterable[str]) -> List[str]:
    normalized: List[str] = []
    for q in queries:
        text = str(q or "").strip()
        if text:
            normalized.append(text)
    return normalized

def retrieval_agent(search_fn: Callable[..., Any], queries: List[str], top: int) -> List[Dict]:
    # Search Azure AI Search and normalize every hit to a stable evidence contract.
    safe_top = max(1, int(top))
    merged: List[Dict[str, Any]] = []
    seen = set()

    normalized_queries = _normalize_queries(queries)
    if not normalized_queries:
        return []

    for q in normalized_queries:
        try:
            raw = search_fn(q, top=safe_top)
        except Exception as exc:
            raise RuntimeError(f"search_fn failed for query '{q}'") from exc

        for hit in _as_hits(raw, q):
            normalized = _normalize_hit(hit)
            if normalized["id"] in seen:
                continue
            seen.add(normalized["id"])
            merged.append(normalized)
            if len(merged) >= safe_top:
                return merged
    return merged

def planner_agent(incident: str, evidence: List[Dict], category: str) -> Dict:
    # plan determinístico (luego LLM). Aun así: basado en evidencia.
    steps = []
    if evidence:
        steps.append("Review matched SOP evidence (source + snippet).")
    steps += [
        "Confirm scope (users/services/regions) and start time.",
        "Collect evidence (logs/metrics/traces) for the suspected component.",
        "Run the SOP checks in order; stop when root cause is confirmed.",
        "If unresolved, open an incident ticket with attached evidence and escalation notes."
    ]
    risk = "medium" if category in ["availability", "authz"] else "low"
    requires_approval = (risk == "medium")
    return {
        "summary": f"Triage plan for category={category}",
        "risk": risk,
        "requiresApproval": requires_approval,
        "steps": steps,
    }

def decision_gate(role: str, plan: Dict) -> Dict:
    # HITL gate: medium-risk plans require manager/sre-lead approval.
    normalized_role = str(role or "").strip().lower()
    requires_approval = bool(plan.get("requiresApproval", True))

    if requires_approval:
        return {
            "decision": "REQUIRES_APPROVAL",
            "reason": "Plan risk requires manager or sre-lead approval before execution.",
            "requiredRole": "manager",
            "requesterRole": normalized_role,
            "allowedToAutoExecute": False,
        }

    return {
        "decision": "AUTO_APPROVED",
        "reason": "Plan risk is low; execution can proceed without manual approval.",
        "requiredRole": "operator",
        "requesterRole": normalized_role,
        "allowedToAutoExecute": True,
    }
