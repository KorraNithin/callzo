import { useEffect, useMemo, useState } from "react";
import AccountsTable from "./components/AccountsTable";
import Filters from "./components/Filters";
import Pagination from "./components/Pagination";
import SettingsDrawer from "./components/SettingsDrawer";
import UsageChart from "./components/UsageChart";
import { useAccounts } from "./hooks/useAccounts";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useSummary } from "./hooks/useSummary";
import { formatNumber, formatTime } from "./lib/format";

const EMPTY_FILTERS = { search: "", status: "", country: "", plan: "", from: "", to: "" };

function buildQuery({ search, filters, sort, page, pageSize }) {
  const params = new URLSearchParams({ page, page_size: pageSize, sort_by: sort.by, sort_dir: sort.dir });
  if (search.trim()) params.set("search", search.trim());
  for (const key of ["status", "country", "plan"]) if (filters[key]) params.set(key, filters[key]);
  if (filters.from) params.set("date_from", filters.from);
  if (filters.to) params.set("date_to", filters.to);
  return params.toString();
}

export default function App() {
  // State that decides WHAT to ask the server for: filters, sort, page. Kept here so the
  // table and the chart share one date range.
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ by: "id", dir: "asc" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  // Selection stores IDs, not rows, so it survives paging, sorting and background refreshes.
  const [selected, setSelected] = useState(() => new Set());
  const [openAccount, setOpenAccount] = useState(null);

  const search = useDebouncedValue(filters.search, 300); // one request per pause, not per keystroke
  const rangeError = filters.from && filters.to && filters.from > filters.to
    ? "The start date is after the end date."
    : "";

  const query = useMemo(
    () => buildQuery({ search, filters, sort, page, pageSize }),
    [search, filters, sort, page, pageSize]
  );
  const accounts = useAccounts(query, !rangeError);
  const summary = useSummary(filters.from, filters.to, !rangeError);

  const pageCount = Math.max(1, Math.ceil(accounts.total / pageSize));
  useEffect(() => {
    if (accounts.status === "ready" && page > pageCount) setPage(pageCount);
  }, [accounts.status, page, pageCount]);

  const hasFilters = Object.values(filters).some(Boolean);

  const changeFilter = (name, value) => {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
  };
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };
  const changeSort = (key) => {
    setSort((current) => (current.by === key ? { by: key, dir: current.dir === "asc" ? "desc" : "asc" } : { by: key, dir: "asc" }));
    setPage(1);
  };
  const toggleRow = (id) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = accounts.rows.every((row) => next.has(row.id));
      accounts.rows.forEach((row) => (allSelected ? next.delete(row.id) : next.add(row.id)));
      return next;
    });

  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4">
          <h1 className="text-xl font-semibold">Usage console</h1>
          <p className="text-sm muted" aria-live="off">
            Refreshes every 15 seconds{accounts.updatedAt ? ` · Updated ${formatTime(accounts.updatedAt)}` : ""}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 px-4 py-4">
        <section aria-label="Filters" className="panel p-4 sm:p-5">
          <Filters filters={filters} onChange={changeFilter} onClear={clearFilters} rangeError={rangeError} hasFilters={hasFilters} />
        </section>

        <UsageChart series={summary.series} status={summary.status} error={summary.error} onRetry={summary.reload} />

        <section aria-labelledby="accounts-title" className="panel">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4 sm:p-5">
            <h2 id="accounts-title" className="font-semibold">
              Accounts <span className="text-sm font-normal muted">({formatNumber(accounts.total)})</span>
            </h2>
            <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm">
              {selected.size > 0 ? (
                <>
                  <span>{formatNumber(selected.size)} selected</span>
                  <button type="button" className="btn" onClick={() => setSelected(new Set())}>Clear selection</button>
                </>
              ) : (
                <span className="muted">No accounts selected</span>
              )}
            </p>
          </div>

          <AccountsTable
            rows={accounts.rows}
            status={accounts.status}
            error={accounts.error}
            refreshError={accounts.refreshError}
            sort={sort}
            onSort={changeSort}
            selected={selected}
            onToggleRow={toggleRow}
            onTogglePage={togglePage}
            onManage={setOpenAccount}
            onRetry={() => accounts.reload()}
            hasFilters={hasFilters}
            onClearFilters={clearFilters}
          />

          <Pagination page={page} pageSize={pageSize} total={accounts.total} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
        </section>
      </main>

      {openAccount && <SettingsDrawer key={openAccount.id} account={openAccount} onClose={() => setOpenAccount(null)} />}
    </>
  );
}
