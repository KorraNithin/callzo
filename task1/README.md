# Task 1 - Usage metering service

FastAPI + PostgreSQL service that receives signed call webhooks, stores them, computes
usage per account per month, enforces a monthly cap, and exposes usage through an
authenticated API.

## Run it

```bash
docker compose up --build
```

That starts Postgres, the API (port 8000) and the provided simulator, which runs every
scenario once and exits. No other setup is needed: development defaults are built into
`docker-compose.yml`. To use your own secrets, copy `.env.example` to `.env` first.

To run one scenario only, change `--scenario all` in the `simulator` command to
`normal`, `duplicates`, `out_of_order`, `late`, `malformed`, `bad_signature` or `cap_burst`.

## Run the tests

```bash
docker compose run --rm --no-deps -e DATABASE_URL=sqlite:////tmp/t.db api pytest
```

No Python install is needed. The tests use a throwaway SQLite file; the same suite also
passes against Postgres (`-e DATABASE_URL=postgresql+psycopg://...`).

## API

| Route | Auth | Purpose |
|---|---|---|
| `POST /webhooks/calls` | HMAC signature | Receive one event |
| `GET /health` | none | Database reachability (used by the Docker healthcheck) |
| `GET /metrics` | Bearer | Event counts, pending and permanently failed events, accounts over cap |
| `GET /usage/{account_id}?month=YYYY-MM` | Bearer | Minutes, cost in cents, cap and cap status |
| `POST /admin/reconcile` | Bearer | Rebuild all usage from raw events |
| `POST /admin/retry` | Bearer | Run the retry job now |

Protected routes need `Authorization: Bearer <ADMIN_API_TOKEN>`. Interactive docs: `/docs`.

Example:

```bash
curl -H "Authorization: Bearer local-dev-token-change-me" http://localhost:8000/usage/acct_001
```

## How it works

**Signature.** The HMAC-SHA256 is computed over the raw request bytes and compared with
`hmac.compare_digest`. A missing or wrong signature gets `401` before the body is parsed.

**Validation.** Wrong types, missing fields, negative numbers, bad timestamps, unknown event
types and invalid JSON all get `422` and never reach the database. Booleans are not accepted as
integers. IDs are restricted to letters, digits, `_` and `-`.

**Storing events.** Every accepted event is first written to `call_events` (append-only, the
source of truth) and committed. Only then is usage added. If adding usage fails, the event is
still safely stored and the retry job completes it later.

**Duplicates.** `event_id` has a unique constraint. A repeat hits the constraint, nothing is
added, and the response is `200` with `duplicate: true` so the sender stops retrying.

**Exactly-once usage.** Adding usage starts with `UPDATE ... SET processed = true WHERE processed = false`.
Only one transaction can win that UPDATE for a given event, and the usage increment is in the
same transaction. The increment itself is one atomic `INSERT ... ON CONFLICT DO UPDATE`,
so concurrent events cannot overwrite each other. A stress test (360 concurrent deliveries
of 60 events while the retry job ran) produced exactly the expected total.

**Out-of-order events.** `call.ended` carries everything needed to bill the call, so it does not
wait for `call.started`. Both are stored; `call_id` links them.

**Late events.** A usage event belongs to the month of its own `timestamp`, not the day it
arrived. A 35-day-old event adds to last month's total and does not touch this month's.
They are logged with `late: true`, and `received_at` versus `occurred_at` shows them in the
database. Trade-off: a month that was already invoiced can still change; a billing system
would add a "closed month" flag, which this assessment does not model.

**Money and time.** Cost is an integer number of cents everywhere. Duration is stored in
seconds and billed in whole minutes, rounded up. All timestamps are stored in UTC.

## Monthly cap

This is a **soft cap enforced at call admission**. Billable minutes per account
per calendar month, stored per account in `accounts.monthly_minutes_cap`. The code default is 1,000, but
`docker-compose.yml` sets `MONTHLY_MINUTES_CAP=300` so that one simulator run (the `cap_burst` scenario adds
about 400 minutes to one account) visibly crosses the cap partway through. Change it in `.env` for real use.

- Below the cap: everything is accepted.
- **At the boundary (usage >= cap):** the account is flagged `cap_exceeded` and any new
  `call.started` for the current month is refused with **`409`**.
- Calls already in progress are never cut off. Their `call.ended` events are always accepted and
  counted, so usage can finish above the cap. The receiver cannot hang up a live call; it can only
  refuse to admit new ones.
- Late events for past months never trigger this month's cap.
- The flag is recalculated on every `call.ended` and by reconciliation, so it clears if usage is
  corrected downward.

## Retries and reconciliation

- **Retry job:** a background thread wakes every `RETRY_INTERVAL_SECONDS` (default 30) and
  re-applies any `call.ended` event that is stored but not processed. Each event is tried up to
  `RETRY_MAX_ATTEMPTS` (default 5) times; `attempts` and `last_error` record what happened. Events
  that exhaust their attempts show up in `/metrics` as `events_failed_permanently`.
- **Reconciliation:** `POST /admin/reconcile` deletes and rebuilds `monthly_usage` from the raw
  `call.ended` events inside one transaction (on Postgres it takes a table lock so ingestion waits
  briefly). It then marks events processed so the retry job cannot add them a second time. It is
  safe to run repeatedly.

## Failure behavior

| Situation | Result |
|---|---|
| Bad or missing signature | `401`, nothing parsed or stored |
| Malformed or invalid payload | `422`, nothing stored |
| Duplicate delivery | `200`, `duplicate: true`, nothing added |
| Cap reached, new call | `409`, event not stored |
| Database down | `503` from `/health`; webhook returns `500` so the provider retries |
| Crash or error while adding usage | Event is already stored; retry job completes it |
| App restarts | Nothing is lost; pending events are retried on the next interval |

## Secrets

`DATABASE_URL`, `WEBHOOK_SECRET` and `ADMIN_API_TOKEN` are read from environment variables and the
app refuses to start without them. The values in `docker-compose.yml` are development defaults
(the webhook secret is the shared one from the assessment spec). Real deployments should set them
through `.env` or a secret manager.

## Project layout

```
app/config.py      settings from the environment
app/models.py      tables
app/validation.py  parse and validate a webhook body
app/ingest.py      store an event, then apply its usage
app/usage.py       cap rule, atomic usage updates, reconciliation
app/worker.py      background retry job
app/main.py        HTTP routes
tests/             47 tests: signatures, validation, idempotency, ordering, cap, auth, reconcile, retry
```

## What I would do next

- Alembic migrations instead of `create_all`.
- Exponential backoff and a dead-letter table for events that fail permanently.
- Per-account caps managed through an API, and a "closed month" state for late events.
- Prometheus-format `/metrics` and request IDs in the logs.
- Run the retry job as its own process so it scales separately from the API.
- Keyed API tokens with rotation instead of a single admin token.
