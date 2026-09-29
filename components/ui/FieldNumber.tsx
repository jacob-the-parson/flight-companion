// FieldNumber — the one numeric input: label, unit, limits. It keeps what is
// being typed as text, so a field can be emptied and retyped without snapping
// back, and it only reports a value when the text is a number inside the limits.
// Spec: FieldNumber.md
'use client';
import { useId, useState } from 'react';

interface FieldNumberProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  /** One line under the field: what the number means or where it comes from. */
  hint?: string;
  disabled?: boolean;
}

function show(v: number): string {
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v * 1e6) / 1e6);
}

export function FieldNumber({ label, value, onChange, unit, min, max, step, hint, disabled }: FieldNumberProps) {
  const id = useId();
  // What is being typed, while the field has focus. With no draft the field
  // simply shows the stored value, so it follows the store without an effect.
  const [draft, setDraft] = useState<string | null>(null);
  const focused = draft !== null;
  const text = draft ?? show(value);

  const parsed = Number(text);
  const valid =
    text.trim() !== '' &&
    Number.isFinite(parsed) &&
    (min === undefined || parsed >= min) &&
    (max === undefined || parsed <= max);

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </label>
      <div
        className={`flex items-center rounded-md border bg-surface-raised transition-colors focus-within:ring-1 ${
          valid || !focused
            ? 'border-edge focus-within:border-secondary focus-within:ring-secondary'
            : 'border-status-critical focus-within:ring-status-critical'
        } ${disabled ? 'opacity-50' : ''}`}
      >
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onFocus={() => setDraft(show(value))}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            const t = e.target.value;
            setDraft(t);
            const n = Number(t);
            if (t.trim() === '' || !Number.isFinite(n)) return;
            if (min !== undefined && n < min) return;
            if (max !== undefined && n > max) return;
            onChange(n);
          }}
          className="w-full min-w-0 bg-transparent px-3 py-2 font-mono text-sm text-ink outline-none"
        />
        {unit && <span className="shrink-0 pr-3 text-xs text-ink-muted">{unit}</span>}
      </div>
      {focused && !valid && text.trim() !== '' && (
        <p className="text-[11px] text-ink-muted">
          Enter a number{min !== undefined ? ` from ${min}` : ''}
          {max !== undefined ? ` to ${max}` : ''}.
        </p>
      )}
      {hint && <p className="text-[11px] leading-snug text-ink-muted">{hint}</p>}
    </div>
  );
}
