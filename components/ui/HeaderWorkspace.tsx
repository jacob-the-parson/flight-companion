// HeaderWorkspace — the workspace's own header, the single-surface archetype:
//   [ identity ]   [ center: the segmented switch ]   [ actions ]
// It measures ITSELF, not the screen: the workspace island gets wider and
// narrower as the drawers spring open and shut, so the three columns fold to
// two rows by a container query. Spec: HeaderWorkspace.md
'use client';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface HeaderWorkspaceProps {
  icon: LucideIcon;
  /** Tailwind text colour classes for the icon: the domain's accent. */
  iconClass: string;
  title: string;
  subtitle?: string;
  center?: ReactNode;
  actions?: ReactNode;
  /** How much room the three columns need before they sit on one row. */
  fit?: 'normal' | 'wide';
}

// written out in full so the class scanner sees every name
const LAYOUT = {
  normal: {
    grid: '@3xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
    center: '@3xl:col-span-1 @3xl:col-start-2 @3xl:row-start-1 @3xl:justify-self-center',
    actions: '@3xl:col-start-3',
  },
  wide: {
    grid: '@5xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]',
    center: '@5xl:col-span-1 @5xl:col-start-2 @5xl:row-start-1 @5xl:justify-self-center',
    actions: '@5xl:col-start-3',
  },
} as const;

export function HeaderWorkspace({
  icon: Icon,
  iconClass,
  title,
  subtitle,
  center,
  actions,
  fit = 'normal',
}: HeaderWorkspaceProps) {
  const L = LAYOUT[fit];
  return (
    <div className="@container shrink-0 border-b border-edge print:hidden">
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-4 py-2 ${L.grid}`}>
        <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
          <Icon size={16} className={`shrink-0 ${iconClass}`} />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-ink" title={title}>
              {title}
            </h1>
            {subtitle && (
              <p className="truncate text-[11px] text-ink-muted" title={subtitle}>
                {subtitle}
              </p>
            )}
          </div>
        </div>

        {actions && (
          <div className={`col-start-2 row-start-1 flex min-w-0 items-center justify-end gap-1.5 justify-self-end ${L.actions}`}>
            {actions}
          </div>
        )}

        {center && (
          <div className={`col-span-2 row-start-2 min-w-0 max-w-full justify-self-start ${L.center}`}>
            {center}
          </div>
        )}
      </div>
    </div>
  );
}
