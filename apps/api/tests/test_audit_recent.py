import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes.audit import router as audit_router


class AuditRecentTests(unittest.TestCase):
    def setUp(self) -> None:
        app = FastAPI()
        app.include_router(audit_router)
        self.client = TestClient(app)

    def test_recent_orders_ascending_and_filters_action(self):
        source = [
            {
                "id": "3",
                "type": "action.executed",
                "ts": "2026-02-14T10:00:00+00:00",
                "payload": {"actionId": "a-1", "status": "EXECUTED_SIMULATED"},
            },
            {
                "id": "2",
                "type": "action.approved",
                "ts": "2026-02-14T09:30:00+00:00",
                "payload": {"actionId": "a-2", "status": "APPROVED"},
            },
            {
                "id": "1",
                "type": "action.proposed",
                "ts": "2026-02-14T09:00:00+00:00",
                "payload": {"actionId": "a-1", "status": "PENDING_APPROVAL"},
            },
        ]

        with patch("app.routes.audit.recent_audits", return_value=source):
            response = self.client.get("/v1/audit/recent?actionId=a-1&limit=50")

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["count"], 2)
        items = payload["items"]
        self.assertEqual(items[0]["event"], "action.proposed")
        self.assertEqual(items[1]["event"], "action.executed")
        self.assertEqual(items[0]["actionId"], "a-1")
        self.assertEqual(items[1]["actionId"], "a-1")
        self.assertIn("data", items[0])
        self.assertIn("data", items[1])

    def test_recent_returns_empty_when_store_fails(self):
        with patch("app.routes.audit.recent_audits", side_effect=RuntimeError("store unavailable")):
            response = self.client.get("/v1/audit/recent?limit=50")

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["items"], [])


if __name__ == "__main__":
    unittest.main()
