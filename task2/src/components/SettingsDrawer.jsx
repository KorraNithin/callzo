import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { STEPS, useSettingsForm } from "../hooks/useSettingsForm";
import { StepFields } from "./Fields";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function stepState(form, number) {
  if (form.status[number] === "saving") return { label: "Saving…", tone: "muted" };
  if (form.errors[number]) return { label: "Needs attention", tone: "bad" };
  if (form.dirty[number]) return { label: "Unsaved", tone: "warn" };
  if (form.saved[number]) return { label: "Saved", tone: "good" };
  return { label: "Not saved yet", tone: "muted" };
}

export default function SettingsDrawer({ account, onClose }) {
  const form = useSettingsForm(account);
  const { actions, step, errors } = form;
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const stepHeadingRef = useRef(null);
  const errorRef = useRef(null);
  const submitErrorRef = useRef(null);
  const doneRef = useRef(null);
  const firstStepRender = useRef(true);

  const close = () => {
    actions.flushAll(); // save anything still waiting for the typing pause
    onClose();
  };

  // While open: remember who opened it, lock the page behind it, and give focus back on close.
  useEffect(() => {
    const opener = document.activeElement;
    const page = document.getElementById("app-root");
    page?.setAttribute("inert", "");
    document.body.style.overflow = "hidden";
    titleRef.current?.focus();
    return () => {
      page?.removeAttribute("inert");
      document.body.style.overflow = "";
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, []);

  // Moving to another step puts focus on its heading, so screen-reader and keyboard users know where they are.
  useEffect(() => {
    if (firstStepRender.current) {
      firstStepRender.current = false;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);

  // Explicit actions that fail (Continue, Try again) move focus to the error. Autosaves never do.
  useEffect(() => {
    if (form.focusErrorToken > 0) errorRef.current?.focus();
  }, [form.focusErrorToken]);

  useEffect(() => {
    if (form.submit.status === "error") submitErrorRef.current?.focus();
    if (form.submit.status === "done") doneRef.current?.focus();
  }, [form.submit.status]);

  useEffect(() => {
    if (form.load.status === "error") errorRef.current?.focus();
  }, [form.load.status]);

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    // Keep Tab inside the dialog.
    const items = [...dialogRef.current.querySelectorAll(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const stepErrors = errors[step];
  const fieldValues = form.draft[step];
  // The server rejected a field the form shows as filled in. Explain it instead of leaving it a mystery.
  const serverDisagrees =
    stepErrors && Object.keys(stepErrors.fields).some((field) => String(fieldValues[field] ?? "").trim() !== "");
  const isLastStep = step === STEPS.length;
  const saving = form.status[step] === "saving";
  const submitting = form.submit.status === "submitting";
  const stepStatus = stepState(form, step);

  let body;
  if (form.load.status === "loading") {
    body = <p role="status" className="p-5 muted">Loading saved settings…</p>;
  } else if (form.load.status === "error") {
    body = (
      <div ref={errorRef} tabIndex={-1} role="alert" className="m-5 alert-error">
        <p className="font-medium">Couldn't load the saved settings.</p>
        <p className="mt-1">{form.load.error}</p>
        <p className="mt-1">Nothing has been changed. Try again before editing, so saved values aren't overwritten.</p>
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-primary" onClick={actions.retryLoad}>Try again</button>
          <button type="button" className="btn" onClick={close}>Close</button>
        </div>
      </div>
    );
  } else if (form.submit.status === "done") {
    body = (
      <div className="p-5">
        <h3 ref={doneRef} tabIndex={-1} className="text-base font-semibold">Settings submitted</h3>
        <p className="mt-1 muted">All four steps were saved and submitted for {account.name}.</p>
        <button type="button" className="btn-primary mt-4" onClick={close}>Done</button>
      </div>
    );
  } else {
    body = (
      <form
        noValidate
        className="flex flex-col flex-1 min-h-0"
        onSubmit={(event) => {
          event.preventDefault();
          if (isLastStep) actions.submitForm();
          else actions.continueToNext();
        }}
      >
        <nav aria-label="Settings steps" className="px-4 pt-4 sm:px-5">
          <ol className="grid grid-cols-4 gap-1">
            {STEPS.map(({ number, title }) => {
              const state = stepState(form, number);
              return (
                <li key={number}>
                  <button
                    type="button"
                    onClick={() => actions.goToStep(number)}
                    aria-current={number === step ? "step" : undefined}
                    className={`step-tab ${number === step ? "step-tab-active" : ""}`}
                  >
                    <span className="font-medium">{number}. {title}</span>
                    <span className={`block text-xs tone-${state.tone}`}>{state.label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 space-y-4">
          <h3 ref={stepHeadingRef} tabIndex={-1} className="text-base font-semibold">
            Step {step} of {STEPS.length}: {STEPS[step - 1].title}
          </h3>

          {stepErrors && (
            <div ref={errorRef} tabIndex={-1} role="alert" className="alert-error">
              <p className="font-medium">
                {Object.keys(stepErrors.fields).length > 0 && !stepErrors.message
                  ? "Fix the highlighted fields to save this step."
                  : "This step couldn't be saved."}
              </p>
              {stepErrors.message && <p className="mt-1">{stepErrors.message}</p>}
              {serverDisagrees && (
                <p className="mt-1">
                  The server rejected a value that looks valid. Your entries are still here and your other steps
                  are saved. You can try again, restore the last saved values, or continue without saving this step.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {stepErrors.message && (
                  <button type="button" className="btn" onClick={() => actions.saveStep(step)}>Try saving again</button>
                )}
                {form.saved[step] && (
                  <button type="button" className="btn" onClick={() => actions.revertStep(step)}>Restore last saved values</button>
                )}
              </div>
            </div>
          )}

          <StepFields step={step} values={fieldValues} errors={stepErrors?.fields ?? {}} onChange={actions.setField} />

          {form.submit.status === "error" && (
            <div ref={submitErrorRef} tabIndex={-1} role="alert" className="alert-error">
              <p className="font-medium">Couldn't submit yet.</p>
              <p className="mt-1">{form.submit.message}</p>
              {form.submit.missing.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {form.submit.missing.map((n) => (
                    <button key={n} type="button" className="btn" onClick={() => actions.goToStep(n)}>
                      Go to step {n}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="border-t border-slate-200 px-4 py-3 sm:px-5">
          <p role="status" aria-live="polite" className={`text-xs mb-2 tone-${stepStatus.tone}`}>
            {saving ? "Saving…" : form.status[step] === "saved" && !form.dirty[step] ? "All changes saved" : stepStatus.label}
          </p>
          <div className="flex flex-wrap gap-2 justify-between">
            <button type="button" className="btn" disabled={step === 1} onClick={() => actions.goToStep(step - 1)}>Back</button>
            <div className="flex flex-wrap gap-2 justify-end">
              {!isLastStep && stepErrors && (
                <button type="button" className="btn" onClick={actions.continueWithoutSaving}>Continue without saving</button>
              )}
              <button type="submit" className="btn-primary" disabled={saving || submitting}>
                {isLastStep ? (submitting ? "Submitting…" : "Submit settings") : "Save and continue"}
              </button>
            </div>
          </div>
        </footer>
      </form>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-20 flex justify-end bg-slate-900/40"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="flex h-full w-full max-w-xl flex-col bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 id="settings-title" ref={titleRef} tabIndex={-1} className="text-lg font-semibold">Account settings</h2>
            <p className="truncate text-sm muted">{account.name} · ID {account.id}</p>
          </div>
          <button type="button" className="btn" onClick={close} aria-label="Close settings">Close</button>
        </header>
        {body}
      </aside>
    </div>,
    document.body
  );
}
