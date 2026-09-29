// AircraftDock — cross-domain chrome, present in every domain's left drawer:
// the aircraft being flown. A bar (name + endurance) that springs open to the
// profile picker and the numbers the other domains read: cells, capacity, hover
// current, reserve, cruise speed. Editing lives in ModalAircraft.
'use client';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronUp, Pencil, Plane, Plus, Trash2 } from 'lucide-react';
import {
  enduranceMinutes,
  useActiveAircraft,
  useAircraftStore,
} from '@/stores/core/aircraftStore';
import { DrawerStat } from '@/components/ui/DrawerSection';
import { fmtNum } from '@/lib/units';
import { ModalAircraft } from './ModalAircraft';

const SPRING = { type: 'spring', bounce: 0.2, duration: 0.5 } as const;

export function AircraftDock() {
  const profiles = useAircraftStore((s) => s.profiles);
  const activeId = useAircraftStore((s) => s.activeId);
  const setActive = useAircraftStore((s) => s.setActive);
  const addProfile = useAircraftStore((s) => s.addProfile);
  const removeProfile = useAircraftStore((s) => s.removeProfile);
  const aircraft = useActiveAircraft();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  return (
    <div className="shrink-0 border-t border-edge">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex h-11 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-surface-sunken"
        aria-expanded={open}
      >
        <Plane size={14} className="shrink-0 text-secondary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-ink">{aircraft.name}</span>
          <span className="block truncate text-[10px] text-ink-muted">
            {aircraft.cells}S {fmtNum(aircraft.capacityMah, 0)} mAh · about{' '}
            {fmtNum(enduranceMinutes(aircraft), 0)} min
          </span>
        </span>
        <ChevronUp
          size={14}
          className={`shrink-0 text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={SPRING}
            className="overflow-hidden"
          >
            <div className="max-h-[40dvh] space-y-3 overflow-y-auto border-t border-edge p-3">
              <div className="space-y-1">
                {profiles.map((p) => (
                  <div key={p.id} className="group relative">
                    <button
                      onClick={() => setActive(p.id)}
                      className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 pr-8 text-left text-xs transition-colors ${
                        p.id === activeId
                          ? 'border-secondary bg-secondary-high/20 text-ink'
                          : 'border-edge bg-surface-raised/60 text-ink-muted hover:text-ink'
                      }`}
                    >
                      <Plane size={12} />
                      <span className="truncate">{p.name}</span>
                    </button>
                    {profiles.length > 1 && (
                      <button
                        onClick={() => removeProfile(p.id)}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                        title="Remove aircraft"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  onClick={() => {
                    addProfile();
                    setEditing(true);
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-edge p-1.5 text-xs text-ink-muted transition-colors hover:border-edge-strong/50 hover:text-ink"
                >
                  <Plus size={12} /> Add aircraft
                </button>
              </div>

              <div className="space-y-1.5">
                <DrawerStat label="Frame" value={aircraft.frame} />
                <DrawerStat label="Autopilot" value={aircraft.autopilot} />
                <DrawerStat label="Hover current" value={`${fmtNum(aircraft.hoverCurrentA, 1)} A`} />
                <DrawerStat label="Reserve" value={`${fmtNum(aircraft.reserve * 100, 0)} %`} />
                <DrawerStat label="Cruise" value={`${fmtNum(aircraft.cruiseSpeedMs, 1)} m/s`} />
              </div>

              <button
                onClick={() => setEditing(true)}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-edge bg-control py-1.5 text-xs text-ink transition-colors hover:bg-surface-sunken"
              >
                <Pencil size={12} /> Edit aircraft
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ModalAircraft isOpen={editing} onClose={() => setEditing(false)} />
    </div>
  );
}
