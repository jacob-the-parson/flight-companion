// FooterPilot — the left drawer's permanent bottom row:
// [ initial + PopMenu ] [ pilot name + role ] [ theme switcher ]
// There are no accounts: the pilot is a name kept in this browser, written
// onto checklist runs. The initial opens PopMenu (up) -> Profile (ModalProfile).
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Moon, Settings, Sun, User } from 'lucide-react';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useThemeStore } from '@/stores/core/themeStore';
import { PopMenu } from '@/components/ui/PopMenu';
import { ModalProfile } from './ModalProfile';

export function FooterPilot() {
  const pilotName = usePrefsStore((s) => s.pilotName);
  const pilotRole = usePrefsStore((s) => s.pilotRole);
  const isDark = useThemeStore((s) => s.isDark);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const [profileOpen, setProfileOpen] = useState(false);

  const item =
    'flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink transition-colors hover:bg-surface-sunken';

  return (
    <div className="grid h-14 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-t border-edge px-3">
      {/* col 1 — initial, the PopMenu trigger */}
      <PopMenu
        direction="up"
        trigger={
          <button
            aria-label="Pilot menu"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary-high text-sm font-semibold text-secondary-shadow transition-transform hover:scale-105"
          >
            {pilotName.charAt(0).toUpperCase() || 'P'}
          </button>
        }
      >
        <button className={item} onClick={() => setProfileOpen(true)}>
          <User size={13} /> Pilot profile
        </button>
        <Link href="/settings" className={item}>
          <Settings size={13} /> Settings
        </Link>
      </PopMenu>

      {/* col 2 — name + role */}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-xs font-medium text-ink">{pilotName || 'Pilot'}</span>
        <span className="truncate text-[10px] text-ink-muted">{pilotRole || 'No role set'}</span>
      </div>

      {/* col 3 — light/dark switcher */}
      <button
        onClick={toggleTheme}
        aria-label="Toggle theme"
        className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        {isDark ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      <ModalProfile isOpen={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
