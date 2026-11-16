import hashlib
import hmac
import json
import os
import tempfile
from datetime import datetime, timedelta, timezone

# Settings must exist before the app is imported.
_DB_FILE = os.path.join(tempfile.mkdtemp(), "test.db")
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_DB_FILE}")
os.environ["WEBHOOK_SECRET"] = "test-secret"
os.environ["ADMIN_API_TOKEN"] = "test-admin-token"
os.environ["RETRY_WORKER_ENABLED"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402

ADMIN = {"Authorization": "Bearer test-admin-token"}


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def db():
    session = SessionLocal()
    yield session
    session.close()


def sign(raw: bytes, secret: str = "test-secret") -> str:
    return hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()


def make_event(**overrides) -> dict:
    event = {
        "event_id": f"evt_{os.urandom(4).hex()}",
        "event_type": "call.ended",
        "account_id": "acct_001",
        "call_id": f"call_{os.urandom(4).hex()}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "duration_seconds": 120,
        "cost_cents": 4,
        "destination_country": "US",
    }
    event.update(overrides)
    return event


def days_ago(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def post_event(client, event: dict, signature: str | None = None):
    raw = json.dumps(event).encode()
    headers = {"X-Signature": signature if signature is not None else sign(raw)}
    return client.post("/webhooks/calls", content=raw, headers=headers)


def usage(client, account_id="acct_001", month=None):
    params = {"month": month} if month else {}
    return client.get(f"/usage/{account_id}", params=params, headers=ADMIN).json()
