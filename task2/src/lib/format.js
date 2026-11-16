export const formatNumber = (value) => Number(value).toLocaleString();

export const formatDollars = (cents) =>
  (Number(cents) / 100).toLocaleString(undefined, { style: "currency", currency: "USD" });

export const formatTime = (date) =>
  date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// POST /settings/submit answers 400 with the steps still missing. The exact shape is not
// documented, so look for a list of step numbers anywhere in `detail` and fall back to text.
export function describeSubmitFailure(error) {
  const missing = findStepNumbers(error.detail);
  if (missing.length) {
    return { message: `These steps still need to be saved: ${missing.join(", ")}.`, missing };
  }
  return { message: error.message, missing: [] };
}

function findStepNumbers(value) {
  if (Array.isArray(value)) {
    const steps = value.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 4);
    return steps.length === value.length ? steps : [];
  }
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) {
      const steps = findStepNumbers(inner);
      if (steps.length) return steps;
    }
  }
  return [];
}
