import json

import pytest

from app.validation import parse_event
from conftest import make_event


def parse(**overrides):
    return parse_event(json.dumps(make_event(**overrides)).encode())


def test_valid_event_timestamp_is_utc():
    assert parse().occurred_at.utcoffset().total_seconds() == 0


def test_timestamp_without_timezone_is_treated_as_utc():
    assert parse(timestamp="2026-11-01T10:15:30").occurred_at.hour == 10


@pytest.mark.parametrize(
    "overrides, message",
    [
        ({"event_type": "call.unknown"}, "Unsupported"),
        ({"duration_seconds": True}, "duration_seconds"),
        ({"duration_seconds": "5"}, "duration_seconds"),
        ({"cost_cents": -1}, "cost_cents"),
        ({"cost_cents": 1.5}, "cost_cents"),
        ({"account_id": "bad id!"}, "account_id"),
        ({"timestamp": "yesterday"}, "timestamp"),
        ({"event_id": ""}, "event_id"),
    ],
)
def test_invalid_fields_are_rejected(overrides, message):
    with pytest.raises(ValueError, match=message):
        parse(**overrides)


def test_missing_field_is_rejected():
    event = make_event()
    del event["call_id"]
    with pytest.raises(ValueError, match="call_id"):
        parse_event(json.dumps(event).encode())


@pytest.mark.parametrize("raw", [b"", b"{not json", b'{"event_id": "x"', b"[]", b"\xff\xfe"])
def test_garbage_bodies_are_rejected(raw):
    with pytest.raises(ValueError):
        parse_event(raw)
