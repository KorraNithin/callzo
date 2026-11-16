import { useEffect, useRef } from "react";
import { formatDollars, formatNumber } from "../lib/format";

const COLUMNS = [
  { key: "id", label: "ID" },
  { key: "name", label: "Account" },
  { key: "company", label: "Company" },
  { key: "country", label: "Country" },
  { key: "plan", label: "Plan" },
  { key: "status", label: "Status" },
  { key: "signup_date", label: "Signed up" },
  { key: "current_month_minutes", label: "Minutes", numeric: true },
  { key: "current_month_sms", label: "SMS", numeric: true },
  { key: "cost_cents", label: "Cost", numeric: true },
  { key: "last_active", label: "Last active" },
];

function SelectPageCheckbox({ rows, selected, onToggle }) {
  const ref = useRef(null);
  const count = rows.filter((row) => selected.has(row.id)).length;
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && count < rows.length;
  }, [count, rows.length]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={rows.length > 0 && count === rows.length}
      onChange={onToggle}
      aria-label="Select all accounts on this page"
    />
  );
}

function Message({ tone, title, children, action }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`m-4 ${tone === "error" ? "alert-error" : "alert-note"}`}>
      <p className="font-medium">{title}</p>
      {children && <p className="mt-1">{children}</p>}
      {action && <div className="mt-3 flex gap-2">{action}</div>}
    </div>
  );
}

export default function AccountsTable({
  rows, status, error, refreshError, sort, onSort, selected, onToggleRow, onTogglePage,
  onManage, onRetry, hasFilters, onClearFilters,
}) {
  if (status === "loading" && rows.length === 0) {
    return (
      <div aria-busy="true" role="status" className="p-4 space-y-2">
        <span className="sr-only">Loading accounts…</span>
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-9 rounded bg-slate-100 motion-safe:animate-pulse" />)}
      </div>
    );
  }

  if (status === "error" && rows.length === 0) {
    return (
      <Message tone="error" title="Couldn't load accounts." action={<button type="button" className="btn-primary" onClick={onRetry}>Try again</button>}>
        {error}
      </Message>
    );
  }

  if (rows.length === 0) {
    return (
      <Message
        tone="note"
        title={hasFilters ? "No accounts match these filters." : "There are no accounts yet."}
        action={hasFilters && <button type="button" className="btn" onClick={onClearFilters}>Clear filters</button>}
      />
    );
  }

  const loading = status === "loading"; // changing filters: keep the old rows visible, dimmed

  return (
    <div>
      {status === "error" && (
        <Message tone="error" title="Couldn't update the table." action={<button type="button" className="btn-primary" onClick={onRetry}>Try again</button>}>
          {error} The rows below are from the last successful load.
        </Message>
      )}
      {refreshError && status !== "error" && (
        <Message tone="note" title="Couldn't refresh in the background." action={<button type="button" className="btn" onClick={onRetry}>Refresh now</button>}>
          {refreshError} Showing the last data we loaded.
        </Message>
      )}
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Accounts table, scrollable">
        <table className={`w-full min-w-[960px] text-sm ${loading ? "opacity-50" : ""}`} aria-busy={loading}>
          <caption className="sr-only">Accounts with usage for the current month</caption>
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th scope="col" className="th w-10">
                <SelectPageCheckbox rows={rows} selected={selected} onToggle={onTogglePage} />
              </th>
              {COLUMNS.map(({ key, label, numeric }) => {
                const active = sort.by === key;
                return (
                  <th key={key} scope="col" className={`th ${numeric ? "text-right" : ""}`} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="sort-button" onClick={() => onSort(key)}>
                      {label}
                      <span aria-hidden="true" className="ml-1 text-xs">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="th"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className={`border-b border-slate-100 ${selected.has(row.id) ? "bg-blue-50" : ""}`}>
                <td className="td">
                  <input type="checkbox" checked={selected.has(row.id)} onChange={() => onToggleRow(row.id)} aria-label={`Select ${row.name}`} />
                </td>
                <td className="td tabular-nums">{row.id}</td>
                <td className="td">
                  <div className="font-medium">{row.name}</div>
                  <div className="text-xs muted">{row.email}</div>
                </td>
                <td className="td">{row.company}</td>
                <td className="td">{row.country}</td>
                <td className="td">{row.plan}</td>
                <td className="td"><span className={`badge badge-${row.status}`}>{row.status}</span></td>
                <td className="td tabular-nums">{row.signup_date}</td>
                <td className="td text-right tabular-nums">{formatNumber(row.current_month_minutes)}</td>
                <td className="td text-right tabular-nums">{formatNumber(row.current_month_sms)}</td>
                <td className="td text-right tabular-nums">{formatDollars(row.cost_cents)}</td>
                <td className="td tabular-nums">{row.last_active}</td>
                <td className="td">
                  <button type="button" className="btn" onClick={(event) => onManage(row, event)} aria-label={`Manage settings for ${row.name}`}>
                    Manage
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
