import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.actions import router as actions_router

EXPECTED_EVIDENCE_KEYS = {"id", "title", "domain", "source", "score", "snippet"}


class ActionsProposeTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(actions_router)
        self.client = TestClient(app)

    def _assert_evidence_contract(self, evidence):
        self.assertIsInstance(evidence, list)
        for item in evidence:
            self.assertIsInstance(item, dict)
            self.assertTrue(EXPECTED_EVIDENCE_KEYS.issubset(item.keys()))

    def test_propose_with_search_returning_list_hits(self):
        hits = [
            {
                "id": "sop-500-restart",
                "title": "500 Recovery SOP",
                "domain": "operations",
                "source": "blob:sops/uploads/500-recovery.md",
                "score": 2.31,
                "snippet": "Restart service and verify health checks.",
            },
            {
                "id": "sop-500-rollback",
                "title": "Rollback Playbook",
                "domain": "operations",
                "source": "blob:sops/uploads/rollback.md",
                "score": 1.98,
                "snippet": "Rollback to previous stable deployment.",
            },
        ]

        with patch("app.routes.actions.write_audit", return_value={"ok": True}), patch(
            "app.routes.actions.sop_search", return_value=hits
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
        self.assertIn("evidence", payload)
        self._assert_evidence_contract(payload["evidence"])
        self.assertGreaterEqual(len(payload["evidence"]), 1)
        self.assertIn("plan", payload)
        self.assertIn("gate", payload)
        self.assertIn("status", payload)

    def test_propose_with_search_returning_dict_results(self):
        search_payload = {
            "query": "Users report 500 errors after deployment",
            "results": [
                {
                    "id": "sop-app-health",
                    "title": "App Health SOP",
                    "domain": "operations",
                    "source": "blob:sops/uploads/app-health.md",
                    "score": 1.54,
                    "snippet": "Validate readiness and liveness probes.",
                },
                {
                    "id": "sop-log-triage",
                    "title": "Log Triage SOP",
                    "domain": "operations",
                    "source": "blob:sops/uploads/log-triage.md",
                    "score": 1.11,
                    "snippet": "Inspect error logs and correlate trace IDs.",
                },
            ],
        }

        with patch("app.routes.actions.write_audit", return_value={"ok": True}), patch(
            "app.routes.actions.sop_search", return_value=search_payload
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
        self._assert_evidence_contract(payload["evidence"])
        self.assertGreaterEqual(len(payload["evidence"]), 1)


if __name__ == "__main__":
    unittest.main()
