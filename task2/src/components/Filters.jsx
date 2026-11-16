import { COUNTRIES, PLANS } from "../hooks/useSettingsForm";

const STATUSES = ["active", "trial", "suspended"];

function Select({ id, label, value, onChange, options, allLabel }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="field">
        <option value="">{allLabel}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  );
}

export default function Filters({ filters, onChange, onClear, rangeError, hasFilters }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2 lg:col-span-2">
          <label htmlFor="f-search" className="label">Search</label>
          <input
            id="f-search"
            type="search"
            value={filters.search}
            onChange={(e) => onChange("search", e.target.value)}
            placeholder="Name, email or company"
            className="field"
            autoComplete="off"
          />
        </div>
        <Select id="f-status" label="Status" value={filters.status} onChange={(v) => onChange("status", v)} options={STATUSES} allLabel="All statuses" />
        <Select id="f-country" label="Country" value={filters.country} onChange={(v) => onChange("country", v)} options={COUNTRIES} allLabel="All countries" />
        <Select id="f-plan" label="Plan" value={filters.plan} onChange={(v) => onChange("plan", v)} options={PLANS} allLabel="All plans" />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="f-from" className="label">Signed up from</label>
          <input id="f-from" type="date" value={filters.from} onChange={(e) => onChange("from", e.target.value)} className="field" max={filters.to || undefined} />
        </div>
        <div>
          <label htmlFor="f-to" className="label">Signed up to</label>
          <input id="f-to" type="date" value={filters.to} onChange={(e) => onChange("to", e.target.value)} className="field" min={filters.from || undefined} />
        </div>
        {hasFilters && <button type="button" className="btn" onClick={onClear}>Clear filters</button>}
      </div>

      {rangeError && <p role="alert" className="error-text">{rangeError} The table and chart will update when this is fixed.</p>}
    </div>
  );
}
