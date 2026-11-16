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

> **Note on the simulator image.** `meetrj/callzo-webhook-simulator` is published for ARM. The compose file pins
> `platform: linux/arm64` so it also runs on Intel/AMD machines through Docker Desktop's emulation.
> A platform warning may appear; it is harmless.

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



# Task 2 - Usage console (React + Tailwind)

An admin console for ~10,500 accounts: server-side search, sort, filters and paging; a
usage chart; row selection; and a 4-step settings form per account.

Libraries: **React**, **Tailwind CSS**, and **Recharts** (the one chart library). Vite is the
build tool. Nothing else is used at runtime: no router, no data-fetching, form or state libraries.

## Run it

```bash
docker compose up
```

Open <http://localhost:3000>. The compose file runs the mock API and the published frontend image
(`image:`, not `build:`). nginx serves the app and forwards `/api/*` to `http://mock-api:8001`.

> **Note on the mock API image.** `meetrj/callzo-mock-usage-api` is published for ARM, so the compose file pins
> `platform: linux/arm64` on `mock-api`. On Intel/AMD machines Docker Desktop runs it through emulation and may
> print a platform warning, which is harmless. The frontend image is published for both `amd64` and `arm64`.

To run from source instead (needs Node 20+ and the mock API on port 8001):

```bash
npm install
npm run dev
```

### Publishing the image (before submitting)

```powershell
docker login
.\publish.ps1 -DockerHubUser yourname
```

This builds for both `linux/amd64` and `linux/arm64` (so it runs on Intel, AMD and Apple Silicon
machines), pushes it, and writes the image name into `docker-compose.yml`. Then set the Docker Hub
repository to **Public**, and test with a clean pull: `docker rmi yourname/callzo-task2-frontend:1.0.0`
followed by `docker compose up`. The published image for this submission is
`nithinkorra11/callzo-task2-frontend:1.0.0`.

## Where state lives, and why

| State | Lives in | Why |
|---|---|---|
| Account rows, totals, chart data | **Server.** Fetched by `useAccounts` / `useSummary` and held only to render | Search, sort, filter and paging run on the server because there are 10,500 rows. The client never holds the full set. |
| Filters, sort, page, page size | **Client** (`App`) | They define the request. The table and chart share one date range, so they sit in one place. |
| Search text | Client, **debounced 300 ms** | One request per pause in typing, not one per keystroke. |
| Row selection | Client, a `Set` of **IDs** | IDs (not row objects) survive paging, sorting, filtering and the 15-second refresh. |
| Settings: saved values | **Server is the truth.** A copy of the last confirmed values sits in `useSettingsForm` | Changes only after a successful save, so a failed save can never half-apply. |
| Settings: draft | Client (`useSettingsForm`), per step | What is in the form right now. It survives step changes and failed saves, and is restored from the server after a refresh. |

Not in the URL: filters and page reset on reload. Putting them in the query string is the main thing
I would add next (see "What I cut").

## How the requirements are met

- **Table.** Search, sort, filters and paging are server-side. Headers are buttons with `aria-sort`.
  The select-all box covers the current page and shows a partial state. Selection is kept across pages.
- **Date range.** One range drives both the table and the chart with no page reload. An inverted range
  shows a message and sends no request.
- **Chart and its failures.** `/accounts/summary` fails about 1 call in 5. The hook retries twice
  quietly; if it still fails the chart shows an inline error with **Try again** and the rest of the
  page keeps working. Failed background refreshes keep the chart already on screen. A text summary is
  available to screen readers.
- **Stale responses.** Every request is cancelled when a newer one starts, so a slow old response can
  never overwrite newer results.
- **Auto-refresh (every 15 s).** The table refreshes in the background without a loading state, keeps
  its rows in the order you already see (the data drifts, and a column sorted by usage would otherwise
  reshuffle), keeps selection, and skips refreshes while the tab is hidden. A failed refresh shows a
  small notice with the last good data; it never blanks the table.
- **States.** Every async view has loading, empty, error and partial-failure states. While filters
  change, the old rows stay visible (dimmed) instead of the table collapsing to a spinner. A failed
  first load shows an error, not "no results".
- **Keyboard and labels.** Everything is reachable and operable by keyboard. Every input has a visible
  label, errors are linked with `aria-describedby` / `aria-invalid`, and visible focus rings are on.
- **Mobile (375 px).** Controls stack, the table scrolls horizontally inside its own region, and the
  settings panel is full width.

## The settings form

Four steps, each saved with its own request. Values saved earlier are restored from the server on
open and after a page refresh.

- **Saving.** Typing autosaves a step after an 800 ms pause. **Save and continue** saves, then moves on.
  Leaving a step with the stepper or **Back** saves in the background without blocking. Obvious
  mistakes (empty name, no `@`) are caught before sending a request.
- **Loading.** If the saved settings can't be loaded, the form is *not* shown with blank defaults,
  because autosave would then overwrite the real data. It shows an error with **Try again** instead.
- **Rollback.** A failed save never changes the saved copy. The step is flagged, the user's entries stay
  on screen, and **Restore last saved values** puts the form back to what the server has.
- **The deliberate step-2 error.** Once step 4 has been saved, the server rejects step 2 with
  "billing_country is required" even for valid values. In that case the error appears on step 2 with
  an explanation that the server rejected a value that looks valid, nothing else is lost, and other
  steps are untouched. The user can **Try saving again**, **Restore last saved values**, or
  **Continue without saving**, so they are never stuck. Step 2 shows **Needs attention** in the
  stepper. Re-saving step 4 does not touch step 2, and an untouched step is never re-sent, so
  just visiting step 2 doesn't trigger the error.
- **Submit.** Saves any step that is valid but unsaved, then submits. If the server answers `400` with
  missing steps, the message lists them with **Go to step N** shortcuts.
- **Focus.** Opening moves focus into the panel and inert-locks the page behind it; Tab stays inside;
  Escape closes; closing returns focus to the **Manage** button you used. Each new step moves focus to
  its heading, and an error after Continue or Submit moves focus to the error. Autosave errors never
  steal focus while you type.

## What I cut, and why

- **URL state** (filters, sort, page in the query string). Skipped to keep the data flow simple. It
  would make views shareable and survive reloads.
- **Per-field autosave and optimistic UI.** Autosave is per step; the UI waits for the server instead
  of guessing.
- **Virtualised rows.** Paging keeps the DOM small (max 200 rows), so it isn't needed.
- **Bulk actions on the selection.** Selection works and persists, but nothing consumes it yet.
- **Automated tests in this repo.** I verified behavior with a throwaway Vitest + Testing Library
  suite against a mock of the API, run outside the repo to avoid adding libraries.
  Covered: debounce, selection across pages, chart failure and retry, the step-2 rule, a failed settings
  load, and focus return.
- **Visual polish and dark mode.** The aim was a clear, accessible layout.

## Layout

```
src/App.jsx                       page layout and the state that drives requests
src/api.js                        fetch wrapper and ApiError
src/hooks/useAccounts.js          table data, cancellation, background refresh
src/hooks/useSummary.js           chart data, quiet retries
src/hooks/useSettingsForm.js      the 4-step form: draft vs saved, autosave, submit
src/components/                   Filters, AccountsTable, Pagination, UsageChart, SettingsDrawer, Fields
```