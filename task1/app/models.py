"""Database schema.

call_events  - append-only log of every accepted webhook (source of truth).
monthly_usage - aggregate per account and calendar month, rebuildable from call_events.
accounts     - per-account cap and the current "cap reached" flag.

All money is stored as integer cents. Durations are stored as whole seconds.
"""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import declarative_base

from . import config

Base = declarative_base()


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Account(Base):
    __tablename__ = "accounts"

    id = Column(String, primary_key=True)
    monthly_minutes_cap = Column(Integer, nullable=False, default=config.DEFAULT_MONTHLY_MINUTES_CAP)
    cap_exceeded = Column(Boolean, nullable=False, default=False)


class CallEvent(Base):
    __tablename__ = "call_events"

    id = Column(Integer, primary_key=True)
    event_id = Column(String, nullable=False, unique=True, index=True)
    event_type = Column(String, nullable=False)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=False, index=True)
    call_id = Column(String, nullable=False, index=True)
    occurred_at = Column(DateTime(timezone=True), nullable=False, index=True)
    duration_seconds = Column(Integer, nullable=False, default=0)
    cost_cents = Column(Integer, nullable=False, default=0)
    destination_country = Column(String, nullable=False)
    received_at = Column(DateTime(timezone=True), nullable=False, default=_now)
    # processed=False on a call.ended means usage has not been added yet.
    processed = Column(Boolean, nullable=False, default=False)
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(String, nullable=True)

    __table_args__ = (Index("ix_call_events_pending", "event_type", "processed"),)


class MonthlyUsage(Base):
    __tablename__ = "monthly_usage"

    id = Column(Integer, primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=False)
    month = Column(String(7), nullable=False)  # "YYYY-MM", from the event's timestamp
    minutes = Column(Integer, nullable=False, default=0)
    cost_cents = Column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("account_id", "month"),)
