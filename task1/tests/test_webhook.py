import json

import pytest
from sqlalchemy import func, select

from app.models import CallEvent
from conftest import days_ago, make_event, post_event, sign, usage


def count_events(db, **filters):
    query = select(func.count(CallEvent.id))
    for column, value in filters.items():
        query = query.where(getattr(CallEvent, column) == value)
    return db.scalar(query)


# ---- signatures -----------------------------------------------------------

def test_valid_signature_is_accepted(client):
    assert post_event(client, make_event()).status_code == 200


def test_bad_signature_is_rejected_and_nothing_is_stored(client, db):
    response = post_event(client, make_event(), signature="0" * 64)
    assert response.status_code == 401
    assert count_events(db) == 0


def test_missing_signature_is_rejected(client):
    raw = json.dumps(make_event()).encode()
    assert client.post("/webhooks/calls", content=raw).status_code == 401


def test_signature_is_checked_before_the_payload_is_parsed(client):
    # Garbage with a bad signature must give 401, not 422.
    response = client.post("/webhooks/calls", content=b"{broken", headers={"X-Signature": "nope"})
    assert response.status_code == 401


def test_signature_covers_the_raw_bytes(client):
    raw = json.dumps(make_event(), indent=2).encode()  # unusual spacing on purpose
    assert client.post("/webhooks/calls", content=raw, headers={"X-Signature": sign(raw)}).status_code == 200


# ---- malformed input --------------------------------------------------------

@pytest.mark.parametrize("raw", [b"", b"{truncated", b"[]", b'{"event_id": "evt_1"}'])
def test_malformed_bodies_get_422(client, raw):
    response = client.post("/webhooks/calls", content=raw, headers={"X-Signature": sign(raw)})
    assert response.status_code == 422


def test_unknown_event_type_gets_422(client):
    assert post_event(client, make_event(event_type="call.exploded")).status_code == 422


# ---- idempotency ------------------------------------------------------------

def test_duplicate_deliveries_are_counted_once(client, db):
    event = make_event(duration_seconds=120, cost_cents=4)
    results = [post_event(client, event).json() for _ in range(3)]

    assert [r["duplicate"] for r in results] == [False, True, True]
    assert count_events(db) == 1
    assert usage(client)["minutes"] == 2
    assert usage(client)["cost_cents"] == 4


# ---- ordering and lateness --------------------------------------------------

def test_call_ended_before_call_started_is_still_counted(client, db):
    ended = make_event(event_type="call.ended", call_id="call_x", duration_seconds=61)
    started = make_event(event_type="call.started", call_id="call_x", duration_seconds=0, cost_cents=0)

    assert post_event(client, ended).status_code == 200
    assert post_event(client, started).status_code == 200

    assert usage(client)["minutes"] == 2  # 61 seconds rounds up to 2 billable minutes
    assert count_events(db, call_id="call_x") == 2


def test_late_event_is_counted_in_the_month_it_happened(client):
    late = make_event(timestamp=days_ago(35), duration_seconds=600, cost_cents=20)
    assert post_event(client, late).status_code == 200

    from datetime import datetime, timedelta, timezone
    old_month = (datetime.now(timezone.utc) - timedelta(days=35)).strftime("%Y-%m")
    assert usage(client, month=old_month)["minutes"] == 10
    assert usage(client)["minutes"] == 0  # the current month is untouched


def test_call_failed_is_stored_but_adds_no_usage(client, db):
    post_event(client, make_event(event_type="call.failed", duration_seconds=0, cost_cents=0))
    assert count_events(db, event_type="call.failed") == 1
    assert usage(client)["minutes"] == 0
