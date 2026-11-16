# Callzo Software Engineer Intern Assessment

Two independent projects, one folder per task:

| Folder | What it is | Stack |
|---|---|---|
| [`task1/`](task1/) | Usage metering service that receives signed call webhooks and enforces a monthly cap | FastAPI, PostgreSQL, SQLAlchemy |
| [`task2/`](task2/) | Usage administration console with a table, chart and 4-step settings form | React, Tailwind CSS, Recharts |

Each folder has its own README with the architecture, design decisions, failure behavior and run instructions.

## Quick start

You need Docker Desktop. Nothing else has to be installed.

### Task 1: webhook metering service

```bash
cd task1
docker compose up --build
```

This starts PostgreSQL, the API on port 8000, and Callzo's webhook simulator, which runs every scenario once and exits.

Run the tests (47 tests, no Python install needed):

```bash
docker compose run --rm --no-deps -e DATABASE_URL=sqlite:////tmp/t.db api pytest
```

### Task 2: usage console

```bash
cd task2
docker compose up
```

Open <http://localhost:3000>. The compose file runs Callzo's mock API plus my frontend, which is pulled as a prebuilt public image:

```
nithinkorra11/callzo-task2-frontend:1.0.0
```

The image is published for both `linux/amd64` and `linux/arm64`. It is not built from source by `docker compose up`.

> **Note on Callzo's images.** The provided simulator (Task 1) and mock API (Task 2) images are published for ARM only. Both
> compose files pin `platform: linux/arm64` for them, so they also run on Intel/AMD machines through Docker Desktop's
> emulation. A platform warning may appear; it is harmless.

## What each task covers

### Task 1: metering service

- **Signed webhooks.** HMAC-SHA256 over the raw request bytes, compared in constant time. A bad or missing signature gets `401` before the body is parsed.
- **Validation.** Malformed or invalid payloads get `422` and are never stored.
- **Idempotency.** A unique `event_id` makes duplicate deliveries harmless: usage is counted once and the response is still `200`.
- **Out-of-order and late events.** A `call.ended` arriving before its `call.started` is still counted. Late events count in the month they actually happened.
- **Exactly-once usage.** Each event is claimed with an atomic update and usage is added with one atomic upsert, so concurrent requests and the retry job cannot double-count. A stress test of 360 concurrent deliveries produced the exact expected total.
- **Monthly cap.** A soft cap enforced at call admission: once usage reaches the cap, new calls get `409`, while calls already in progress finish and are counted.
- **Retries and reconciliation.** A background job re-applies events whose usage failed. `POST /admin/reconcile` rebuilds all usage from the raw events.
- **Operations.** Authenticated usage API, health check, metrics, structured JSON logs, and secrets read from environment variables.

### Task 2: usage console

- **Table.** Server-side search, sort, filters and paging over about 10,500 accounts. Row selection persists across pages.
- **Date range.** One range drives both the table and the chart without a page reload.
- **Chart.** Handles the API's random failures with quiet retries, then an inline error with a Try again button. The rest of the page keeps working.
- **Auto-refresh.** Every 15 seconds, without a loading flash. Rows keep their order and the selection is preserved.
- **Settings form.** Four steps with autosave and drafts that survive a refresh. A failed save never loses data. The deliberate step-2 server error shows on step 2 with a way to retry, restore, or continue, so the user is never stuck.
- **Accessibility and mobile.** Full keyboard use, labelled controls, focus managed in the settings panel, and a layout that works at 375 px wide.

## Design decisions in brief

| Question | Answer |
|---|---|
| What happens to a duplicate event? | The unique `event_id` rejects it, nothing is added, and the sender still gets `200`. |
| What happens at the cap? | New calls are refused with `409`. Calls already running finish and are counted. |
| Which month does a late event count in? | The month of its own timestamp, not the day it arrived. |
| What if adding usage fails after an event is stored? | The event stays stored and unprocessed, and the retry job completes it. |
| Where does state live in Task 2? | Server data comes from the API. Filters, sort and page live in the client. Selection is stored by account ID. The settings form keeps a "saved" copy and a "draft" copy. |

The full reasoning, failure tables and the list of what I chose to cut are in [`task1/README.md`](task1/README.md) and [`task2/README.md`](task2/README.md).

## Repository layout

```
task1/
  app/            API, models, validation, usage logic, retry worker
  tests/          47 tests
  Dockerfile
  docker-compose.yml
  README.md
task2/
  src/            components, hooks and API client
  Dockerfile, nginx.conf
  docker-compose.yml
  publish.ps1     builds and pushes the multi-architecture image
  README.md
```

## Secrets

No real secrets are committed. Task 1 reads `DATABASE_URL`, `WEBHOOK_SECRET` and `ADMIN_API_TOKEN` from environment variables. The values in its `docker-compose.yml` are clearly labelled development defaults, and `task1/.env.example` shows how to override them.