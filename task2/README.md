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
followed by `docker compose up`.

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
