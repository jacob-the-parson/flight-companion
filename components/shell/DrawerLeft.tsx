// DrawerLeft — the special drawer, SEGMENTED real estate:
//   [ header chunk ] [ domain pager ] [ favorites (always present, capped+scroll) ]
//   [ PER-DOMAIN AREA — app.drawerLeftBottom, NON-pageable, flex-1 ]
//   [ AircraftDock ] [ FooterPilot ]  ← permanent global chrome in every domain.
'use client';
import { PanelLeftClose } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';
import { useShellStore } from '@/stores/core/shellStore';
import { DrawerNav } from './DrawerNav';
import { AircraftDock } from '@/globals/aircraft/AircraftDock';
import { FooterPilot } from './FooterPilot';

export function DrawerLeft({ app }: { app: AppDefinition }) {
  const toggleDrawer = useShellStore((s) => s.toggleDrawer);
  const DomainPanel = app.drawerLeftBottom;

  return (
    <div className="flex h-full w-64 shrink-0 flex-col">
      {/* the left unit's OWN header chunk — 3 columns, TriSlot rhythm:
          [ brand icon ] [ app name, centered ] [ collapse ] */}
      <div className="grid h-12 shrink-0 grid-cols-[auto_1fr_auto] items-center gap-2 border-b border-edge px-3">
        <button
          onClick={() => toggleDrawer('left')}
          aria-label="Collapse to rail"
          className="flex h-6 w-6 rotate-12 items-center justify-center rounded bg-secondary transition-transform hover:scale-105"
        >
          <span className="-rotate-12 text-[9px] font-bold text-white">FC</span>
        </button>
        <span className="justify-self-center truncate whitespace-nowrap text-sm font-semibold text-ink">
          Flight Companion
        </span>
        <button
          onClick={() => toggleDrawer('left')}
          className="rounded p-1 text-ink-muted transition-colors hover:bg-surface-sunken"
          aria-label="Collapse to rail"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <DrawerNav />

      {/* per-domain real estate — non-pageable, always the domain's own panel */}
      {DomainPanel ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <DomainPanel />
        </div>
      ) : (
        <div className="min-h-0 flex-1" />
      )}

      <AircraftDock />
      <FooterPilot />
    </div>
  );
}
