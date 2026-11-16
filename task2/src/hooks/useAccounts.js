import { useCallback, useEffect, useRef, useState } from "react";
import { isAbort, request } from "../api";

const REFRESH_MS = 15_000;

// Keep rows in the order the user already sees, even if a refresh would reorder them
// (usage numbers drift, so a column sorted by usage would otherwise shuffle every 15 s).
// A real change (new page, sort, filter) loads fresh and takes the server's order.
function updateInPlace(currentRows, freshRows) {
  const fresh = new Map(freshRows.map((row) => [row.id, row]));
  const kept = currentRows.filter((row) => fresh.has(row.id)).map((row) => fresh.get(row.id));
  const keptIds = new Set(kept.map((row) => row.id));
  return [...kept, ...freshRows.filter((row) => !keptIds.has(row.id))];
}

/**
 * Loads one page of accounts for `query` and refreshes it in the background.
 * status: "loading" | "ready" | "error". Old rows stay on screen while loading.
 */
export function useAccounts(query, enabled) {
  const [state, setState] = useState({
    rows: [],
    total: 0,
    status: "loading",
    error: "",
    refreshError: "",
    updatedAt: null,
  });
  const controller = useRef(null);
  const foregroundLoading = useRef(false);

  const load = useCallback(
    async ({ background = false } = {}) => {
      if (background && foregroundLoading.current) return;
      controller.current?.abort(); // a newer request makes the older one irrelevant
      const current = new AbortController();
      controller.current = current;

      if (!background) {
        foregroundLoading.current = true;
        setState((s) => ({ ...s, status: "loading", error: "", refreshError: "" }));
      }
      try {
        const data = await request(`/accounts?${query}`, { signal: current.signal });
        setState((s) => ({
          rows: background ? updateInPlace(s.rows, data.data) : data.data,
          total: data.total,
          status: "ready",
          error: "",
          refreshError: "",
          updatedAt: new Date(),
        }));
      } catch (error) {
        if (isAbort(error)) return;
        setState((s) =>
          background ? { ...s, refreshError: error.message } : { ...s, status: "error", error: error.message }
        );
      } finally {
        if (controller.current === current) foregroundLoading.current = false;
      }
    },
    [query]
  );

  useEffect(() => {
    if (!enabled) return undefined;
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load({ background: true });
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
      controller.current?.abort();
    };
  }, [load, enabled]);

  return { ...state, reload: load };
}
