from sqlalchemy import select, update

from app.models import CallEvent, MonthlyUsage
from app.worker import retry_pending
from conftest import ADMIN, make_event, post_event, usage

# ---- authentication ---------------------------------------------------------

def test_usage_requires_a_token(client):
    post_event(client, make_event())
    assert client.get("/usage/acct_001").status_code == 401
    assert client.get("/usage/acct_001", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_usage_rejects_invalid_input(client):
    assert client.get("/usage/acct_001", params={"month": "2026-13"}, headers=ADMIN).status_code == 422
    assert client.get("/usage/bad id", headers=ADMIN).status_code in (404, 422)


def test_unknown_account_is_404(client):
    assert client.get("/usage/acct_404", headers=ADMIN).status_code == 404


def test_admin_endpoints_require_a_token(client):
    assert client.post("/admin/reconcile").status_code == 401
    assert client.post("/admin/retry").status_code == 401
    assert client.get("/metrics").status_code == 401


def test_health_is_public(client):
    assert client.get("/health").json()["status"] == "ok"


def test_metrics_counts_events(client):
    post_event(client, make_event())
    assert client.get("/metrics", headers=ADMIN).json()["events_total"] == 1


# ---- reconciliation ---------------------------------------------------------

def test_reconcile_rebuilds_usage_from_raw_events(client, db):
    post_event(client, make_event(duration_seconds=120, cost_cents=4))
    post_event(client, make_event(duration_seconds=60, cost_cents=2))
    db.execute(update(MonthlyUsage).values(minutes=999, cost_cents=999))  # corrupt the aggregate
    db.commit()

    result = client.post("/admin/reconcile", headers=ADMIN).json()

    assert result["events_counted"] == 2
    assert usage(client)["minutes"] == 3
    assert usage(client)["cost_cents"] == 6


def test_reconcile_is_repeatable(client):
    post_event(client, make_event(duration_seconds=120))
    client.post("/admin/reconcile", headers=ADMIN)
    client.post("/admin/reconcile", headers=ADMIN)
    assert usage(client)["minutes"] == 2


# ---- retries ----------------------------------------------------------------

def stored_but_unprocessed(client, db):
    """An event that was saved but whose usage was never applied (e.g. a crash)."""
    post_event(client, make_event(duration_seconds=180, cost_cents=6))
    db.execute(update(CallEvent).values(processed=False))
    db.execute(update(MonthlyUsage).values(minutes=0, cost_cents=0))
    db.commit()


def test_retry_applies_pending_usage_exactly_once(client, db):
    stored_but_unprocessed(client, db)

    first = retry_pending(db)
    second = retry_pending(db)

    assert first == {"retried": 1, "failed": 0}
    assert second == {"retried": 0, "failed": 0}
    assert usage(client)["minutes"] == 3


def test_reconcile_then_retry_does_not_double_count(client, db):
    stored_but_unprocessed(client, db)

    client.post("/admin/reconcile", headers=ADMIN)
    retry_pending(db)

    assert usage(client)["minutes"] == 3


def test_retry_endpoint_runs_the_job(client, db):
    stored_but_unprocessed(client, db)
    assert client.post("/admin/retry", headers=ADMIN).json() == {"retried": 1, "failed": 0}
    assert db.scalars(select(CallEvent.processed)).first() is True
