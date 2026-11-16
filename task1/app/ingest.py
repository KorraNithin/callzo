"""Storing a webhook event and applying its usage."""
from enum import Enum

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .logs import log
from .models import CallEvent
from .usage import current_month, ensure_account, month_key, new_call_blocked, process_ended_event
from .validation import CALL_ENDED, CALL_STARTED, IncomingEvent


class Outcome(Enum):
    ACCEPTED = "accepted"
    DUPLICATE = "duplicate"
    CAP_REACHED = "cap_reached"


def ingest_event(db: Session, incoming: IncomingEvent) -> Outcome:
    """Durably store the event first, then add its usage.

    Storing first means a crash or database error while aggregating never loses
    the event: it stays unprocessed and the retry worker picks it up.
    """
    ensure_account(db, incoming.account_id)

    if incoming.event_type == CALL_STARTED and new_call_blocked(db, incoming.account_id, incoming.occurred_at):
        db.commit()  # keep the cap_exceeded flag that new_call_blocked just refreshed
        return Outcome.CAP_REACHED

    event = CallEvent(
        event_id=incoming.event_id,
        event_type=incoming.event_type,
        account_id=incoming.account_id,
        call_id=incoming.call_id,
        occurred_at=incoming.occurred_at,
        duration_seconds=incoming.duration_seconds,
        cost_cents=incoming.cost_cents,
        destination_country=incoming.destination_country,
        processed=incoming.event_type != CALL_ENDED,  # only call.ended carries usage
    )
    db.add(event)
    try:
        db.commit()
    except IntegrityError:  # unique event_id: this delivery was already stored
        db.rollback()
        return Outcome.DUPLICATE

    if incoming.event_type == CALL_ENDED:
        _apply_usage(db, event)
    return Outcome.ACCEPTED


def _apply_usage(db: Session, event: CallEvent) -> None:
    try:
        process_ended_event(db, event)
        db.commit()
    except Exception as exc:  # the event is already stored, so leave it for the retry worker
        db.rollback()
        log("usage_apply_failed", event_id=event.event_id, error=str(exc)[:200])


def is_late(incoming: IncomingEvent) -> bool:
    return month_key(incoming.occurred_at) != current_month()
