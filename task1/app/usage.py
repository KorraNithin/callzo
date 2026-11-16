"""Usage accounting: aggregation, the monthly cap, and reconciliation.

Cap rule (soft cap, enforced at call admission):
  * A month's usage is the sum of billable minutes of its call.ended events.
  * Once usage >= the account's cap, new calls (call.started) for the current
    month are refused with 409 and the account is flagged cap_exceeded.
  * Calls already in progress still end normally, and their usage is always
    recorded, so usage can finish above the cap.
"""
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import delete, select, text, update
from sqlalchemy.dialects import postgresql, sqlite
from sqlalchemy.orm import Session

from . import config
from .models import Account, CallEvent, MonthlyUsage
from .validation import CALL_ENDED


def month_key(moment: datetime) -> str:
    return moment.strftime("%Y-%m")


def current_month() -> str:
    return month_key(datetime.now(timezone.utc))


def billable_minutes(duration_seconds: int) -> int:
    """Round up to whole minutes, the way telephony is usually billed."""
    return (duration_seconds + 59) // 60


def cap_reached(minutes: int, cap: int) -> bool:
    return minutes >= cap


def _insert(db: Session):
    """Dialect-specific INSERT, because ON CONFLICT lives in the dialect modules."""
    return postgresql.insert if db.get_bind().dialect.name == "postgresql" else sqlite.insert


def ensure_account(db: Session, account_id: str) -> None:
    """Create the account on first sight; safe if two requests race."""
    statement = _insert(db)(Account).values(
        id=account_id,
        monthly_minutes_cap=config.DEFAULT_MONTHLY_MINUTES_CAP,
        cap_exceeded=False,
    )
    db.execute(statement.on_conflict_do_nothing(index_elements=["id"]))


def month_minutes(db: Session, account_id: str, month: str) -> int:
    minutes = db.scalar(
        select(MonthlyUsage.minutes).where(
            MonthlyUsage.account_id == account_id, MonthlyUsage.month == month
        )
    )
    return minutes or 0


def refresh_cap_flag(db: Session, account_id: str) -> None:
    """Recompute cap_exceeded from the current month's usage."""
    cap = db.scalar(select(Account.monthly_minutes_cap).where(Account.id == account_id))
    reached = cap_reached(month_minutes(db, account_id, current_month()), cap)
    db.execute(update(Account).where(Account.id == account_id).values(cap_exceeded=reached))


def new_call_blocked(db: Session, account_id: str, occurred_at: datetime) -> bool:
    """True if a call.started must be refused because the cap is already reached."""
    month = month_key(occurred_at)
    if month != current_month():
        return False  # a late event for a past month cannot start a new call
    refresh_cap_flag(db, account_id)
    return bool(db.scalar(select(Account.cap_exceeded).where(Account.id == account_id)))


def _add_usage(db: Session, account_id: str, month: str, minutes: int, cost_cents: int) -> None:
    """Atomic add (INSERT ... ON CONFLICT DO UPDATE), so concurrent events never lose an update."""
    statement = _insert(db)(MonthlyUsage).values(
        account_id=account_id, month=month, minutes=minutes, cost_cents=cost_cents
    )
    db.execute(
        statement.on_conflict_do_update(
            index_elements=["account_id", "month"],
            set_={
                "minutes": MonthlyUsage.minutes + statement.excluded.minutes,
                "cost_cents": MonthlyUsage.cost_cents + statement.excluded.cost_cents,
            },
        )
    )


def process_ended_event(db: Session, event: CallEvent) -> bool:
    """Add a call.ended event's usage exactly once. The caller commits.

    The UPDATE ... WHERE processed = false is the "claim": if two workers race
    for the same event, only one UPDATE matches a row, so usage is added once.
    Claim and aggregate share one transaction, so a failure undoes both.
    """
    claimed = db.execute(
        update(CallEvent)
        .where(CallEvent.id == event.id, CallEvent.processed.is_(False))
        .values(processed=True)
    ).rowcount
    if not claimed:
        return False
    month = month_key(event.occurred_at)
    _add_usage(db, event.account_id, month, billable_minutes(event.duration_seconds), event.cost_cents)
    if month == current_month():
        refresh_cap_flag(db, event.account_id)
    return True


def reconcile(db: Session) -> dict:
    """Rebuild every monthly_usage row from the raw call.ended events. The caller commits."""
    if db.get_bind().dialect.name == "postgresql":
        # Block concurrent aggregation while the table is rebuilt.
        db.execute(text("LOCK TABLE monthly_usage IN SHARE ROW EXCLUSIVE MODE"))

    totals = defaultdict(lambda: [0, 0])
    rows = db.execute(
        select(CallEvent.account_id, CallEvent.occurred_at, CallEvent.duration_seconds, CallEvent.cost_cents)
        .where(CallEvent.event_type == CALL_ENDED)
    ).all()
    for account_id, occurred_at, duration_seconds, cost_cents in rows:
        bucket = totals[(account_id, month_key(occurred_at))]
        bucket[0] += billable_minutes(duration_seconds)
        bucket[1] += cost_cents

    db.execute(delete(MonthlyUsage))
    for (account_id, month), (minutes, cost_cents) in totals.items():
        db.add(MonthlyUsage(account_id=account_id, month=month, minutes=minutes, cost_cents=cost_cents))
    # Everything is now counted, so nothing may be left for the retry worker to add again.
    db.execute(
        update(CallEvent).where(CallEvent.event_type == CALL_ENDED).values(processed=True, last_error=None)
    )
    db.flush()
    for account_id in db.scalars(select(Account.id)).all():
        refresh_cap_flag(db, account_id)
    return {"events_counted": len(rows), "monthly_buckets": len(totals)}
