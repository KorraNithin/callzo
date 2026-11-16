import { useCallback, useEffect, useReducer, useRef } from "react";
import { isAbort, request } from "../api";
import { describeSubmitFailure } from "../lib/format";

export const PLANS = ["basic", "pro", "enterprise"];
export const COUNTRIES = ["US", "IN", "GB", "CA", "AU"];

export const STEPS = [
  { number: 1, title: "Account", fields: ["name", "email"] },
  { number: 2, title: "Plan", fields: ["plan", "billing_country"] },
  { number: 3, title: "Limits", fields: ["minutes_cap", "sms_cap"] },
  { number: 4, title: "Webhook", fields: ["webhook_url"] },
];
const STEP_NUMBERS = STEPS.map((s) => s.number);
const AUTOSAVE_DELAY_MS = 800;

/* ---------- pure helpers ---------- */

function defaultDraft(account) {
  return {
    1: { name: account.name ?? "", email: account.email ?? "" },
    // Only prefill choices the server will accept; otherwise leave the box visibly empty.
    2: {
      plan: PLANS.includes(account.plan) ? account.plan : "",
      billing_country: COUNTRIES.includes(account.country) ? account.country : "",
    },
    3: { minutes_cap: "", sms_cap: "" },
    4: { webhook_url: "" },
  };
}

// What the server has saved wins over the prefill.
function draftFromSaved(saved, account) {
  const draft = defaultDraft(account);
  for (const { number, fields } of STEPS) {
    const data = saved?.[number];
    if (!data) continue;
    for (const field of fields) {
      if (data[field] !== undefined && data[field] !== null) draft[number][field] = String(data[field]);
    }
  }
  return draft;
}

