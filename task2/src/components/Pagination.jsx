import { formatNumber } from "../lib/format";

export default function Pagination({ page, pageSize, total, onPage, onPageSize }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4 text-sm">
      <p aria-live="polite">Showing {formatNumber(first)}–{formatNumber(last)} of {formatNumber(total)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="page-size" className="muted">Rows per page</label>
        <select id="page-size" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="field !w-auto">
          {[25, 50, 100, 200].map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
        <button type="button" className="btn" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
        <span>Page {page} of {formatNumber(pageCount)}</span>
        <button type="button" className="btn" disabled={page >= pageCount} onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </nav>
  );
}
