import inspect
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field, field_validator

from app.agents.triage import TriageInput, decision_gate, intake_agent, planner_agent, retrieval_agent
from app.services.action_store import create_action, get_action, list_actions, update_action
from app.services.audit_store import write_audit
from app.services.search import SearchNotConfiguredError, sop_search

router = APIRouter(prefix="/v1/actions", tags=["actions"])
logger = logging.getLogger(__name__)
APPROVER_ALLOWLIST = {"manager", "sre-lead"}


async def _maybe_await(fn, *args, **kwargs):
    result = fn(*args, **kwargs)
    if inspect.isawaitable(result):
        result = await result
    return result


def _preview_keys(value: Any) -> List[str]:
    if isinstance(value, dict):
        return list(value.keys())[:8]
    return []


def _as_dict(value: Any, name: str) -> Dict[str, Any]:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as exc:
            raise TypeError(f"{name} returned non-JSON string") from exc

    if not isinstance(value, dict):
        raise TypeError(f"{name} must return dict, got {type(value).__name__}")

    logger.info("%s.output type=%s keys=%s", name, type(value).__name__, _preview_keys(value))
    return value


def _as_list(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        candidates = value
    elif isinstance(value, str):
        candidates = [value]
    else:
        candidates = [value]

    out: List[str] = []
    for item in candidates:
        text = str(item or "").strip()
        if text:
            out.append(text)
    return out


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_search_not_configured(exc: BaseException) -> bool:
    if isinstance(exc, SearchNotConfiguredError):
        return True
    cause = getattr(exc, "__cause__", None)
    return isinstance(cause, SearchNotConfiguredError)


class ProposeBody(BaseModel):
    incident: str = Field(min_length=1, max_length=2000)
    role: str = Field(default="operator", min_length=1, max_length=64)
    top: int = Field(default=5, ge=1, le=20)

    @field_validator("incident", "role")
    @classmethod
    def _strip_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("must not be empty")
        return normalized


class ApproveBody(BaseModel):
    actionId: str = Field(min_length=1, max_length=128)
    approverRole: str = Field(default="manager", min_length=1, max_length=64)
    decision: Literal["APPROVE", "REJECT"]
    note: str | None = Field(default=None, max_length=1000)

    @field_validator("actionId", "approverRole")
    @classmethod
    def _strip_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("must not be empty")
        return normalized

    @field_validator("note")
    @classmethod
    def _normalize_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        text = value.strip()
        return text if text else None


class ExecuteBody(BaseModel):
    actionId: str = Field(min_length=1, max_length=128)
    executorRole: str = Field(default="operator", min_length=1, max_length=64)

    @field_validator("actionId", "executorRole")
    @classmethod
    def _strip_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("must not be empty")
        return normalized


@router.post("/propose")
async def propose(body: ProposeBody):
    tri = TriageInput(incident=body.incident, role=body.role, top=body.top)
    warnings: List[str] = []

    def safe_search(query: str, top: int = 5):
        try:
            return sop_search(query, top=top, fail_on_unconfigured=True)
        except SearchNotConfiguredError as exc:
            warning = f"Search not configured ({str(exc)}); evidence empty"
            if warning not in warnings:
                warnings.append(warning)
            logger.warning("actions.propose.search_unconfigured message=%s", str(exc))
            return []

    try:
        intake_raw = await _maybe_await(intake_agent, tri.incident)
        intake = _as_dict(intake_raw, "intake_agent")
        if "queries" not in intake:
            raise TypeError("intake_agent returned invalid shape: missing 'queries'")

        queries = _as_list(intake.get("queries"))
        if not queries:
            logger.info("actions.propose.empty_queries incident_len=%s", len(tri.incident))
            queries = [tri.incident]

        category_raw = intake.get("category")
        category = str(category_raw).strip() if category_raw is not None else ""
        if not category:
            logger.info("actions.propose.missing_category fallback=general")
            category = "general"

        evidence = await _maybe_await(retrieval_agent, safe_search, queries, top=tri.top)
        if not isinstance(evidence, list):
            raise TypeError(f"retrieval_agent must return list, got {type(evidence).__name__}")
        for idx, item in enumerate(evidence):
            if not isinstance(item, dict):
                raise TypeError(f"retrieval_agent item at index {idx} must be dict, got {type(item).__name__}")

        plan_raw = await _maybe_await(planner_agent, tri.incident, evidence, category)
        plan = _as_dict(plan_raw, "planner_agent")
        plan.setdefault("requiresApproval", True)
        if "steps" in plan and not isinstance(plan["steps"], list):
            raise TypeError("planner_agent field 'steps' must be list when provided")

        gate_raw = await _maybe_await(decision_gate, tri.role, plan)
        gate = _as_dict(gate_raw, "decision_gate")
        if plan.get("requiresApproval"):
            gate.setdefault("decision", "REQUIRES_APPROVAL")
            gate.setdefault("reason", "Plan requires explicit approval before execution.")
            gate.setdefault("requiredRole", "manager")
            gate.setdefault("allowedToAutoExecute", False)
        else:
            gate.setdefault("decision", "AUTO_APPROVED")
            gate.setdefault("reason", "Plan can be executed without manual approval.")
            gate.setdefault("requiredRole", "operator")
            gate.setdefault("allowedToAutoExecute", True)
        gate.setdefault("requesterRole", tri.role)

        action_id = str(uuid.uuid4())
        action = {
            "id": action_id,
            "status": "PENDING_APPROVAL" if plan.get("requiresApproval") else "READY",
            "createdAt": _utc_now(),
            "updatedAt": _utc_now(),
            "requesterRole": tri.role,
            "category": category,
            "incident": tri.incident,
            "plan": plan,
            "gate": gate,
            "evidence": evidence,
            "warnings": warnings,
        }
        action = create_action(action)

        write_audit(
            "action.proposed",
            {
                "actionId": action_id,
                "status": action["status"],
                "category": action["category"],
                "warningsCount": len(action.get("warnings") or []),
            },
        )
        return action
    except HTTPException:
        raise
    except RuntimeError as exc:
        if _is_search_not_configured(exc):
            # We already degrade to empty evidence in safe_search, this is fallback safety.
            logger.warning("actions.propose.runtime_search_unconfigured", exc_info=True)
            raise HTTPException(status_code=503, detail=f"Search not configured: {exc}")
        raise HTTPException(status_code=502, detail=str(exc))
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception:
        logger.exception("actions.propose.unhandled_error")
        raise HTTPException(status_code=500, detail="Internal error while proposing action")


@router.post("/approve")
async def approve_action(body: ApproveBody):
    role = body.approverRole.lower()
    if role not in APPROVER_ALLOWLIST:
        raise HTTPException(status_code=403, detail="Only manager or sre-lead can approve/reject")

    action = get_action(body.actionId)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")

    current_status = str(action.get("status") or "")
    if current_status == "EXECUTED_SIMULATED":
        raise HTTPException(status_code=409, detail="Executed actions cannot be modified")
    if current_status == "REJECTED" and body.decision == "APPROVE":
        raise HTTPException(status_code=409, detail="Rejected action cannot be approved")

    now = _utc_now()
    patch: Dict[str, Any] = {
        "updatedAt": now,
        "approval": {
            "decision": body.decision,
            "approverRole": role,
            "note": body.note,
            "ts": now,
        },
    }

    if body.decision == "REJECT":
        patch["status"] = "REJECTED"
        event_type = "action.rejected"
    else:
        requires_approval = bool(action.get("plan", {}).get("requiresApproval", True))
        patch["status"] = "READY" if not requires_approval else "APPROVED"
        event_type = "action.approved"

    updated = update_action(body.actionId, patch)
    write_audit(
        event_type,
        {
            "actionId": body.actionId,
            "status": updated.get("status"),
            "approverRole": role,
            "decision": body.decision,
            "note": body.note,
        },
    )
    return updated


@router.post("/execute")
async def execute_action(body: ExecuteBody):
    action = get_action(body.actionId)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")

    status = str(action.get("status") or "")
    if status not in {"APPROVED", "READY"}:
        raise HTTPException(status_code=409, detail="Action status must be APPROVED or READY before execution")

    steps = action.get("plan", {}).get("steps")
    if isinstance(steps, list):
        steps_executed = [str(step) for step in steps]
    else:
        steps_executed = []

    started_at = _utc_now()
    finished_at = _utc_now()
    result = {
        "ok": True,
        "actionId": body.actionId,
        "status": "EXECUTED_SIMULATED",
        "stepsExecuted": steps_executed,
        "startedAt": started_at,
        "finishedAt": finished_at,
    }

    updated = update_action(
        body.actionId,
        {
            "status": "EXECUTED_SIMULATED",
            "updatedAt": finished_at,
            "execution": {
                "executorRole": body.executorRole,
                "mode": "SIMULATED",
                "result": result,
            },
        },
    )
    write_audit(
        "action.executed",
        {
            "actionId": body.actionId,
            "executorRole": body.executorRole,
            "status": updated.get("status"),
            "stepsExecuted": len(steps_executed),
        },
    )
    return result


@router.get("")
async def get_actions(limit: int = Query(default=50, ge=1, le=200)):
    items = list_actions(limit=limit)
    return {"items": items, "count": len(items)}


@router.get("/{action_id}")
async def get_action_by_id(action_id: str):
    action = get_action(action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    return action