// Mirrors the server's rules so obvious mistakes are caught before a request is sent.
export function validateStep(step, values) {
  const errors = {};
  if (step === 1) {
    if (!values.name.trim()) errors.name = "Enter a name.";
    if (!values.email.includes("@")) errors.email = "Enter an email address that contains @.";
  }
  if (step === 2) {
    if (!PLANS.includes(values.plan)) errors.plan = "Choose a plan.";
    if (!COUNTRIES.includes(values.billing_country)) errors.billing_country = "Choose a billing country.";
  }
  if (step === 3) {
    for (const field of ["minutes_cap", "sms_cap"]) {
      const text = values[field].trim();
      if (text !== "" && !(Number.isFinite(Number(text)) && Number(text) >= 0)) {
        errors[field] = "Enter a number that is 0 or more, or leave it empty.";
      }
    }
  }
  if (step === 4) {
    const url = values.webhook_url.trim();
    if (url !== "" && !/^https?:\/\//.test(url)) errors.webhook_url = "The URL must start with http:// or https://.";
  }
  return errors;
}

function toPayload(step, values) {
  const payload = {};
  for (const field of STEPS[step - 1].fields) {
    const text = values[field].trim();
    if (text === "") continue;
    payload[field] = step === 3 ? Number(text) : text;
  }
  return payload;
}

const without = (object, key) => {
  const { [key]: _removed, ...rest } = object;
  return rest;
};

/* ---------- the hook ---------- */

/**
 * State for the 4-step settings form of one account.
 *
 * `saved`  = what the server has confirmed. It only changes after a successful save.
 * `draft`  = what is in the form. A failed save never touches `saved`, so nothing is lost
 *            and nothing is half-applied; the draft stays visible, flagged, and can be
 *            reverted to `saved`.
 *
 * The state lives in a ref and the component re-renders after each change. Saves are
 * asynchronous and overlap with typing, so async code must always read the latest values.
 */
export function useSettingsForm(account) {
  const accountId = account.id;
  const prefill = useRef(account); // snapshot from when the drawer opened; table refreshes must not reset the form
  const model = useRef({
    load: { status: "loading", error: "" },
    saved: {},
    draft: defaultDraft(account),
    dirty: {}, // step -> edited since the last successful save
    errors: {}, // step -> { fields, message }
    status: {}, // step -> "saving" | "saved" | "failed"
    step: 1,
    submit: { status: "idle", message: "", missing: [] },
    focusErrorToken: 0, // bumps when an explicit action fails, so the UI can move focus to the error
  });
  const [, rerender] = useReducer((n) => n + 1, 0);
  const timers = useRef({});
  const inflight = useRef({});
  const mounted = useRef(true);

  const change = useCallback((mutate) => {
    mutate(model.current);
    if (mounted.current) rerender();
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, []);

  /* ----- loading what is already saved ----- */

  const loadSettings = useCallback(
    async (signal) => {
      change((m) => {
        m.load = { status: "loading", error: "" };
      });
      try {
        const saved = await request(`/accounts/${accountId}/settings`, { signal });
        change((m) => {
          m.saved = saved ?? {};
          m.draft = draftFromSaved(saved, prefill.current);
          m.load = { status: "ready", error: "" };
        });
      } catch (error) {
        if (isAbort(error)) return;
        change((m) => {
          m.load = { status: "error", error: error.message };
        });
      }
    },
    [accountId, change]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadSettings(controller.signal);
    return () => controller.abort();
  }, [loadSettings]);

  const retryLoad = useCallback(() => loadSettings(undefined), [loadSettings]);

  /* ----- saving one step ----- */

  // `auto` saves (typing pause, leaving a step) stay quiet about client-side mistakes
  // and never move focus. Explicit saves (Continue, Try again) report everything.
  const saveStep = useCallback(
    async (step, { auto = false } = {}) => {
      clearTimeout(timers.current[step]);
      if (inflight.current[step]) await inflight.current[step]; // never two saves of one step at once

      const current = model.current;
      if (current.saved[step] && !current.dirty[step]) return true; // already up to date

      const values = current.draft[step];
      const fieldErrors = validateStep(step, values);
      if (Object.keys(fieldErrors).length > 0) {
        if (!auto) {
          change((m) => {
            m.errors = { ...m.errors, [step]: { fields: fieldErrors, message: "" } };
            m.focusErrorToken += 1;
          });
        }
        return false;
      }

      const payload = toPayload(step, values);
      const sent = JSON.stringify(payload);

      const run = (async () => {
        change((m) => {
          m.status = { ...m.status, [step]: "saving" };
        });
        try {
          const result = await request(`/accounts/${accountId}/settings/step/${step}`, {
            method: "PUT",
            body: { data: payload },
          });
          change((m) => {
            m.saved = { ...m.saved, [step]: result?.data ?? payload };
            // Keep the step "edited" if the user typed more while this request was in flight.
            if (JSON.stringify(toPayload(step, m.draft[step])) === sent) m.dirty = { ...m.dirty, [step]: false };
            m.errors = without(m.errors, step);
            m.status = { ...m.status, [step]: "saved" };
          });
          return true;
        } catch (error) {
          change((m) => {
            m.errors = { ...m.errors, [step]: { fields: error.fieldErrors ?? {}, message: error.message } };
            m.status = { ...m.status, [step]: "failed" };
            if (!auto) m.focusErrorToken += 1;
          });
          return false;
        }
      })();

      inflight.current[step] = run;
      try {
        return await run;
      } finally {
        if (inflight.current[step] === run) delete inflight.current[step];
      }
    },
    [accountId, change]
  );

  /* ----- editing ----- */

  const setField = useCallback(
    (field, value) => {
      const step = model.current.step;
      change((m) => {
        m.draft = { ...m.draft, [step]: { ...m.draft[step], [field]: value } };
        m.dirty = { ...m.dirty, [step]: true };
        m.errors = without(m.errors, step);
        m.status = without(m.status, step);
      });
      clearTimeout(timers.current[step]);
      timers.current[step] = setTimeout(() => saveStep(step, { auto: true }), AUTOSAVE_DELAY_MS);
    },
    [change, saveStep]
  );

  const revertStep = useCallback(
    (step) => {
      clearTimeout(timers.current[step]);
      change((m) => {
        m.draft = { ...m.draft, [step]: draftFromSaved(m.saved, prefill.current)[step] };
        m.dirty = { ...m.dirty, [step]: false };
        m.errors = without(m.errors, step);
        m.status = without(m.status, step);
      });
    },
    [change]
  );

  /* ----- moving between steps ----- */

  // Stepper and Back never block: edits are saved in the background if they can be.
  const goToStep = useCallback(
    (target) => {
      const { step, dirty, errors } = model.current;
      if (dirty[step] && !errors[step]) saveStep(step, { auto: true });
      change((m) => {
        m.step = target;
      });
    },
    [change, saveStep]
  );

  // Continue saves this step first and only moves on if that worked.
  const continueToNext = useCallback(async () => {
    const step = model.current.step;
    const saved = await saveStep(step);
    if (saved) {
      change((m) => {
        m.step = Math.min(step + 1, STEP_NUMBERS.length);
      });
    }
  }, [change, saveStep]);

  // The escape hatch that keeps the user from ever being stuck behind a server error.
  const continueWithoutSaving = useCallback(() => {
    change((m) => {
      m.step = Math.min(m.step + 1, STEP_NUMBERS.length);
    });
  }, [change]);

  const flushAll = useCallback(() => {
    const { dirty, errors } = model.current;
    STEP_NUMBERS.filter((n) => dirty[n] && !errors[n]).forEach((n) => saveStep(n, { auto: true }));
  }, [saveStep]);

  /* ----- submitting ----- */

  const submitForm = useCallback(async () => {
    change((m) => {
      m.submit = { status: "submitting", message: "", missing: [] };
    });
    const { saved, dirty } = model.current;
    await Promise.all(STEP_NUMBERS.filter((n) => dirty[n] || !saved[n]).map((n) => saveStep(n, { auto: true })));
    try {
      await request(`/accounts/${accountId}/settings/submit`, { method: "POST" });
      change((m) => {
        m.submit = { status: "done", message: "", missing: [] };
      });
    } catch (error) {
      const { message, missing } = describeSubmitFailure(error);
      change((m) => {
        m.submit = { status: "error", message, missing };
      });
    }
  }, [accountId, change, saveStep]);

  const m = model.current;
  return {
    load: m.load,
    step: m.step,
    draft: m.draft,
    saved: m.saved,
    dirty: m.dirty,
    errors: m.errors,
    status: m.status,
    submit: m.submit,
    focusErrorToken: m.focusErrorToken,
    actions: { retryLoad, setField, saveStep, revertStep, goToStep, continueToNext, continueWithoutSaving, flushAll, submitForm },
  };
}
