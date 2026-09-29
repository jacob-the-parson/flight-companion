// The log viewer's five views. Each is zero-prop and reads the active log from
// the store; LogsWorkspace only decides which one is mounted.
'use client';
import { useMemo, useState } from 'react';
import { Info, OctagonAlert, Search, TriangleAlert } from 'lucide-react';
import { ChartLine } from '@/components/shared/ChartLine';
import { MapView, type MapShape } from '@/components/shared/MapView';
import { levelName, type ChartData, type ChartGroup, type FlightSummary, type LogEvent } from '@/lib/ulog/analysis';
import { valueAt } from '@/lib/ulog/decimate';
import { fmtAltitude, fmtClock, fmtDistance, fmtDuration, fmtNum, fmtSpeed } from '@/lib/units';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useActiveLog, useLogsStore } from '@/stores/domains/logsStore';
import { FindingCard, ModeStrip, StatTile } from './LogsParts';

const GROUPS: ChartGroup[] = ['Flight', 'Attitude', 'Motors and control', 'Power', 'Sensors', 'Custom'];

function rangeOf(xRange: [number, number] | null, summary: FlightSummary): [number, number] {
  return xRange ?? [0, Math.max(summary.duration, 1e-3)];
}

function Chart({ chart, summary, fileStem, custom }: { chart: ChartData; summary: FlightSummary; fileStem: string; custom?: boolean }) {
  const xRange = useLogsStore((s) => s.xRange);
  const setXRange = useLogsStore((s) => s.setXRange);
  const setCursor = useLogsStore((s) => s.setCursor);
  const removeCustomChart = useLogsStore((s) => s.removeCustomChart);
  return (
    <ChartLine
      title={chart.title}
      unit={chart.unit}
      note={chart.note}
      series={chart.series}
      duration={summary.duration}
      xRange={xRange}
      onRange={setXRange}
      onCursor={setCursor}
      shaded={summary.airborne}
      fileStem={fileStem}
      onRemove={custom ? () => removeCustomChart(chart.id) : undefined}
    />
  );
}

// ---------------------------------------------------------------- overview

