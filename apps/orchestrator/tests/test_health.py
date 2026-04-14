from fastapi.testclient import TestClient

from orchestrator.app import app


def test_healthz_returns_ok() -> None:
    client = TestClient(app)
    res = client.get("/healthz")

    assert res.status_code == 200
    assert res.json() == {"service": "orchestrator", "status": "ok"}
