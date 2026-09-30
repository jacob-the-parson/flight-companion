// LiveFooterActions — THE FOOTER SHAPE (all domains):
//   [ domain status ] [ domain action ] [ CENTER reserved ] [ Stop (red) ] [ Report (green) ]
// Status = what is heard: the mode and whether it is armed.
'use client';
import { FileText, GraduationCap, RadioTower, Square } from 'lucide-react';
import { KeycapAction } from '@/components/ui/KeycapAction';
import type { LiveView } from '@/lib/observer/view';
import { downloadFile, fmtNum } from '@/lib/units';
import { liveLine, useLiveStore, type LiveSource } from '@/stores/domains/liveStore';

export function LiveStatus() {
  const source = useLiveStore((s) => s.source);
  const view = useLiveStore((s) => s.view);
  const bound = useLiveStore((s) => s.bound);
  return (
    <div className={`flex h-full w-full items-center justify-center gap-1.5 ${source === 'off' ? 'opacity-60' : 'text-ink'}`} title="What is being heard">
      <RadioTower size={13} className="text-sky-600 dark:text-sky-400" />
      <span className="truncate font-medium uppercase tracking-wide">{liveLine(source, view, bound)}</span>
    </div>
  );
}

export function LivePracticeAction() {
  const source = useLiveStore((s) => s.source);
  const startPractice = useLiveStore((s) => s.startPractice);
  const on = source === 'practice';
  return (
    <button
      onClick={() => void startPractice()}
      disabled={on}
      className={`group flex h-full w-full items-center justify-center gap-1.5 outline-none transition-colors ${on ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-control hover:text-sky-600 dark:hover:text-sky-400'}`}
      title={on ? 'The practice flight is playing' : 'Play the practice flight: made-up data, no aircraft'}
    >
      <GraduationCap size={13} className={on ? '' : 'transition-transform group-hover:-translate-y-0.5'} />
      <span className="font-medium uppercase tracking-wide">Practice</span>
    </button>
  );
}

export function LiveStopAction() {
  const source = useLiveStore((s) => s.source);
  const stop = useLiveStore((s) => s.stop);
  return <KeycapAction icon={Square} label="Stop" tone="red" disabled={source === 'off'} title="Stop listening, or stop the practice flight. Nothing is sent to the aircraft." onClick={() => void stop()} />;
}

/** What is heard now, as plain text, for a build log. It holds no position. */
export function liveReport(source: LiveSource, v: LiveView): string {
  const n = (x: number | null | undefined, d: number, unit: string) => (x === null || x === undefined ? 'n/a' : `${fmtNum(x, d)}${unit}`);
  const lines: string[] = [];
  lines.push(source === 'practice' ? 'Live: the practice flight (made-up data, no aircraft)' : 'Live: what the aircraft reported');
  lines.push(`Written: ${new Date(v.at * 1000).toISOString()} (UTC)`);
  lines.push(`Data arriving: ${v.heard ? 'yes' : 'no'}   Last packet: ${n(v.lastPacketAgeS, 1, ' s ago')}`);
  if (v.vehicle) {
    lines.push(`Aircraft: ${v.vehicle.type}, ${v.vehicle.autopilot}, firmware ${v.firmware ?? 'not heard'}`);
    lines.push(`Mode: ${v.vehicle.mode}   ${v.vehicle.armed ? 'ARMED' : 'Disarmed'}   State: ${v.vehicle.state}`);
  }
  lines.push('');
  lines.push('Numbers');
  lines.push(`  Roll / pitch / heading   ${n(v.attitude?.rollDeg, 1, '')} / ${n(v.attitude?.pitchDeg, 1, '')} / ${n(v.attitude?.yawDeg, 1, ' deg')}`);
  lines.push(`  Height above takeoff     ${n(v.flight?.heightM, 1, ' m')}`);
  lines.push(`  Climb                    ${n(v.flight?.climbMs, 1, ' m/s')}`);
  lines.push(`  Speed over the ground    ${n(v.flight?.groundspeedMs, 1, ' m/s')}`);
  lines.push(`  Battery                  ${n(v.battery?.volts, 2, ' V')}, ${n(v.battery?.percent, 0, ' %')}, ${n(v.battery?.amps, 1, ' A')}`);
  lines.push(`  GPS                      ${v.gps ? `${v.gps.fix}, ${v.gps.satellites} satellites, HDOP ${n(v.gps.hdop, 1, '')}` : 'n/a'}`);
  lines.push(`  Parameters held          ${v.params.received}${v.params.expected !== null ? ` of ${v.params.expected}` : ''}`);
  lines.push('');
  lines.push('Sensors');
  for (const s of v.sensors) lines.push(`  ${s.name.padEnd(28)} ${!s.enabled ? 'off' : s.healthy ? 'healthy' : 'NOT HEALTHY'}`);
  lines.push('');
  lines.push('Messages from the aircraft, newest first');
  for (const m of v.messages) lines.push(`  ${n(m.ageS, 0, ' s ago').padStart(10)}  [${m.severity}] ${m.text}`);
  lines.push('');
  lines.push('Where the aircraft is, is left out of this report.');
  return lines.join('\n') + '\n';
}

export function LiveReportAction() {
  const source = useLiveStore((s) => s.source);
  const has = useLiveStore((s) => s.view?.vehicle != null);
  return (
    <KeycapAction
      icon={FileText}
      label="Report"
      tone="green"
      disabled={!has}
      title="Download what is heard now as text, for the build log. It holds no position."
      onClick={() => {
        const v = useLiveStore.getState().view;
        if (v?.vehicle) downloadFile(`live-${new Date(v.at * 1000).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`, liveReport(source, v));
      }}
    />
  );
}
