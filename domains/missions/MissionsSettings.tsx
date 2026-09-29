// MissionsSettings — settings sub-area body: what is read and written, where
// each format's definition came from, and what has and has not been checked.
'use client';
import { Waypoints } from 'lucide-react';
import { FORMATS } from '@/lib/mission/formats';
import { MISSION_LIMITS } from '@/lib/mission/checks';
import { useMissionsStore } from '@/stores/domains/missionsStore';
import { ACCENT } from './MissionsParts';

export function MissionsSettings() {
  const saved = useMissionsStore((s) => s.saved.length);

  return (
    <div className="flex items-start gap-4">
      <div className={`rounded-full p-3 ${ACCENT.chip}`}>
        <Waypoints size={24} />
      </div>
      <div className="min-w-0 flex-1 space-y-3 text-sm text-ink-muted">
        <h3 className="text-lg font-medium text-ink">Missions</h3>
        <p>
          {saved} saved mission{saved === 1 ? '' : 's'} in this browser. Files you open are read on this
          computer and are not uploaded anywhere.
        </p>

        <div className="overflow-x-auto rounded-lg border border-edge">
          <table className="w-full min-w-[520px] border-separate border-spacing-0 text-xs">
            <caption className="sr-only">Formats, and where each definition was taken from</caption>
            <thead>
              <tr className="bg-control/60 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                <th className="border-b border-edge px-3 py-2">Format</th>
                <th className="border-b border-edge px-3 py-2">File</th>
                <th className="border-b border-edge px-3 py-2">Definition taken from</th>
              </tr>
            </thead>
            <tbody>
              {FORMATS.map((f) => (
                <tr key={f.id}>
                  <td className="border-b border-edge px-3 py-1.5 font-medium text-ink">{f.label}</td>
                  <td className="border-b border-edge px-3 py-1.5 font-mono text-ink">{f.extensions.map((e) => `.${e}`).join(' ')}</td>
                  <td className="border-b border-edge px-3 py-1.5">{f.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="pt-1 text-xs font-bold uppercase tracking-wider text-ink">What has been checked</h4>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            Reading: files from QGroundControl&apos;s and ArduPilot&apos;s own test suites, and the samples in
            DJI&apos;s specification, are read and compared number by number.
          </li>
          <li>
            Writing: Garmin, GPX and KML files pass the schemas their owners publish. A waypoint list read from
            ArduPilot&apos;s tests and written back is the same in every number of every row.
          </li>
          <li>DJI publishes no schema. DJI routes are written in the element order of DJI&apos;s samples.</li>
        </ul>

        <h4 className="pt-1 text-xs font-bold uppercase tracking-wider text-ink">What has not</h4>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>No file written by this app has been opened in DJI Pilot 2 or on a Garmin device.</li>
          <li>No file written by this app has been flown. Open it in the ground station and look at it there first.</li>
        </ul>

        <p>
          The checks use {MISSION_LIMITS.ceilingM} m (400 ft) as the ceiling, flag a leg longer than{' '}
          {MISSION_LIMITS.longLegM / 1000} km and a point farther than {MISSION_LIMITS.farM} m from takeoff. The
          ceiling is the limit for recreational and Part 107 flights in the United States. The other two are
          this app&apos;s own rules of thumb.
        </p>
        <p>
          Missions reads and writes files. It never connects to an aircraft. A mission reaches one only when a
          person uploads it from a ground station.
        </p>
      </div>
    </div>
  );
}
