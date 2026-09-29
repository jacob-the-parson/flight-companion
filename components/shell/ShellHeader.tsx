// ShellHeader — the RIGHT-COLUMN header, itself an island. THREE COLUMNS:
//   [ LEFT: left-drawer toggle ] [ MID: breadcrumb ] [ RIGHT: right-drawer toggle ]
// The breadcrumb is centered on the WORKSPACE island's center line, not the
// screen: it lives in-header (so it follows the left unit's animated width for
// free) and springs left by half the right drawer's footprint when that drawer
// opens. Crumb = House pill (highlighted on /dashboard, quick-click home from
// any domain; icon-only below sm) · '>' + domain crumb when off-dashboard.
'use client';
import { motion } from 'motion/react';
import Link from 'next/link';
import { GraduationCap, House, PanelLeft, PanelLeftClose, PanelRight, PanelRightClose } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';
import { BadgeCategory } from '@/components/ui/BadgeCategory';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useShellStore } from '@/stores/core/shellStore';

const SPRING = { type: 'spring', bounce: 0.2, duration: 0.5 } as const;
const RIGHT_W = 288; // keep in sync with Shell.tsx
const GAP = 12; // the drawer island's mr-3

export function ShellHeader({ app }: { app: AppDefinition }) {
  const tier = useShellStore((s) => s.tier);
  const leftOpen = useShellStore((s) => s.leftOpen);
  const rightOpen = useShellStore((s) => s.rightOpen);
  const toggleDrawer = useShellStore((s) => s.toggleDrawer);
  const learn = usePrefsStore((s) => s.learn);
  const setLearn = usePrefsStore((s) => s.setLearn);
  const compact = tier === 'compact';
  const onDashboard = app.id === 'dashboard';

  // workspace center vs header center: shifted left by half the right drawer
  // footprint when it's open in-flow (compact drawers overlay — no shift)
  const crumbShift = rightOpen && !compact ? -(RIGHT_W + GAP) / 2 : 0;
  const drawerBtn =
    'rounded p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink';

  return (
    <header className="relative z-40 mx-3 mt-3 grid h-12 shrink-0 grid-cols-[1fr_auto_1fr] items-center rounded-xl border border-edge bg-surface-raised/85 px-3 shadow-vibe print:hidden">
      {/* LEFT column — left drawer toggle */}
      <div className="flex items-center gap-2 justify-self-start">
        <button
          onClick={() => toggleDrawer('left')}
          className={drawerBtn}
          aria-label={leftOpen ? 'Close left drawer' : 'Open left drawer'}
          aria-pressed={leftOpen}
          title={leftOpen ? 'Close left drawer' : 'Open left drawer'}
        >
          {leftOpen ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
        </button>
        {compact && (
          <span className="flex h-6 w-6 rotate-12 items-center justify-center rounded bg-secondary">
            <span className="-rotate-12 text-[9px] font-bold text-white">FC</span>
          </span>
        )}
      </div>

      {/* MID column holds the grid open; the crumb itself floats on the center line */}
      <div aria-hidden className="h-full" />

      {/* RIGHT column — Learn mode, then the right drawer toggle */}
      <div className="flex items-center gap-2 justify-self-end">
        <button
          onClick={() => setLearn(!learn)}
          className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
            learn ? 'bg-secondary/15 text-secondary' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
          }`}
          aria-pressed={learn}
          title={learn ? 'Learn mode is on: examples and explanations are shown. Click to hide them.' : 'Learn mode is off. Click to show examples and explanations.'}
        >
          <GraduationCap size={16} />
          <span className="hidden sm:inline">Learn</span>
        </button>
        <button
          onClick={() => toggleDrawer('right')}
          className={drawerBtn}
          aria-label={rightOpen ? 'Close right drawer' : 'Open right drawer'}
          aria-pressed={rightOpen}
          title={rightOpen ? 'Close tools' : 'Open tools'}
        >
          {rightOpen ? <PanelRightClose size={18} /> : <PanelRight size={18} />}
        </button>
      </div>

      {/* breadcrumb — rides the workspace island's center line */}
      <motion.div
        animate={{ x: crumbShift }}
        transition={SPRING}
        className="pointer-events-none absolute inset-y-0 left-1/2 flex items-center"
      >
        <div className="pointer-events-auto flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap text-xs text-ink-muted">
          <Link
            href="/dashboard"
            title="Dashboard"
            className={`flex items-center justify-center rounded-lg px-2 py-1.5 transition-all duration-200 sm:rounded-full sm:px-3 ${
              onDashboard
                ? 'bg-secondary/15 text-secondary'
                : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
            }`}
          >
            <House size={14} className={onDashboard ? 'fill-current' : ''} />
            <span className="ml-1.5 hidden text-[10px] font-semibold uppercase tracking-wide sm:inline">
              Dashboard
            </span>
          </Link>
          {!onDashboard && (
            <>
              <span className="select-none">&gt;</span>
              <app.icon size={14} className={app.theme.colorClass} />
              <span className="font-medium text-ink">{app.name}</span>
              {app.category && <BadgeCategory category={app.category} />}
            </>
          )}
        </div>
      </motion.div>
    </header>
  );
}
