"""Background retry of call.ended events whose usage was not applied."""
import threading

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from . import config
from .database import SessionLocal
from .logs import log
from .models import CallEvent
from .usage import process_ended_event
from .validation import CALL_ENDED

BATCH_SIZE = 100


def retry_pending(db: Session) -> dict:
    """Retry pending events once each. Events that keep failing stop at RETRY_MAX_ATTEMPTS."""
    event_ids = db.scalars(
        select(CallEvent.id)
        .where(
            CallEvent.event_type == CALL_ENDED,
            CallEvent.processed.is_(False),
            CallEvent.attempts < config.RETRY_MAX_ATTEMPTS,
        )
        .order_by(CallEvent.id)
        .limit(BATCH_SIZE)
    ).all()
    result = {"retried": 0, "failed": 0}
    for event_id in event_ids:
        if _retry_one(db, event_id):
            result["retried"] += 1
        else:
            result["failed"] += 1
    return result


def _retry_one(db: Session, event_id: int) -> bool:
    event = db.scalars(
        select(CallEvent)
        .where(CallEvent.id == event_id, CallEvent.processed.is_(False))
        .with_for_update(skip_locked=True)  # another worker may hold it; skip, don't wait
    ).first()
    if event is None:
        return True
    try:
        process_ended_event(db, event)
        db.execute(update(CallEvent).where(CallEvent.id == event_id).values(attempts=CallEvent.attempts + 1, last_error=None))
        db.commit()
        log("retry_succeeded", event_id=event.event_id)
        return True
    except Exception as exc:
        db.rollback()
        db.execute(
            update(CallEvent)
            .where(CallEvent.id == event_id)
            .values(attempts=CallEvent.attempts + 1, last_error=str(exc)[:500])
        )
        db.commit()
        log("retry_failed", event_id=event_id, error=str(exc)[:200])
        return False


def run_forever(stop: threading.Event) -> None:
    while not stop.wait(config.RETRY_INTERVAL_SECONDS):
        db = SessionLocal()
        try:
            retry_pending(db)
        except Exception as exc:
            log("retry_worker_error", error=str(exc)[:200])
        finally:
            db.close()


def start() -> tuple[threading.Thread, threading.Event]:
    stop = threading.Event()
    thread = threading.Thread(target=run_forever, args=(stop,), name="retry-worker", daemon=True)
    thread.start()
    return thread, stop
