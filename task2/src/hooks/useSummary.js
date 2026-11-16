import { useCallback, useEffect, useRef, useState } from "react";
import { isAbort, request } from "../api";

const REFRESH_MS = 15_000;
const AUTO_RETRIES = 2; // the endpoint fails about 1 call in 5, so retry quietly before showing an error
const RETRY_DELAY_MS = 400;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Loads the chart series for a date range.
 * status: "loading" | "ready" | "error". Failures retry quietly; if they persist the
 * chart shows an error with a Retry button. The rest of the page is unaffected.
 */
export function useSummary(from, to, enabled) {
  const [state, setState] = useState({ series: [], status: "loading", error: "" });
  const controller = useRef(null);

  const load = useCallback(
    async ({ background = false } = {}) => {
      controller.current?.abort();
      const current = new AbortController();
      controller.current = current;

      if (!background) setState((s) => ({ ...s, status: "loading", error: "" }));

      const params = new URLSearchParams();
      if (from) params.set("date_from", from);
      if (to) params.set("date_to", to);

      for (let attempt = 0; attempt <= AUTO_RETRIES; attempt += 1) {
        try {
          const data = await request(`/accounts/summary?${params}`, { signal: current.signal });
          setState({ series: data.series ?? [], status: "ready", error: "" });
          return;
        } catch (error) {
          if (isAbort(error)) return;
          if (attempt < AUTO_RETRIES) {
            await wait(RETRY_DELAY_MS);
            if (current.signal.aborted) return;
          } else if (!background) {
            setState((s) => ({ ...s, status: "error", error: error.message }));
          } // a failed background refresh keeps the chart that is already showing
        }
      }
    },
    [from, to]
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
