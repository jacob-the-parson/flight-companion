// ChartLine — the one time-series chart (uPlot on a canvas).
//
// Rules it enforces, so no caller has to remember them:
//   - ONE y axis. Two measures of different scale are two charts.
//   - Series colours come from the four validated palette slots, in fixed order.
//   - Text is ink, never a series colour; a short stroke beside the label carries identity.
//   - Two or more series get a legend; one series does not (the title names it).
//   - The crosshair finds the time; the readout lists every series at that time.
//   - Every value is also reachable without hovering: a table view and a CSV.
//   - Drag to zoom the time axis; double-click to see the whole log again.
// The visible range and the cursor are SHARED through props, so a column of
// charts moves as one.
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Download, Table2, X } from 'lucide-react';
import { ModalBase } from '@/components/ui/ModalBase';
import { decimate, valueAt } from '@/lib/ulog/decimate';
import { downloadFile, fmtClock, slug } from '@/lib/units';
import { useThemeStore } from '@/stores/core/themeStore';

export interface ChartSeries {
  label: string;
  t: Float64Array;
  v: Float64Array;
}

export interface ChartSpan {
  start: number;
  end: number;
}

interface ChartLineProps {
  title: string;
  unit: string;
  note?: string;
  series: ChartSeries[];
  /** Full extent of the time axis, seconds. */
  duration: number;
  /** Visible range; null = the whole log. */
  xRange: [number, number] | null;
  onRange: (range: [number, number] | null) => void;
  onCursor?: (t: number | null) => void;
  /** Shaded behind the lines: the time spent in the air. */
  shaded?: ChartSpan[];
  shadedLabel?: string;
  syncKey?: string;
  height?: number;
  /** Shown beside the chart's own buttons: a remove button for custom plots. */
  onRemove?: () => void;
  fileStem?: string;
}

const SLOTS = ['--viz-1', '--viz-2', '--viz-3', '--viz-4'] as const;
const AXIS_W = 56;

