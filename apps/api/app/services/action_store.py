from __future__ import annotations

from copy import deepcopy
from threading import Lock
from typing import Any, Dict, List, Optional

_ACTIONS: Dict[str, Dict[str, Any]] = {}
_ACTION_ORDER: List[str] = []
_LOCK = Lock()


def create_action(action: Dict[str, Any]) -> Dict[str, Any]:
    action_id = str(action.get("id") or "").strip()
    if not action_id:
        raise ValueError("action must include non-empty 'id'")

    with _LOCK:
        if action_id in _ACTIONS:
            raise ValueError(f"action '{action_id}' already exists")
        stored = deepcopy(action)
        _ACTIONS[action_id] = stored
        _ACTION_ORDER.append(action_id)
        return deepcopy(stored)


def get_action(action_id: str) -> Optional[Dict[str, Any]]:
    with _LOCK:
        item = _ACTIONS.get(action_id)
        return deepcopy(item) if item is not None else None


def update_action(action_id: str, patch: Dict[str, Any]) -> Dict[str, Any]:
    with _LOCK:
        if action_id not in _ACTIONS:
            raise KeyError(action_id)
        updated = deepcopy(_ACTIONS[action_id])
        updated.update(deepcopy(patch))
        _ACTIONS[action_id] = updated
        return deepcopy(updated)


def list_actions(limit: int = 50) -> List[Dict[str, Any]]:
    safe_limit = max(1, min(int(limit), 200))
    with _LOCK:
        ids = list(reversed(_ACTION_ORDER))[:safe_limit]
        return [deepcopy(_ACTIONS[action_id]) for action_id in ids if action_id in _ACTIONS]
