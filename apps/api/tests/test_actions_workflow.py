import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.actions import router as actions_router
from app.routes.audit import router as audit_router
from app.services.search import SearchNotConfiguredError


class ActionsWorkflowTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(actions_router)
        app.include_router(audit_router)
        self.client = TestClient(app)

    def _propose(self, search_payload):
        with patch("app.routes.actions.sop_search", return_value=search_payload):
            response = self.client.post(
                "/v1/actions/propose",
                json={
                    "incident": "Users report 500 errors after deployment",
                    "role": "operator",
                    "top": 5,
                },
            )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_full_approval_execute_workflow(self):
        proposed = self._propose(
            [
                {
                    "id": "sop-app-health",
                    "title": "App Health SOP",
                    "domain": "operations",
                    "source": "blob:sops/uploads/app-health.md",
                    "score": 1.2,
                    "snippet": "Validate readiness and liveness probes.",
                }
            ]
        )
        action_id = proposed["id"]
        self.assertEqual(proposed["status"], "PENDING_APPROVAL")

        approved = self.client.post(
            "/v1/actions/approve",
            json={"actionId": action_id, "approverRole": "manager", "decision": "APPROVE"},
        )
        self.assertEqual(approved.status_code, 200, approved.text)
        approved_data = approved.json()
        self.assertEqual(approved_data["status"], "APPROVED")

        executed = self.client.post(
            "/v1/actions/execute",
            json={"actionId": action_id, "executorRole": "operator"},
        )
        self.assertEqual(executed.status_code, 200, executed.text)
        exec_data = executed.json()
        self.assertTrue(exec_data["ok"])
        self.assertEqual(exec_data["status"], "EXECUTED_SIMULATED")
        self.assertIsInstance(exec_data["stepsExecuted"], list)

        fetched = self.client.get(f"/v1/actions/{action_id}")
        self.assertEqual(fetched.status_code, 200, fetched.text)
        self.assertEqual(fetched.json()["status"], "EXECUTED_SIMULATED")

        audit_recent = self.client.get("/v1/audit/recent?limit=20")
        self.assertEqual(audit_recent.status_code, 200, audit_recent.text)
        items = audit_recent.json()["items"]
        event_types = {item["event"] for item in items}
        self.assertIn("action.proposed", event_types)
        self.assertIn("action.approved", event_types)
        self.assertIn("action.executed", event_types)

    def test_reject_requires_allowed_role(self):
        proposed = self._propose(
            [
                {
                    "id": "sop-log-triage",
                    "title": "Log Triage SOP",
                    "domain": "operations",
                    "source": "blob:sops/uploads/log-triage.md",
                    "score": 1.0,
                    "snippet": "Inspect error logs and correlate trace IDs.",
                }
            ]
        )
        action_id = proposed["id"]

        forbidden = self.client.post(
            "/v1/actions/approve",
            json={"actionId": action_id, "approverRole": "operator", "decision": "REJECT"},
        )
        self.assertEqual(forbidden.status_code, 403, forbidden.text)

        rejected = self.client.post(
            "/v1/actions/approve",
            json={"actionId": action_id, "approverRole": "sre-lead", "decision": "REJECT"},
        )
        self.assertEqual(rejected.status_code, 200, rejected.text)
        self.assertEqual(rejected.json()["status"], "REJECTED")

    def test_propose_degrades_when_search_not_configured(self):
        with patch(
            "app.routes.actions.sop_search",
            side_effect=SearchNotConfiguredError("AZURE_SEARCH_ENDPOINT missing"),
        ):
            response = self.client.post(
                "/v1/actions/propose",
                json={
                    "incident": "Users report 500 errors after deployment",
                    "role": "operator",
                    "top": 5,
                },
            )
        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["evidence"], [])
        self.assertIn("warnings", payload)
        self.assertTrue(any("Search not configured" in warning for warning in payload["warnings"]))


if __name__ == "__main__":
    unittest.main()
