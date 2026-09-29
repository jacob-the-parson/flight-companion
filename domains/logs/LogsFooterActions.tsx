// LogsFooterActions — THE FOOTER SHAPE (all domains):
//   [ domain status ] [ domain action ] [ CENTER reserved ] [ Close (red) ] [ Report (green) ]
// Status = the time under the chart cursor and the flight mode at that time.
'use client';
import { Clock, FileText, Maximize2, Trash2 } from 'lucide-react';
import { KeycapAction } from '@/components/ui/KeycapAction';
import type { FlightSummary } from '@/lib/ulog/analysis';
import { downloadFile, fmtClock, fmtDuration, fmtNum } from '@/lib/units';
import { useActiveLog, useActiveSummary, useLogsStore } from '@/stores/domains/logsStore';

export function LogsCursorStatus() {
  const summary = useActiveSummary();
  const cursorT = useLogsStore((s) => s.cursorT);
  if (!summary) {
    return (
      <div className="flex h-full w-full items-center justify-center opacity-60">
        <span className="font-medium uppercase tracking-wide">No log</span>
      </div>
    );
  }
  const mode = cursorT !== null ? summary.modes.find((m) => cursorT >= m.start && cursorT <= m.end) : undefined;
  return (
    <div
      className="flex h-full w-full items-center justify-center gap-1.5 text-ink"
      title={cursorT !== null ? 'Time under the pointer, and the flight mode then' : 'Length of the log'}
    >
      <Clock size={13} className="text-violet-600 dark:text-violet-400" />
      <span className="truncate font-medium uppercase tracking-wide">
        {cursorT !== null
          ? `${fmtClock(cursorT)}${mode ? ` ${mode.name}` : ''}`
          : fmtDuration(summary.duration)}
      </span>
    </div>
  );
}

export function LogsWholeAction() {
  const zoomed = useLogsStore((s) => s.xRange !== null);
  const setXRange = useLogsStore((s) => s.setXRange);
  return (
    <button
      onClick={() => setXRange(null)}
      disabled={!zoomed}
      className={`group flex h-full w-full items-center justify-center gap-1.5 outline-none transition-colors ${
        zoomed
          ? 'cursor-pointer hover:bg-control hover:text-violet-600 dark:hover:text-violet-400'
          : 'cursor-not-allowed opacity-40'
      }`}
      title={zoomed ? 'Show the whole log again' : 'The whole log is already shown'}
    >
      <Maximize2 size={13} className={zoomed ? 'transition-transform group-hover:-translate-y-0.5' : ''} />
      <span className="font-medium uppercase tracking-wide">Whole log</span>
    </button>
  );
}

export function LogsCloseAction() {
  const activeId = useLogsStore((s) => s.activeId);
  const remove = useLogsStore((s) => s.remove);
  return (
    <KeycapAction
      icon={Trash2}
      label="Close"
      tone="red"
      disabled={!activeId}
      title="Close this log. The file on disk is not touched."
      onClick={() => activeId && remove(activeId)}
    />
  );
}

/** The flight as plain text, for pasting into a build log. */
export function reportText(name: string, s: FlightSummary): string {
  const n = (v: number | null, d = 1, unit = '') => (v === null ? 'n/a' : `${fmtNum(v, d)}${unit}`);
  const lines: string[] = [];
  lines.push(`Flight log: ${name}`);
  if (s.startUtcMs !== null) lines.push(`Logging started: ${new Date(s.startUtcMs).toISOString()} (UTC)`);
  lines.push(`Firmware: ${s.system.firmware}   Board: ${s.system.hardware}   Airframe: ${s.system.airframeId ?? 'n/a'}`);
  lines.push(`Log length: ${fmtDuration(s.duration)}   In the air: ${fmtDuration(s.stats.airborneS)}`);
  lines.push(`Modes: ${[...new Set(s.modes.map((m) => m.name))].join(', ') || 'n/a'}`);
  lines.push('');
  lines.push('Numbers');
  lines.push(`  Highest above takeoff    ${n(s.stats.maxAltM, 1, ' m')}`);
  lines.push(`  Fastest over the ground  ${n(s.stats.maxSpeedMs, 1, ' m/s')}`);
  lines.push(`  Most roll / pitch        ${n(s.stats.maxRollDeg, 0, ' deg')} / ${n(s.stats.maxPitchDeg, 0, ' deg')}`);
  lines.push(`  Battery start / lowest   ${n(s.stats.battStartV, 2, ' V')} / ${n(s.stats.battMinV, 2, ' V')}`);
  lines.push(`  Current highest / mean   ${n(s.stats.maxCurrentA, 1, ' A')} / ${n(s.stats.meanAirCurrentA, 1, ' A')}`);
  lines.push(`  Charge used              ${n(s.stats.usedMah, 0, ' mAh')}`);
  if (s.stats.motorMeansUs) {
    lines.push(`  Motor means in the air   ${s.stats.motorMeansUs.map((v) => fmtNum(v, 0)).join(' / ')} us`);
  }
  lines.push('');
  lines.push('Findings');
  for (const f of s.findings) {
    lines.push(`  [${f.level.toUpperCase()}] ${f.title}`);
    lines.push(`      ${f.detail}`);
    for (const [k, v] of f.facts ?? []) lines.push(`      ${k}: ${v}`);
  }
  lines.push('');
  lines.push('Messages from the aircraft');
  for (const e of s.events) if (e.kind === 'message') lines.push(`  ${fmtClock(Math.max(0, e.t)).padStart(8)}  ${e.text}`);
  return lines.join('\n') + '\n';
}

export function LogsReportAction() {
  const log = useActiveLog();
  const summary = log?.summary;
  return (
    <KeycapAction
      icon={FileText}
      label="Report"
      tone="green"
      disabled={!log || !summary}
      title="Download the numbers and findings as text, for the build log"
      onClick={() => {
        if (log && summary) {
          downloadFile(`${log.name.replace(/\.ulg$/i, '')}-report.txt`, reportText(log.name, summary));
        }
      }}
    />
  );
}
