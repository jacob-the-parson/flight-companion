// ModalAircraft — edit the active aircraft profile. These numbers feed the
// planner's endurance check, so the form says where each one should come from.
'use client';
import { enduranceMinutes, useActiveAircraft, useAircraftStore } from '@/stores/core/aircraftStore';
import { ModalBase } from '@/components/ui/ModalBase';
import { DrawerField } from '@/components/ui/DrawerSection';
import { INPUT_CLASS } from '@/components/shell/ModalProfile';
import { fmtNum } from '@/lib/units';

interface ModalAircraftProps {
  isOpen: boolean;
  onClose: () => void;
}

function num(v: string, fallback: number, min = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

export function ModalAircraft({ isOpen, onClose }: ModalAircraftProps) {
  const aircraft = useActiveAircraft();
  const updateProfile = useAircraftStore((s) => s.updateProfile);
  const set = (patch: Parameters<typeof updateProfile>[1]) => updateProfile(aircraft.id, patch);

  return (
    <ModalBase isOpen={isOpen} onClose={onClose} title="Aircraft" maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <DrawerField label="Name">
            <input value={aircraft.name} onChange={(e) => set({ name: e.target.value })} className={INPUT_CLASS} />
          </DrawerField>
          <DrawerField label="Autopilot">
            <input
              value={aircraft.autopilot}
              onChange={(e) => set({ autopilot: e.target.value })}
              className={INPUT_CLASS}
            />
          </DrawerField>
        </div>
        <DrawerField label="Frame">
          <input value={aircraft.frame} onChange={(e) => set({ frame: e.target.value })} className={INPUT_CLASS} />
        </DrawerField>
        <DrawerField label="Firmware (sets the plan file's firmware type)">
          <select
            value={aircraft.firmware}
            onChange={(e) => set({ firmware: e.target.value as 'px4' | 'ardupilot' })}
            className={INPUT_CLASS}
          >
            <option value="px4">PX4</option>
            <option value="ardupilot">ArduPilot</option>
          </select>
        </DrawerField>

        <div className="grid gap-4 sm:grid-cols-3">
          <DrawerField label="Cells (S)">
            <input
              type="number"
              min={1}
              max={14}
              value={aircraft.cells}
              onChange={(e) => set({ cells: Math.round(num(e.target.value, aircraft.cells, 1)) })}
              className={INPUT_CLASS}
            />
          </DrawerField>
          <DrawerField label="Capacity (mAh)">
            <input
              type="number"
              min={100}
              step={100}
              value={aircraft.capacityMah}
              onChange={(e) => set({ capacityMah: num(e.target.value, aircraft.capacityMah, 100) })}
              className={INPUT_CLASS}
            />
          </DrawerField>
          <DrawerField label="Hover current (A)">
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={aircraft.hoverCurrentA}
              onChange={(e) => set({ hoverCurrentA: num(e.target.value, aircraft.hoverCurrentA, 0.5) })}
              className={INPUT_CLASS}
            />
          </DrawerField>
          <DrawerField label="Reserve (%)">
            <input
              type="number"
              min={0}
              max={90}
              step={5}
              value={Math.round(aircraft.reserve * 100)}
              onChange={(e) => set({ reserve: Math.min(0.9, num(e.target.value, 30) / 100) })}
              className={INPUT_CLASS}
            />
          </DrawerField>
          <DrawerField label="Cruise (m/s)">
            <input
              type="number"
              min={0.5}
              step={0.5}
              value={aircraft.cruiseSpeedMs}
              onChange={(e) => set({ cruiseSpeedMs: num(e.target.value, aircraft.cruiseSpeedMs, 0.5) })}
              className={INPUT_CLASS}
            />
          </DrawerField>
        </div>

        <DrawerField label="Notes">
          <textarea
            value={aircraft.notes}
            onChange={(e) => set({ notes: e.target.value })}
            rows={3}
            className={INPUT_CLASS}
          />
        </DrawerField>

        <div className="rounded-lg border border-edge bg-control/60 p-3 text-xs text-ink-muted">
          <p>
            Planning endurance:{' '}
            <span className="font-mono text-ink">{fmtNum(enduranceMinutes(aircraft), 1)} min</span>. That
            is capacity less reserve, drawn at hover current.
          </p>
          <p className="mt-1">
            Read cells and capacity off the pack label. Take hover current from a hover in the log
            viewer, not from a guess. Set the reserve at or above the battery return threshold on the
            aircraft.
          </p>
        </div>

        <button
          onClick={onClose}
          className="w-full rounded-md bg-secondary py-2 text-sm font-medium text-white transition-colors hover:bg-secondary-shadow"
        >
          Done
        </button>
      </div>
    </ModalBase>
  );
}
