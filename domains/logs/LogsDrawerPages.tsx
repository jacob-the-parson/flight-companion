// Logs right-drawer pages (zero-prop, store-connected):
//   LogsFindingsPage — what the log shows, worst first
//   LogsPlotsPage    — which charts are on, and a builder for plotting any field
//   LogsInfoPage     — the aircraft, the firmware and the log file itself
'use client';
import { useMemo, useState } from 'react';
import { Check, ClipboardCopy, Eye, EyeOff, Plus } from 'lucide-react';
import { DrawerField, DrawerSection, DrawerStat } from '@/components/ui/DrawerSection';
import { INPUT_CLASS } from '@/components/shell/ModalProfile';
import type { FlightSummary } from '@/lib/ulog/analysis';
import { logBrief } from '@/lib/ulog/brief';
import { fmtDuration, fmtNum } from '@/lib/units';
import { useActiveLog, useActiveSummary, useLogsStore } from '@/stores/domains/logsStore';
import { FindingCard } from './LogsParts';

function Empty() {
  return (
    <p className="p-4 text-xs italic text-ink-muted opacity-70">Open a log to see this.</p>
  );
}

export function LogsFindingsPage() {
  const summary = useActiveSummary();
  if (!summary) return <Empty />;
  return (
    <div className="space-y-3 p-4">
      <p className="text-[11px] leading-snug text-ink-muted">
        Observations the log supports, worst first. Each one lists the numbers it rests on. They are a
        place to start looking, not a verdict on the aircraft.
      </p>
      {summary.findings.map((f) => (
        <FindingCard key={f.id} finding={f} compact />
      ))}
    </div>
  );
}

