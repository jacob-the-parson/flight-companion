// DrawerSection — the Right-Drawer Shell section primitives, extracted as one
// component family instead of per-page copies. Three section types:
//   DrawerField  — uppercase muted label + any input(s)
//   DrawerListRow — selectable row with hover-revealed actions
//   DrawerStat   — label left, mono value right
// Compose them inside DrawerSection blocks within any drawer page.
'use client';
import type { ReactNode } from 'react';

interface DrawerSectionProps {
  title: string;
  children: ReactNode;
  /** First section in a page skips the divider. */
  first?: boolean;
}

export function DrawerSection({ title, children, first }: DrawerSectionProps) {
  return (
    <section className={`space-y-3 ${first ? '' : 'border-t border-edge pt-6'}`}>
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

export function DrawerField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="block text-xs font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

interface DrawerListRowProps {
  label: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  onClick?: () => void;
  /** Always-visible right-side content (status text, counts, …). */
  trailing?: ReactNode;
  /** Revealed on row hover (visibility toggles, delete, …). */
  actions?: ReactNode;
}

export function DrawerListRow({ label, icon, active, onClick, trailing, actions }: DrawerListRowProps) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors ${
          active
            ? 'border-secondary bg-secondary-high/20 text-ink'
            : 'border-edge bg-surface-raised/60 text-ink-muted hover:text-ink'
        } ${actions ? 'pr-14' : ''}`}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {trailing}
      </button>
      {actions && (
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}

export function DrawerStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs text-ink-muted">
      <span>{label}</span>
      <span className="font-mono text-ink">{value}</span>
    </div>
  );
}