export function LogsOverview() {
  const log = useActiveLog();
  const units = usePrefsStore((s) => s.units);
  const xRange = useLogsStore((s) => s.xRange);
  const summary = log?.summary;
  if (!log || !summary) return null;
  const s = summary.stats;
  const cells = s.cells ?? 0;
  const perCell = (v: number | null) => (v !== null && cells > 0 ? `${fmtNum(v / cells, 2)} V per cell` : undefined);
  const pick = (id: string) => summary.charts.find((c) => c.id === id);
  const lead = [pick('altitude'), pick('motors'), pick('voltage')].filter((c): c is ChartData => !!c);
  const range = rangeOf(xRange, summary);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatTile label="In the air" value={fmtDuration(s.airborneS)} sub={`Log is ${fmtDuration(summary.duration)} long`} />
        <StatTile label="Highest" value={s.maxAltM !== null ? fmtAltitude(Math.max(0, s.maxAltM), units) : 'n/a'} sub="Above the takeoff point" />
        <StatTile label="Fastest" value={s.maxSpeedMs !== null ? fmtSpeed(s.maxSpeedMs, units) : 'n/a'} sub={s.distanceM !== null ? `${fmtDistance(s.distanceM, units)} flown` : undefined} />
        <StatTile label="Most tilt" value={s.maxRollDeg !== null && s.maxPitchDeg !== null ? `${fmtNum(Math.max(s.maxRollDeg, s.maxPitchDeg), 0)}°` : 'n/a'} sub={s.maxRollDeg !== null ? `Roll ${fmtNum(s.maxRollDeg, 0)}°, pitch ${fmtNum(s.maxPitchDeg ?? 0, 0)}°` : undefined} />
        <StatTile label="Battery at start" value={s.battStartV !== null ? `${fmtNum(s.battStartV, 2)} V` : 'n/a'} sub={perCell(s.battStartV)} />
        <StatTile label="Battery at lowest" value={s.battMinV !== null ? `${fmtNum(s.battMinV, 2)} V` : 'n/a'} sub={perCell(s.battMinV)} />
        <StatTile label="Highest current" value={s.maxCurrentA !== null ? `${fmtNum(s.maxCurrentA, 1)} A` : 'n/a'} sub={s.meanAirCurrentA !== null ? `${fmtNum(s.meanAirCurrentA, 1)} A average in the air` : undefined} />
        <StatTile label="Charge used" value={s.usedMah !== null ? `${fmtNum(s.usedMah, 0)} mAh` : 'n/a'} sub={s.satsMin !== null ? `${fmtNum(s.satsMin, 0)} to ${fmtNum(s.satsMax ?? 0, 0)} satellites` : undefined} />
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">
          What the log shows ({summary.findings.length})
        </h2>
        <div className="grid gap-3 lg:grid-cols-2">
          {summary.findings.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">At a glance</h2>
        <ModeStrip modes={summary.modes} airborne={summary.airborne} range={range} />
        {lead.map((c) => (
          <Chart key={c.id} chart={c} summary={summary} fileStem={log.name.replace(/\.ulg$/i, '')} />
        ))}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- charts

export function LogsCharts() {
  const log = useActiveLog();
  const hidden = useLogsStore((s) => s.hiddenCharts);
  const xRange = useLogsStore((s) => s.xRange);
  const summary = log?.summary;
  if (!log || !summary) return null;
  const range = rangeOf(xRange, summary);
  const all = [...summary.charts, ...(log.custom ?? [])];
  const stem = log.name.replace(/\.ulg$/i, '');
  const customIds = new Set((log.custom ?? []).map((c) => c.id));

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="sticky top-0 z-10 -mx-4 border-b border-edge bg-surface/95 px-4 py-2 sm:-mx-6 sm:px-6">
        <ModeStrip modes={summary.modes} airborne={summary.airborne} range={range} />
        <p className="mt-1 text-[11px] text-ink-muted">
          Showing {fmtClock(range[0])} to {fmtClock(range[1])}. Drag across any chart to zoom all of them.
          Double-click a chart to see the whole log.
        </p>
      </div>
      {GROUPS.map((group) => {
        const charts = all.filter((c) => c.group === group && !hidden.includes(c.id));
        if (charts.length === 0) return null;
        return (
          <section key={group} className="space-y-3">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">{group}</h2>
            {charts.map((c) => (
              <Chart key={c.id} chart={c} summary={summary} fileStem={stem} custom={customIds.has(c.id)} />
            ))}
          </section>
        );
      })}
      {all.every((c) => hidden.includes(c.id)) && (
        <p className="rounded-lg border border-dashed border-edge p-6 text-center text-sm text-ink-muted">
          Every chart is switched off. Turn some on under Plots in the tools drawer.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- map

export function LogsMap() {
  const log = useActiveLog();
  const cursorT = useLogsStore((s) => s.cursorT);
  const units = usePrefsStore((s) => s.units);
  const summary = log?.summary;
  const track = summary?.track ?? null;

  const shapes = useMemo<MapShape[]>(() => {
    if (!summary || !track) return [];
    const points = Array.from(track.lat, (lat, i) => ({ lat, lng: track.lng[i] }));
    const out: MapShape[] = [{ kind: 'polyline', id: 'track', points, color: 'series-1', weight: 3 }];
    if (summary.home) {
      out.push({ kind: 'marker', id: 'home', at: summary.home, color: 'good', label: 'H', title: 'Home position', style: 'square' });
    }
    // where the aircraft left the ground and came back to it
    for (const [i, span] of summary.airborne.entries()) {
      const at = (t: number) => ({ lat: valueAt(track.t, track.lat, t), lng: valueAt(track.t, track.lng, t) });
      const a = at(Math.max(span.start, track.t[0]));
      const b = at(Math.min(span.end, track.t[track.t.length - 1]));
      if (Number.isFinite(a.lat)) out.push({ kind: 'marker', id: `up${i}`, at: a, color: 'series-1', label: 'T', title: `Takeoff at ${fmtClock(span.start)}`, style: 'pin' });
      if (Number.isFinite(b.lat)) out.push({ kind: 'marker', id: `down${i}`, at: b, color: 'series-1', label: 'L', title: `Landing at ${fmtClock(span.end)}`, style: 'pin' });
    }
    if (cursorT !== null) {
      const lat = valueAt(track.t, track.lat, cursorT);
      const lng = valueAt(track.t, track.lng, cursorT);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        out.push({ kind: 'marker', id: 'cursor', at: { lat, lng }, color: 'series-2', title: `Position at ${fmtClock(cursorT)}`, style: 'dot', size: 14 });
      }
    }
    return out;
  }, [summary, track, cursorT]);

  if (!log || !summary) return null;
  if (!track) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-ink-muted">
        This log holds no position. The aircraft had no GPS fix while it was recording.
      </div>
    );
  }
  const alt = summary.charts.find((c) => c.id === 'altitude');

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <MapView shapes={shapes} fitKey={log.id} />
        <div className="pointer-events-none absolute left-3 top-3 z-[500] space-y-1 rounded-lg border border-edge bg-surface-raised/95 px-3 py-2 text-[11px] text-ink shadow-vibe-sm">
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-5 rounded-full bg-viz-1" /> Path flown
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-[3px] bg-status-good" /> Home (H)
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-viz-1" /> Takeoff (T), landing (L)
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-viz-2" /> Position at the chart cursor
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-6 right-3 z-[500] rounded-lg border border-edge bg-surface-raised/95 px-3 py-1.5 text-[11px] text-ink-muted shadow-vibe-sm">
          {summary.stats.distanceM !== null ? `${fmtDistance(summary.stats.distanceM, units)} flown` : 'Distance not known'}
        </div>
      </div>
      {alt && (
        <div className="shrink-0 border-t border-edge p-3">
          <Chart chart={{ ...alt, note: 'Move the pointer along this chart to move the marker on the map.' }} summary={summary} fileStem={log.name.replace(/\.ulg$/i, '')} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- events

function eventIcon(e: LogEvent) {
  if (e.kind === 'message' && e.level <= 3) return <OctagonAlert size={14} className="text-status-critical" />;
  if (e.kind === 'message' && e.level === 4) return <TriangleAlert size={14} className="text-status-warning" />;
  return <Info size={14} className="text-ink-muted" />;
}

const KIND_WORD: Record<LogEvent['kind'], string> = {
  message: 'Message',
  mode: 'Mode',
  arm: 'Arming',
  air: 'Flight',
  param: 'Parameter',
};

export function LogsEvents() {
  const log = useActiveLog();
  const focusAt = useLogsStore((s) => s.focusAt);
  const [important, setImportant] = useState(false);
  const summary = log?.summary;
  if (!log || !summary) return null;
  const rows = summary.events.filter((e) => !important || e.kind !== 'message' || e.level <= 4);

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">
          Everything that happened, in order ({rows.length})
        </h2>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} className="h-3.5 w-3.5 accent-violet-600" />
          Hide routine messages
        </label>
      </div>
      <div className="overflow-hidden rounded-xl border border-edge bg-surface-raised">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-edge text-ink-muted">
            <tr>
              <th className="w-20 px-3 py-2 font-semibold">Time</th>
              <th className="w-28 px-3 py-2 font-semibold">Kind</th>
              <th className="px-3 py-2 font-semibold">What</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={`${e.t}-${i}`} className="border-t border-edge first:border-t-0 hover:bg-control/60">
                <td className="px-3 py-1.5 align-top">
                  <button onClick={() => focusAt(e.t)} className="font-mono text-ink underline decoration-edge-strong/30 underline-offset-2 hover:decoration-edge-strong" title="Show this moment on the charts">
                    {fmtClock(Math.max(0, e.t))}
                  </button>
                </td>
                <td className="px-3 py-1.5 align-top">
                  <span className="flex items-center gap-1.5 text-ink-muted">
                    {eventIcon(e)}
                    {e.kind === 'message' ? levelName(e.level) : KIND_WORD[e.kind]}
                  </span>
                </td>
                <td className="break-words px-3 py-1.5 align-top text-ink">{e.text}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-ink-muted">
                  Nothing to show.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- parameters

const PARAM_LIMIT = 250;

export function LogsParams() {
  const log = useActiveLog();
  const [query, setQuery] = useState('');
  const [changedOnly, setChangedOnly] = useState(true);
  const summary = log?.summary;

  const rows = useMemo(() => {
    if (!summary) return [];
    const q = query.trim().toUpperCase();
    return summary.params.filter((p) => (!changedOnly || p.changed) && (q === '' || p.name.includes(q)));
  }, [summary, query, changedOnly]);

  if (!log || !summary) return null;
  const changed = summary.params.filter((p) => p.changed).length;
  const show = (v: number | null, type: string) => (v === null ? '' : type === 'int32' ? String(v) : String(Math.round(v * 1e6) / 1e6));

  return (
    <div className="mx-auto max-w-4xl space-y-3 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, for example BAT1 or COM_"
            aria-label="Search parameters by name"
            className="w-full rounded-md border border-edge bg-surface-raised py-2 pl-9 pr-3 text-sm text-ink outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
          />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} className="h-3.5 w-3.5 accent-violet-600" />
          Only those changed from the default ({changed} of {summary.params.length})
        </label>
      </div>
      <p className="text-[11px] leading-snug text-ink-muted">
        These are the values the aircraft was flying with when this log began. &quot;Default&quot; is the
        airframe&apos;s own default where the log gives one, otherwise the firmware&apos;s.
        {summary.paramChanges.length > 0 && ` ${summary.paramChanges.length} parameter change(s) during the log are listed under Events.`}
      </p>
      <div className="overflow-hidden rounded-xl border border-edge bg-surface-raised">
        <table className="w-full text-left text-xs [font-variant-numeric:tabular-nums]">
          <thead className="border-b border-edge text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-semibold">Name</th>
              <th className="px-3 py-2 text-right font-semibold">Value</th>
              <th className="px-3 py-2 text-right font-semibold">Default</th>
              <th className="w-24 px-3 py-2 font-semibold">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, PARAM_LIMIT).map((p) => (
              <tr key={p.name} className="border-t border-edge first:border-t-0 hover:bg-control/60">
                <td className="px-3 py-1.5 font-mono text-ink">{p.name}</td>
                <td className="px-3 py-1.5 text-right font-mono text-ink">{show(p.value, p.type)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-ink-muted">{show(p.airframeDefault ?? p.firmwareDefault, p.type)}</td>
                <td className="px-3 py-1.5 text-ink-muted">{p.changed ? 'Changed' : 'Default'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-ink-muted">
                  No parameter matches.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > PARAM_LIMIT && (
        <p className="text-center text-[11px] text-ink-muted">
          Showing the first {PARAM_LIMIT} of {rows.length}. Narrow the search to see the rest.
        </p>
      )}
    </div>
  );
}
