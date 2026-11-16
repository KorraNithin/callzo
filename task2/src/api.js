// The only place that talks to the network.
const API_BASE = import.meta.env.VITE_API_URL || "/api";

export class ApiError extends Error {
  constructor(message, { status = 0, detail = null } = {}) {
    super(message);
    this.status = status;
    this.detail = detail;
  }

  // Field-level messages from a 422, e.g. { billing_country: "billing_country is required" }
  get fieldErrors() {
    return this.status === 422 ? this.detail?.errors ?? {} : {};
  }
}

export const isAbort = (error) => error?.name === "AbortError";

export async function request(path, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      signal,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (isAbort(error)) throw error;
    throw new ApiError("Can't reach the server. Check your connection and try again.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(describeFailure(response.status, payload), {
      status: response.status,
      detail: payload?.detail ?? null,
    });
  }
  return payload;
}

function describeFailure(status, payload) {
  const detail = payload?.detail;
  if (typeof detail === "string") return detail;
  if (detail?.errors) return Object.values(detail.errors).join(" ");
  if (status >= 500) return "The server had a problem. Try again.";
  return `The request failed (${status}).`;
}
