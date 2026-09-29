// PlannerSettings — settings sub-area body: where the map comes from and what
// the time estimate assumes.
'use client';
import { Route } from 'lucide-react';
import { ASSUMPTIONS } from '@/lib/planner/survey';
import { usePlannerStore } from '@/stores/domains/plannerStore';

export function PlannerSettings() {
  const saved = usePlannerStore((s) => s.saved.length);

  return (
    <div className="flex items-start gap-4">
      <div className="rounded-full bg-sky-100 p-3 dark:bg-sky-900/40">
        <Route size={24} className="text-sky-600 dark:text-sky-400" />
      </div>
      <div className="min-w-0 flex-1 space-y-3 text-sm text-ink-muted">
        <h3 className="text-lg font-medium text-ink">Flight planner</h3>
        <p>
          {saved} saved plan{saved === 1 ? '' : 's'} in this browser.
        </p>
        <p>
          The map is OpenStreetMap. It needs the internet to show streets and fields. Without it the
          map is blank and drawing, measuring and exporting still work.
        </p>
        <p>
          Flight time assumes still air, {ASSUMPTIONS.climbMs} m/s climb, {ASSUMPTIONS.descentMs} m/s
          descent and {ASSUMPTIONS.secondsPerTurn} s for each turn. Endurance and the firmware type of
          exported files come from the aircraft profile in the left drawer.
        </p>
        <p>
          The planner writes files. It never connects to an aircraft. Open the file in your ground
          station, check it there, and upload it from there.
        </p>
      </div>
    </div>
  );
}
