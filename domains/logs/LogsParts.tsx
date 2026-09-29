// Small pieces shared by the log viewer's views and drawer pages.
'use client';
import { CircleCheck, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { CHART_AXIS_WIDTH } from '@/components/shared/ChartLine';
import type { Finding, FindingLevel, ModeSpan, Span } from '@/lib/ulog/analysis';
import { fmtClock } from '@/lib/units';
import { useAircraftStore } from '@/stores/core/aircraftStore';
import { useLogsStore } from '@/stores/domains/logsStore';

// status is always an icon AND a word; colour alone never carries it
export const LEVEL_STYLE: Record<FindingLevel, { icon: LucideIcon; tone: string; box: string; word: string }> = {
  critical: {
    icon: OctagonAlert,
    tone: 'text-status-critical',
    box: 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30',
    word: 'Stop',
  },
  warning: {
    icon: TriangleAlert,
    tone: 'text-status-warning',
    box: 'border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30',
    word: 'Check',
  },
  info: { icon: Info, tone: 'text-ink-muted', box: 'border-edge bg-control/50', word: 'Note' },
  good: {
    icon: CircleCheck,
    tone: 'text-status-good',
    box: 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30',
    word: 'Good',
  },
};

export function FindingCard({ finding, compact = false }: { finding: Finding; compact?: boolean }) {
  const focusAt = useLogsStore((s) => s.focusAt);
  const activeId = useAircraftStore((s) => s.activeId);
  const active = useAircraftStore((s) => s.profiles.find((p) => p.id === s.activeId));
  const updateProfile = useAircraftStore((s) => s.updateProfile);
  const L = LEVEL_STYLE[finding.level];
  const offer = finding.offer;
  const applied = offer && active && Math.abs(active.hoverCurrentA - offer.value) < 0.05;

  return (
    <article className={`print-break-avoid rounded-lg border p-3 ${L.box}`}>
      <div className="flex gap-2.5">
        <L.icon size={16} className={`mt-0.5 shrink-0 ${L.tone}`} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className={`font-semibold text-ink ${compact ? 'text-xs' : 'text-sm'}`}>
            <span className="mr-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-muted">{L.word}</span>
            {finding.title}
          </h3>
          <p className={`leading-snug text-ink-muted ${compact ? 'text-[11px]' : 'text-xs'}`}>{finding.detail}</p>

          {finding.facts && finding.facts.length > 0 && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
              {finding.facts.map(([k, v]) => (
                <div key={k + v} className="contents">
                  <dt className="text-ink-muted">{k}</dt>
                  <dd className="font-mono text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="flex flex-wrap gap-2">
            {finding.at !== undefined && (
              <button
                onClick={() => focusAt(finding.at!)}
                className="rounded-md border border-edge bg-surface-raised px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-surface-sunken"
              >
                Show {fmtClock(finding.at)} on the charts
              </button>
            )}
            {offer?.kind === 'hoverCurrent' && active && (
              <button
                onClick={() => updateProfile(activeId, { hoverCurrentA: offer.value })}
                disabled={!!applied}
                className="rounded-md border border-edge bg-surface-raised px-2 py-1 text-[11px] font-medium text-ink transition-colors hover:bg-surface-sunken disabled:opacity-50"
              >
                {applied
                  ? `${active.name} already uses ${offer.value} A`
                  : `Use ${offer.value} A as hover current for ${active.name}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="rounded-xl border border-edge bg-surface-raised p-3">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="mt-0.5 truncate text-xl font-semibold text-ink">{value}</div>
      {sub && <div className="truncate text-[11px] text-ink-muted">{sub}</div>}
    </div>
  );
}

/**
 * The flight modes across the visible time range, lined up with the plot area of
 * the charts beneath it. Modes are named in words on the bar; the two fills only
 * separate one span from the next.
 */
export function ModeStrip({
  modes,
  airborne,
  range,
}: {
  modes: ModeSpan[];
  airborne: Span[];
  range: [number, number];
}) {
  const focusAt = useLogsStore((s) => s.focusAt);
  const width = range[1] - range[0];
  if (width <= 0) return null;
  const place = (s: Span) => {
    const a = Math.max(s.start, range[0]);
    const b = Math.min(s.end, range[1]);
    if (b <= a) return null;
    return { left: `${((a - range[0]) / width) * 100}%`, width: `${((b - a) / width) * 100}%` };
  };

  return (
    <div style={{ paddingLeft: CHART_AXIS_WIDTH + 12, paddingRight: 22 }}>
      <div className="relative h-6 overflow-hidden rounded-md border border-edge bg-surface-raised">
        {modes.map((m, i) => {
          const p = place(m);
          if (!p) return null;
          return (
            <button
              key={`${m.start}-${m.navState}`}
              onClick={() => focusAt((Math.max(m.start, range[0]) + Math.min(m.end, range[1])) / 2)}
              style={p}
              title={`${m.name}, ${fmtClock(m.start)} to ${fmtClock(m.end)}`}
              className={`absolute inset-y-0 truncate border-r-2 border-surface-raised px-1.5 text-left text-[10px] font-medium leading-6 text-ink ${
                i % 2 === 0 ? 'bg-control' : 'bg-track'
              }`}
            >
              {m.name}
            </button>
          );
        })}
      </div>
      <div className="relative mt-1 h-1.5">
        {airborne.map((s) => {
          const p = place(s);
          return p ? (
            <div key={s.start} style={p} className="absolute inset-y-0 rounded-full bg-ink-muted/60" title="In the air" />
          ) : null;
        })}
      </div>
      <p className="mt-0.5 text-[10px] text-ink-muted">Flight mode, with the time in the air marked beneath it.</p>
    </div>
  );
}
