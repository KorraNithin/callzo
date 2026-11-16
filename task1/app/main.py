"""HTTP layer: webhook receiver, usage API, health and metrics."""
import hashlib
import hmac
import logging
import re
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from . import config, worker
from .database import SessionLocal, engine, get_db
from .ingest import Outcome, ingest_event, is_late
from .logs import log
from .models import Account, Base, CallEvent, MonthlyUsage
from .usage import current_month, reconcile
from .validation import ID_PATTERN, IncomingEvent, parse_event

MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    stop = None
    if config.RETRY_WORKER_ENABLED:
        _thread, stop = worker.start()
    yield
    if stop:
        stop.set()


app = FastAPI(title="Callzo Usage Metering API", version="1.0.0", lifespan=lifespan)


def require_admin(authorization: str | None = Header(default=None)) -> None:
    expected = f"Bearer {config.ADMIN_API_TOKEN}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(401, "Missing or invalid bearer token")


def verify_signature(raw_body: bytes, supplied: str | None) -> None:
    """HMAC-SHA256 over the raw bytes, compared in constant time."""
    expected = hmac.new(config.WEBHOOK_SECRET.encode(), raw_body, hashlib.sha256).hexdigest()
    if not supplied or not hmac.compare_digest(supplied.lower(), expected):
        log("webhook_rejected", logging.WARNING, reason="bad_signature")
        raise HTTPException(401, "Invalid webhook signature")


def _ingest(incoming: IncomingEvent) -> Outcome:
    db = SessionLocal()
    try:
        return ingest_event(db, incoming)
    finally:
        db.close()


@app.post("/webhooks/calls")
async def receive_call(request: Request):
    raw_body = await request.body()
    verify_signature(raw_body, request.headers.get("X-Signature"))  # before anything is parsed
    try:
        incoming = parse_event(raw_body)
    except ValueError as exc:
        log("webhook_rejected", logging.WARNING, reason="invalid_payload", detail=str(exc))
        raise HTTPException(422, str(exc))

    outcome = await run_in_threadpool(_ingest, incoming)

    if outcome is Outcome.CAP_REACHED:
        log("webhook_rejected", logging.WARNING, reason="cap_reached", account_id=incoming.account_id)
        raise HTTPException(409, "Monthly usage cap reached; new calls are blocked")
    if outcome is Outcome.DUPLICATE:
        log("duplicate_ignored", event_id=incoming.event_id)
        return {"accepted": True, "duplicate": True}
    log("webhook_accepted", event_id=incoming.event_id, event_type=incoming.event_type,
        account_id=incoming.account_id, late=is_late(incoming))
    return {"accepted": True, "duplicate": False}


@app.get("/health")
def health(db: Session = Depends(get_db)):
    try:
        db.execute(select(1))
    except Exception:
        raise HTTPException(503, "Database unavailable")
    return {"status": "ok", "database": "connected"}


@app.get("/metrics", dependencies=[Depends(require_admin)])
def metrics(db: Session = Depends(get_db)):
    pending = (CallEvent.event_type == "call.ended") & CallEvent.processed.is_(False)
    return {
        "events_total": db.scalar(select(func.count(CallEvent.id))),
        "events_pending": db.scalar(select(func.count(CallEvent.id)).where(pending)),
        "events_failed_permanently": db.scalar(
            select(func.count(CallEvent.id)).where(pending, CallEvent.attempts >= config.RETRY_MAX_ATTEMPTS)
        ),
        "accounts_over_cap": db.scalar(select(func.count(Account.id)).where(Account.cap_exceeded.is_(True))),
    }


@app.get("/usage/{account_id}", dependencies=[Depends(require_admin)])
def get_usage(account_id: str, month: str | None = None, db: Session = Depends(get_db)):
    if not ID_PATTERN.match(account_id):
        raise HTTPException(422, "Invalid account_id")
    if month is not None and not MONTH_PATTERN.match(month):
        raise HTTPException(422, "month must look like YYYY-MM")
    account = db.get(Account, account_id)
    if account is None:
        raise HTTPException(404, "Account not found")
    month = month or current_month()
    row = db.scalars(
        select(MonthlyUsage).where(MonthlyUsage.account_id == account_id, MonthlyUsage.month == month)
    ).first()
    return {
        "account_id": account_id,
        "month": month,
        "minutes": row.minutes if row else 0,
        "cost_cents": row.cost_cents if row else 0,
        "monthly_minutes_cap": account.monthly_minutes_cap,
        "cap_exceeded": account.cap_exceeded,
    }


@app.post("/admin/reconcile", dependencies=[Depends(require_admin)])
def run_reconcile(db: Session = Depends(get_db)):
    """Recompute all usage from the raw events."""
    result = reconcile(db)
    db.commit()
    log("reconciled", **result)
    return result


@app.post("/admin/retry", dependencies=[Depends(require_admin)])
def run_retry(db: Session = Depends(get_db)):
    """Run the retry job now instead of waiting for the next interval."""
    return worker.retry_pending(db)
