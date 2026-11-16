import { COUNTRIES, PLANS } from "../hooks/useSettingsForm";

function describedBy(id, hint, error) {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
}

function FieldShell({ id, label, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {children}
      {hint && <p id={`${id}-hint`} className="hint">{hint}</p>}
      {error && <p id={`${id}-error`} className="error-text">{error}</p>}
    </div>
  );
}

export function TextField({ id, label, value, onChange, error, hint, type = "text", ...rest }) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className="field"
        {...rest}
      />
    </FieldShell>
  );
}

export function SelectField({ id, label, value, onChange, options, error, hint }) {
  return (
    <FieldShell id={id} label={label} hint={hint} error={error}>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className="field"
      >
        <option value="">Choose…</option>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </FieldShell>
  );
}

// The fields of each settings step. `errors` maps field name to message.
export function StepFields({ step, values, errors, onChange }) {
  if (step === 1) {
    return (
      <>
        <TextField id="s-name" label="Name" value={values.name} error={errors.name} onChange={(v) => onChange("name", v)} autoComplete="off" />
        <TextField id="s-email" label="Email" type="email" value={values.email} error={errors.email} onChange={(v) => onChange("email", v)} autoComplete="off" />
      </>
    );
  }
  if (step === 2) {
    return (
      <>
        <SelectField id="s-plan" label="Plan" value={values.plan} options={PLANS} error={errors.plan} onChange={(v) => onChange("plan", v)} />
        <SelectField id="s-country" label="Billing country" value={values.billing_country} options={COUNTRIES} error={errors.billing_country} onChange={(v) => onChange("billing_country", v)} />
      </>
    );
  }
  if (step === 3) {
    return (
      <>
        <TextField id="s-minutes" label="Monthly minutes limit" type="number" min="0" inputMode="numeric" hint="Optional. Leave empty for no limit." value={values.minutes_cap} error={errors.minutes_cap} onChange={(v) => onChange("minutes_cap", v)} />
        <TextField id="s-sms" label="Monthly SMS limit" type="number" min="0" inputMode="numeric" hint="Optional. Leave empty for no limit." value={values.sms_cap} error={errors.sms_cap} onChange={(v) => onChange("sms_cap", v)} />
      </>
    );
  }
  return (
    <TextField id="s-webhook" label="Webhook URL" type="url" hint="Optional. Must start with http:// or https://." value={values.webhook_url} error={errors.webhook_url} onChange={(v) => onChange("webhook_url", v)} autoComplete="off" />
  );
}
