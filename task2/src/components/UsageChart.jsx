import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDollars, formatNumber } from "../lib/format";

const METRICS = [
  { key: "minutes", label: "Minutes", format: formatNumber },
  { key: "sms", label: "SMS", format: formatNumber },
  { key: "cost_cents", label: "Cost", format: formatDollars },
];

export default function UsageChart({ series, status, error, onRetry }) {
  const [metricKey, setMetricKey] = useState("minutes");
  const metric = METRICS.find((m) => m.key === metricKey);
  const total = useMemo(() => series.reduce((sum, point) => sum + (point[metricKey] ?? 0), 0), [series, metricKey]);

  return (
    <section aria-labelledby="chart-title" className="panel p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="chart-title" className="font-semibold">Usage over time</h2>
        <div role="group" aria-label="Chart metric" className="flex gap-1">
          {METRICS.map(({ key, label }) => (
            <button key={key} type="button" aria-pressed={key === metricKey} onClick={() => setMetricKey(key)} className={`btn ${key === metricKey ? "btn-selected" : ""}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {status === "error" && (
        <div role="alert" className="alert-error">
          <p className="font-medium">Couldn't load the chart.</p>
          <p className="mt-1">{error} The rest of the page still works.</p>
          <button type="button" className="btn-primary mt-3" onClick={() => onRetry()}>Try again</button>
        </div>
      )}

      {status === "loading" && series.length === 0 && (
        <div role="status" className="h-56 rounded bg-slate-100 motion-safe:animate-pulse">
          <span className="sr-only">Loading chart…</span>
        </div>
      )}

      {status !== "error" && series.length === 0 && status !== "loading" && (
        <p role="status" className="alert-note">There's no usage data for this date range.</p>
      )}

      {series.length > 0 && status !== "error" && (
        <div aria-busy={status === "loading"} className={status === "loading" ? "opacity-50" : ""}>
          <p className="sr-only">
            {metric.label} over {series.length} days, from {series[0].date} to {series[series.length - 1].date}. Total {metric.format(total)}.
          </p>
          <div className="h-56" aria-hidden="true">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} minTickGap={32} />
                <YAxis tick={{ fontSize: 11 }} width={56} tickFormatter={(v) => (metricKey === "cost_cents" ? `$${Math.round(v / 100).toLocaleString()}` : v.toLocaleString())} />
                <Tooltip formatter={(value) => [metric.format(value), metric.label]} />
                <Area type="monotone" dataKey={metricKey} stroke="#2563eb" fill="#bfdbfe" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs muted">Total {metric.label.toLowerCase()} in range: {metric.format(total)}</p>
        </div>
      )}
    </section>
  );
}
