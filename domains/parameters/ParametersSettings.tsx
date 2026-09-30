// ParametersSettings — settings sub-area body: what is read and written, where
// the descriptions come from, and what the app will not do.
'use client';
import { SlidersHorizontal } from 'lucide-react';
import { PARAM_FORMATS } from '@/lib/params/codecs';
import { useParamsStore } from '@/stores/domains/paramsStore';
import { ACCENT } from './ParametersParts';

export function ParametersSettings() {
  const saved = useParamsStore((s) => s.saved.length);
  const reference = useParamsStore((s) => s.reference);

  return (
    <div className="flex items-start gap-4">
      <div className={`rounded-full p-3 ${ACCENT.chip}`}>
        <SlidersHorizontal size={24} />
      </div>
      <div className="min-w-0 flex-1 space-y-3 text-sm text-ink-muted">
        <h3 className="text-lg font-medium text-ink">Parameters</h3>
        <p>
          {saved} saved set{saved === 1 ? '' : 's'} in this browser. Files you open are read on this computer and are
          not uploaded anywhere.
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
              {PARAM_FORMATS.map((f) => (
                <tr key={f.id}>
                  <td className="border-b border-edge px-3 py-1.5 font-medium text-ink">{f.label}</td>
                  <td className="border-b border-edge px-3 py-1.5 font-mono text-ink">{f.extensions.map((e) => `.${e}`).join(' ')}</td>
                  <td className="border-b border-edge px-3 py-1.5">{f.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h4 className="pt-1 text-xs font-bold uppercase tracking-wider text-ink">Where the descriptions come from</h4>
        <p>
          What each parameter is, its unit, its limits and its default are PX4’s own, taken from the parameter
          reference PX4 generates from its source code for one release
          {reference ? `: ${reference.firmware}, ${reference.count} parameters. Licence: ${reference.licence}` : '.'} The
          app writes none of it. It holds no reference for ArduPilot, so it lists and compares ArduPilot parameters
          and does not describe them.
        </p>

        <h4 className="pt-1 text-xs font-bold uppercase tracking-wider text-ink">What the app will not do</h4>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Send a parameter to an aircraft. It writes a file; a person loads it in the ground station.</li>
          <li>Say what a parameter should be set to. It shows the reference’s limits and the firmware’s default.</li>
          <li>
            Turn an ArduPilot name into a PX4 name, or the other way. The two autopilots do not share names and
            there is no table between them.
          </li>
        </ul>

        <h4 className="pt-1 text-xs font-bold uppercase tracking-wider text-ink">What has been checked</h4>
        <p>
          A file saved by QGroundControl, read and written back, comes out the same byte for byte. No file written
          by this app after an edit has been loaded into an aircraft.
        </p>
      </div>
    </div>
  );
}