export function LogsPlotsPage() {
  const log = useActiveLog();
  const hidden = useLogsStore((s) => s.hiddenCharts);
  const toggleChart = useLogsStore((s) => s.toggleChart);
  const addCustomChart = useLogsStore((s) => s.addCustomChart);
  const [topic, setTopic] = useState('');
  const [fields, setFields] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const summary = log?.summary;

  const topics = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (summary?.topics ?? []).filter((t) => q === '' || t.key.toLowerCase().includes(q));
  }, [summary, filter]);
  const chosen = summary?.topics.find((t) => t.key === topic);

  if (!log || !summary) return <Empty />;
  const charts = [...summary.charts, ...(log.custom ?? [])];

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Charts shown" first>
        <div className="space-y-1">
          {charts.map((c) => {
            const off = hidden.includes(c.id);
            return (
              <button
                key={c.id}
                onClick={() => toggleChart(c.id)}
                aria-pressed={!off}
                className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                  off ? 'border-edge bg-transparent text-ink-muted' : 'border-edge bg-surface-raised/60 text-ink'
                }`}
              >
                {off ? <EyeOff size={13} className="opacity-50" /> : <Eye size={13} />}
                <span className={`min-w-0 flex-1 truncate ${off ? 'opacity-60' : ''}`}>{c.title}</span>
                <span className="text-[10px] text-ink-muted">{c.group}</span>
              </button>
            );
          })}
        </div>
      </DrawerSection>

      <DrawerSection title="Plot any field">
        <p className="text-[11px] leading-snug text-ink-muted">
          Every value the aircraft logged is here, under the name of the PX4 message that carried it.
          Up to four fields of one message per chart.
        </p>
        <DrawerField label={`Message (${topics.length})`}>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter, for example gps or battery"
            className={INPUT_CLASS}
          />
          <select
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              setFields([]);
            }}
            size={6}
            className={`${INPUT_CLASS} font-mono text-xs`}
          >
            {topics.map((t) => (
              <option key={t.key} value={t.key}>
                {t.key} ({t.count})
              </option>
            ))}
          </select>
        </DrawerField>

        {chosen && (
          <DrawerField label={`Fields (${fields.length} of 4)`}>
            <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-edge bg-surface-raised p-1">
              {chosen.fields.map((f) => {
                const on = fields.includes(f);
                return (
                  <label
                    key={f}
                    className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1 font-mono text-[11px] ${
                      on ? 'bg-control text-ink' : 'text-ink-muted'
                    } ${!on && fields.length >= 4 ? 'cursor-not-allowed opacity-40' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={!on && fields.length >= 4}
                      onChange={() => setFields(on ? fields.filter((x) => x !== f) : [...fields, f])}
                      className="h-3 w-3 accent-violet-600"
                    />
                    <span className="truncate">{f}</span>
                  </label>
                );
              })}
            </div>
          </DrawerField>
        )}

        <button
          onClick={() => {
            void addCustomChart(topic, fields);
            setFields([]);
          }}
          disabled={!chosen || fields.length === 0}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-edge bg-control py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={13} /> Add the chart
        </button>
      </DrawerSection>
    </div>
  );
}

function when(summary: FlightSummary): string {
  if (summary.startUtcMs === null) return 'The log carries no clock';
  return new Date(summary.startUtcMs).toLocaleString();
}

/** Copy the log's numbers, findings and messages as JSON for an assistant. */
function CopyLogBrief({ name, summary }: { name: string; summary: FlightSummary }) {
  const [withPlace, setWithPlace] = useState(false);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(logBrief(name, summary, { withPlace }), null, 2));
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2500);
  };
  return (
    <DrawerSection title="For an assistant">
      <button
        onClick={() => void copy()}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-edge bg-control py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken"
      >
        {state === 'copied' ? <Check size={13} className="text-status-good" /> : <ClipboardCopy size={13} />}
        {state === 'copied' ? 'Copied' : 'Copy for an assistant'}
      </button>
      <label className="flex cursor-pointer items-start gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={withPlace}
          onChange={(e) => setWithPlace(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 accent-violet-600"
        />
        <span>
          Include where it took off
          <span className="block text-[11px] text-ink-muted">
            Off, the copy holds no latitude or longitude. A takeoff point is somebody&apos;s address.
          </span>
        </span>
      </label>
      <p className="text-[11px] leading-snug text-ink-muted">
        {state === 'failed'
          ? 'The browser did not allow the copy. Use Report in the footer instead.'
          : 'Puts the numbers, findings, flight modes, messages and changed parameters on the clipboard as JSON, to paste into Claude, ChatGPT or another assistant.'}
      </p>
    </DrawerSection>
  );
}

export function LogsInfoPage() {
  const log = useActiveLog();
  const summary = log?.summary;
  if (!log || !summary) return <Empty />;

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Aircraft" first>
        <DrawerStat label="Firmware" value={summary.system.firmware} />
        <DrawerStat label="Build" value={summary.system.release.slice(0, 10) || 'n/a'} />
        <DrawerStat label="Board" value={summary.system.hardware} />
        <DrawerStat label="Operating system" value={summary.system.os || 'n/a'} />
        <DrawerStat label="Airframe number" value={summary.system.airframeId ?? 'n/a'} />
        <DrawerStat label="Rotors" value={summary.system.rotorCount ?? 'n/a'} />
        <DrawerStat label="Battery cells" value={summary.stats.cells ?? 'not set'} />
      </DrawerSection>

      <DrawerSection title="Flight">
        <DrawerStat label="Logging started" value={when(summary)} />
        <DrawerStat label="Log length" value={fmtDuration(summary.duration)} />
        <DrawerStat label="In the air" value={fmtDuration(summary.stats.airborneS)} />
        <DrawerStat label="Times off the ground" value={summary.airborne.length} />
        <DrawerStat label="Modes used" value={[...new Set(summary.modes.map((m) => m.name))].join(', ') || 'n/a'} />
      </DrawerSection>

      <DrawerSection title="File">
        <DrawerStat label="Size" value={`${fmtNum(summary.log.bytes / 1e6, 2)} MB`} />
        <DrawerStat label="Messages logged" value={summary.log.topics} />
        <DrawerStat label="Records" value={summary.log.dataMessages.toLocaleString('en-US')} />
        <DrawerStat label="Parameters" value={summary.params.length} />
        <DrawerStat label="Gaps in logging" value={`${summary.log.dropouts} (${fmtNum(summary.log.dropoutMs / 1000, 1)} s)`} />
        <DrawerStat label="Ended cleanly" value={summary.log.truncated ? 'No' : 'Yes'} />
      </DrawerSection>

      <CopyLogBrief name={log.name} summary={summary} />

      <p className="text-[11px] leading-snug text-ink-muted">
        Times on the charts count from the moment logging started, which on this firmware is the
        moment the aircraft was armed.
      </p>
    </div>
  );
}
