"""Parsing and validation of incoming webhook bodies."""
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone

CALL_STARTED = "call.started"
CALL_ENDED = "call.ended"
CALL_FAILED = "call.failed"
EVENT_TYPES = (CALL_STARTED, CALL_ENDED, CALL_FAILED)

ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_DURATION_SECONDS = 86_400  # one day; anything longer is treated as bad data
MAX_COST_CENTS = 1_000_000


@dataclass(frozen=True)
class IncomingEvent:
    event_id: str
    event_type: str
    account_id: str
    call_id: str
    occurred_at: datetime  # always timezone-aware UTC
    duration_seconds: int
    cost_cents: int
    destination_country: str


def parse_event(raw: bytes) -> IncomingEvent:
    """Turn a raw request body into an IncomingEvent, or raise ValueError."""
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ValueError("Body is not valid JSON")
    if not isinstance(payload, dict):
        raise ValueError("JSON body must be an object")

    event_type = _text(payload, "event_type")
    if event_type not in EVENT_TYPES:
        raise ValueError("Unsupported event_type")

    return IncomingEvent(
        event_id=_identifier(payload, "event_id"),
        event_type=event_type,
        account_id=_identifier(payload, "account_id"),
        call_id=_identifier(payload, "call_id"),
        occurred_at=_timestamp(payload, "timestamp"),
        duration_seconds=_integer(payload, "duration_seconds", MAX_DURATION_SECONDS),
        cost_cents=_integer(payload, "cost_cents", MAX_COST_CENTS),
        destination_country=_text(payload, "destination_country", max_length=8),
    )


def _text(payload: dict, key: str, max_length: int = 64) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not 0 < len(value) <= max_length:
        raise ValueError(f"{key} is required and must be a non-empty string")
    return value


def _identifier(payload: dict, key: str) -> str:
    value = _text(payload, key)
    if not ID_PATTERN.match(value):
        raise ValueError(f"{key} may only contain letters, digits, '_' and '-'")
    return value


def _integer(payload: dict, key: str, maximum: int) -> int:
    value = payload.get(key)
    # bool is a subclass of int in Python, so check the exact type.
    if type(value) is not int:
        raise ValueError(f"{key} is required and must be an integer")
    if not 0 <= value <= maximum:
        raise ValueError(f"{key} must be between 0 and {maximum}")
    return value


def _timestamp(payload: dict, key: str) -> datetime:
    value = _text(payload, key, max_length=40)
    try:
        moment = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError(f"{key} must be an ISO 8601 timestamp")
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)
