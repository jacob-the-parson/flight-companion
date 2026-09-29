// SegmentedTrack — the one segmented switch: a `track` fill with a raised
// active chip. Used for every "pick one of a few" control in a workspace header
// (checklist phase, survey type, log view). Spec: SegmentedTrack.md
'use client';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export interface SegmentOption<T extends string> {
  id: T;
  label: string;
  /** Shorter label used below the `sm` breakpoint. */
  short?: string;
  icon?: LucideIcon;
  /** Small trailing marker: a count, a tick, a warning dot. */
  trailing?: ReactNode;
  title?: string;
}

interface SegmentedTrackProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
}

export function SegmentedTrack<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  size = 'md',
}: SegmentedTrackProps<T>) {
  const pad = size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs';
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex max-w-full gap-1 overflow-x-auto rounded-md border border-edge-strong/15 bg-track p-1 dark:border-edge"
    >
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            role="tab"
            aria-selected={active}
            title={o.title ?? o.label}
            onClick={() => onChange(o.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded font-medium transition-colors ${pad} ${
              active ? 'bg-surface-raised text-ink shadow-sm' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {o.icon ? <o.icon size={13} /> : null}
            <span className={o.short ? 'hidden sm:inline' : ''}>{o.label}</span>
            {o.short ? <span className="sm:hidden">{o.short}</span> : null}
            {o.trailing}
          </button>
        );
      })}
    </div>
  );
}
