// StagedShell — the STAGING-LAW helpers (animator-born convention): scaffold
// domains render their planned UI disabled with "pending" tooltips + a dashed
// explainer card, so the contract ships before the wiring.
'use client';
import type { LucideIcon } from 'lucide-react';

/** Full-bleed workspace placeholder: domain identity + staged explainer. */
export function StagedWorkspace({
  icon: Icon,
  name,
  colorClass,
  note,
}: {
  icon: LucideIcon;
  name: string;
  colorClass: string;
  note: string;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 p-8">
      <Icon size={40} className={`${colorClass} opacity-60`} />
      <span className="text-lg font-semibold text-ink">{name}</span>
      <div className="max-w-sm rounded-lg border border-dashed border-edge p-3 text-center text-xs text-ink-muted">
        {note}
      </div>
    </div>
  );
}

/** Disabled footer keycap: icon + label, "pending wiring" tooltip. */
export function StagedAction({
  icon: Icon,
  label,
  pending,
}: {
  icon: LucideIcon;
  label: string;
  pending: string;
}) {
  return (
    <button
      type="button"
      disabled
      className="flex h-full w-full cursor-not-allowed items-center justify-center gap-1.5 opacity-45 outline-none"
      title={`${label} — ${pending}`}
    >
      <Icon size={13} />
      <span className="font-medium uppercase tracking-wide">{label}</span>
    </button>
  );
}

/** Settings-tab placeholder (convention: required when showInSettings). */
export function StagedSettings({ name }: { name: string }) {
  return (
    <p className="text-sm text-ink-muted">
      {name} settings arrive with the domain build-out. Nothing to configure yet.
    </p>
  );
}