function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function fmtValue(v: number): string {
  if (!Number.isFinite(v)) return 'n/a';
  const a = Math.abs(v);
  if (a >= 10000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

function tickValue(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 10 || Number.isInteger(v)) return String(Math.round(v * 10) / 10);
  return String(Math.round(v * 100) / 100);
}

export function ChartLine({
  title,
  unit,
  note,
  series,
  duration,
  xRange,
  onRange,
  onCursor,
  shaded,
  shadedLabel = 'In the air',
  syncKey = 'fc-charts',
  height = 190,
  onRemove,
  fileStem = 'log',
}: ChartLineProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const isDark = useThemeStore((s) => s.isDark);
  const [readout, setReadout] = useState<{ t: number; values: number[] } | null>(null);
  const [tableOpen, setTableOpen] = useState(false);

  // at most four series: that is what the validated palette covers
  const shown = useMemo(() => series.slice(0, 4), [series]);
  const range = useMemo<[number, number]>(
    () => xRange ?? [0, Math.max(duration, 1e-3)],
    [xRange, duration],
  );

  // the latest props, for callbacks owned by the long-lived plot
  const live = useRef({ onRange, onCursor, shaded, shown, range, duration });
  useEffect(() => {
    live.current = { onRange, onCursor, shaded, shown, range, duration };
  });

  const dataFor = (r: [number, number], width: number): uPlot.AlignedData => {
    const buckets = Math.max(200, Math.floor(width));
    const tables = live.current.shown.map((s) => {
      const [x, y] = decimate(s.t, s.v, r[0], r[1], buckets);
      return [x, y] as [number[], number[]];
    });
    const filled = tables.filter((tb) => tb[0].length > 0);
    if (filled.length === 0) return [[r[0], r[1]], ...live.current.shown.map(() => [null, null])] as uPlot.AlignedData;
    if (tables.length === 1) return tables[0] as uPlot.AlignedData;
    // series from different messages are sampled at different times: line them up
    const safe = tables.map((tb) => (tb[0].length > 0 ? tb : ([[r[0]], [null]] as unknown as [number[], number[]])));
    return uPlot.join(safe as unknown as uPlot.AlignedData[]);
  };

  // build the plot; rebuilt when the series or the theme change
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ink = token('--ink-muted', '#71717a');
    const grid = token('--viz-grid', '#e1e0d9');
    const band = token('--viz-band', 'rgba(0,0,0,0.05)');
    const surface = token('--viz-surface', '#ffffff');
    const colors = SLOTS.map((s, i) => token(s, ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'][i]));
    const font = '11px system-ui, -apple-system, "Segoe UI", sans-serif';

    let frame = 0;
    const width = Math.max(200, host.clientWidth);
    const r0 = live.current.range;

    const opts: uPlot.Options = {
      width,
      height,
      padding: [10, 10, 0, 0],
      legend: { show: false },
      scales: {
        x: { time: false, min: r0[0], max: r0[1] },
        y: {
          range: (_u, min, max) => {
            if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
            if (min === max) return [min - 1, max + 1];
            const pad = (max - min) * 0.08;
            return [min - pad, max + pad];
          },
        },
      },
      axes: [
        {
          stroke: ink,
          font,
          grid: { show: false },
          ticks: { stroke: grid, width: 1, size: 4 },
          values: (_u, ticks) => ticks.map((v) => fmtClock(v).replace(/\.0$/, '')),
          size: 30,
        },
        {
          stroke: ink,
          font,
          size: AXIS_W,
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
          values: (_u, ticks) => ticks.map(tickValue),
        },
      ],
      series: [
        {},
        ...live.current.shown.map((s, i) => ({
          label: s.label,
          stroke: colors[i],
          width: 2,
          spanGaps: true,
          points: { show: false },
        })),
      ],
      cursor: {
        sync: { key: syncKey },
        drag: { x: true, y: false, setScale: true },
        points: { size: 9, width: 2, stroke: surface, fill: (_u, si) => colors[si - 1] ?? ink },
        bind: {
          // double-click shows the whole log again, not just the loaded slice
          dblclick: () => () => {
            live.current.onRange(null);
            return null;
          },
        },
      },
      hooks: {
        drawClear: [
          (u) => {
            const spans = live.current.shaded;
            if (!spans || spans.length === 0) return;
            const { ctx, bbox } = u;
            ctx.save();
            ctx.fillStyle = band;
            for (const s of spans) {
              const a = Math.max(bbox.left, u.valToPos(s.start, 'x', true));
              const b = Math.min(bbox.left + bbox.width, u.valToPos(s.end, 'x', true));
              if (b > a) ctx.fillRect(a, bbox.top, b - a, bbox.height);
            }
            ctx.restore();
          },
        ],
        setScale: [
          (u, key) => {
            if (key !== 'x') return;
            const { min, max } = u.scales.x;
            if (min == null || max == null) return;
            const cur = live.current.range;
            if (Math.abs(cur[0] - min) < 1e-6 && Math.abs(cur[1] - max) < 1e-6) return;
            const full = min <= 1e-6 && max >= live.current.duration - 1e-6;
            live.current.onRange(full ? null : [min, max]);
          },
        ],
        setCursor: [
          (u) => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
              const left = u.cursor.left ?? -1;
              if (left < 0) {
                setReadout(null);
                // only the chart under the pointer speaks for the cursor
                if (u.cursor.event) live.current.onCursor?.(null);
                return;
              }
              const t = u.posToVal(left, 'x');
              setReadout({ t, values: live.current.shown.map((s) => valueAt(s.t, s.v, t)) });
              if (u.cursor.event) live.current.onCursor?.(t);
            });
          },
        ],
      },
    };

    const plot = new uPlot(opts, dataFor(r0, width), host);
    plotRef.current = plot;

    const observer = new ResizeObserver(() => {
      const w = Math.max(200, host.clientWidth);
      if (Math.abs(w - plot.width) < 2) return;
      plot.setSize({ width: w, height });
      plot.setData(dataFor(live.current.range, w), false);
      plot.setScale('x', { min: live.current.range[0], max: live.current.range[1] });
    });
    observer.observe(host);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
     
  }, [shown, isDark, height, syncKey]);

  // follow the shared range: load the samples for it, then frame it
  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    live.current.range = range;
    plot.setData(dataFor(range, plot.width), false);
    plot.setScale('x', { min: range[0], max: range[1] });
  }, [range]);

  // shaded spans are read at draw time; ask for a redraw when they change
  useEffect(() => {
    plotRef.current?.redraw(false);
  }, [shaded]);

  const csv = () => {
    const rows = ['series,time_s,value'];
    for (const s of shown) {
      for (let i = 0; i < s.t.length; i++) {
        if (s.t[i] < range[0] || s.t[i] > range[1]) continue;
        rows.push(`${JSON.stringify(s.label)},${s.t[i].toFixed(6)},${s.v[i]}`);
      }
    }
    downloadFile(`${fileStem}-${slug(title)}.csv`, rows.join('\n') + '\n', 'text/csv');
  };

  const tableRows = useMemo(() => {
    if (!tableOpen) return [];
    const n = 60;
    const rows: { t: number; values: number[] }[] = [];
    for (let i = 0; i <= n; i++) {
      const t = range[0] + ((range[1] - range[0]) * i) / n;
      rows.push({ t, values: shown.map((s) => valueAt(s.t, s.v, t)) });
    }
    return rows;
  }, [tableOpen, range, shown]);

  const iconBtn = 'rounded p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink';
  const multi = shown.length > 1;

  return (
    <figure className="rounded-xl border border-edge bg-viz-surface p-3">
      <figcaption className="mb-1 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">
            {title} <span className="font-normal text-ink-muted">({unit})</span>
          </h3>
          {note && <p className="text-[11px] leading-snug text-ink-muted">{note}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {!multi && readout && (
            <span className="mr-1 font-mono text-xs text-ink">
              {fmtValue(readout.values[0])} <span className="text-ink-muted">at {fmtClock(readout.t)}</span>
            </span>
          )}
          <button onClick={() => setTableOpen(true)} className={iconBtn} title="Show as a table" aria-label={`${title}: show as a table`}>
            <Table2 size={14} />
          </button>
          <button onClick={csv} className={`${iconBtn} hover:text-green-600`} title="Download the visible range as CSV" aria-label={`${title}: download CSV`}>
            <Download size={14} />
          </button>
          {onRemove && (
            <button onClick={onRemove} className={`${iconBtn} hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30`} title="Remove this plot" aria-label={`${title}: remove`}>
              <X size={14} />
            </button>
          )}
        </div>
      </figcaption>

      {/* legend + readout: line keys, labels in ink, the value strongest */}
      {multi && (
        <ul className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px]">
          {shown.map((s, i) => (
            <li key={s.label} className="flex items-center gap-1.5">
              <span className="h-0.5 w-4 rounded-full" style={{ background: `var(${SLOTS[i]})` }} />
              <span className="text-ink-muted">{s.label}</span>
              <span className="min-w-12 font-mono font-semibold text-ink">
                {readout ? fmtValue(readout.values[i]) : ''}
              </span>
            </li>
          ))}
          {readout && <li className="font-mono text-ink-muted">at {fmtClock(readout.t)}</li>}
        </ul>
      )}

      <div ref={hostRef} className="w-full" style={{ height }} />

      {shaded && shaded.length > 0 && (
        <p className="mt-1 flex items-center gap-1.5 pl-14 text-[10px] text-ink-muted">
          <span className="h-2.5 w-4 rounded-sm" style={{ background: 'var(--viz-band)', outline: '1px solid var(--viz-grid)' }} />
          {shadedLabel}
        </p>
      )}

      <ModalBase isOpen={tableOpen} onClose={() => setTableOpen(false)} title={`${title} (${unit})`} maxWidth="max-w-2xl">
        <p className="mb-3 text-xs text-ink-muted">
          {fmtClock(range[0])} to {fmtClock(range[1])}, sampled at 61 evenly spaced times. The CSV
          download holds every logged sample in this range.
        </p>
        <table className="w-full text-left text-xs [font-variant-numeric:tabular-nums]">
          <thead className="sticky top-0 bg-surface-raised text-ink-muted">
            <tr>
              <th className="py-1 pr-3 font-semibold">Time</th>
              {shown.map((s) => (
                <th key={s.label} className="py-1 pr-3 font-semibold">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => (
              <tr key={r.t} className="border-t border-edge">
                <td className="py-1 pr-3 font-mono text-ink-muted">{fmtClock(r.t)}</td>
                {r.values.map((v, i) => (
                  <td key={i} className="py-1 pr-3 font-mono text-ink">
                    {fmtValue(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ModalBase>
    </figure>
  );
}

export const CHART_AXIS_WIDTH = AXIS_W;
