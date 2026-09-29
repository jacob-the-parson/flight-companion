// Small pieces shared by the Missions workspace, its views and its drawer pages.
'use client';
import { useRef, useState } from 'react';
import {
  Check,
  CircleCheck,
  CircleMinus,
  CircleX,
  ClipboardCopy,
  Info,
  OctagonAlert,
  TriangleAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { INPUT_CLASS } from '@/components/shell/ModalProfile';
import { missionBrief } from '@/lib/mission/brief';
import type { CheckLevel, MissionCheck } from '@/lib/mission/checks';
import { DJI_AIRCRAFT, type DjiAircraftId } from '@/lib/mission/codecs/djiWpml';
import { ACCEPTED_EXTENSIONS, FORMATS, type Holds } from '@/lib/mission/formats';
import type { ConversionReport, MissionFormatId, WrittenFile } from '@/lib/mission/model';
import { downloadFile } from '@/lib/units';
import { useMissionsStore } from '@/stores/domains/missionsStore';

/** The domain's accent, written out so the class scanner sees every name. */
export const ACCENT = {
  text: 'text-teal-600 dark:text-teal-400',
  hoverText: 'hover:text-teal-600 dark:hover:text-teal-400',
  chip: 'bg-teal-100 text-teal-600 dark:bg-teal-900/40 dark:text-teal-400',
  active: 'border-teal-400 bg-teal-50/70 dark:border-teal-700 dark:bg-teal-950/30',
  drop: 'hover:border-teal-400 hover:bg-teal-50/40 dark:hover:bg-teal-950/20',
  dropping: 'border-teal-500 bg-teal-50/80 dark:bg-teal-950/70',
  check: 'accent-teal-600',
};

export const BTN =
  'flex w-full items-center justify-center gap-1.5 rounded-md border border-edge bg-control py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40';

export const TOOL_BTN =
  'flex items-center gap-1.5 whitespace-nowrap rounded-md border border-edge bg-control px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40';

// status is always an icon AND a word; colour alone never carries it
export const LEVEL_STYLE: Record<CheckLevel, { icon: LucideIcon; tone: string; box: string; word: string }> = {
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

export function CheckCard({ check }: { check: MissionCheck }) {
  const select = useMissionsStore((s) => s.select);
  // the mission, not a list made from it: a selector must hand back the same thing twice
  const mission = useMissionsStore((s) => s.mission);
  const L = LEVEL_STYLE[check.level];
  return (
    <article className={`rounded-lg border p-3 ${L.box}`}>
      <div className="flex gap-2.5">
        <L.icon size={15} className={`mt-0.5 shrink-0 ${L.tone}`} />
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="text-xs font-semibold text-ink">
            <span className="mr-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-muted">{L.word}</span>
            {check.title}
          </h3>
          <p className="text-[11px] leading-snug text-ink-muted">{check.detail}</p>
          {check.items && check.items.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {check.items.slice(0, 12).map((n) => (
                <button
                  key={n}
                  onClick={() => select(mission?.items[n - 1]?.id ?? null)}
                  className="rounded border border-edge bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-ink transition-colors hover:bg-surface-sunken"
                  title={`Select item ${n}`}
                >
                  {n}
                </button>
              ))}
              {check.items.length > 12 && (
                <span className="px-1 py-0.5 text-[10px] text-ink-muted">and {check.items.length - 12} more</span>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/** Worst level among a list of checks. */
export function worstLevel(checks: MissionCheck[]): CheckLevel {
  if (checks.some((c) => c.level === 'critical')) return 'critical';
  if (checks.some((c) => c.level === 'warning')) return 'warning';
  return 'good';
}

const HOLDS: Record<Holds, { icon: LucideIcon; tone: string; word: string }> = {
  yes: { icon: CircleCheck, tone: 'text-status-good', word: 'Yes' },
  partly: { icon: CircleMinus, tone: 'text-status-warning', word: 'Partly' },
  no: { icon: CircleX, tone: 'text-ink-muted', word: 'No' },
};

export function HoldsCell({ value }: { value: Holds }) {
  const H = HOLDS[value];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-ink">
      <H.icon size={12} className={H.tone} />
      {H.word}
    </span>
  );
}

/** What a writer kept, changed and dropped. Shown before every download. */
function Block({ title, tone, size, children }: { title: string; tone: string; size: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className={`text-[10px] font-bold uppercase tracking-wider ${tone}`}>{title}</h4>
      <ul className={`space-y-1 leading-snug text-ink ${size}`}>{children}</ul>
    </div>
  );
}

export function ReportCard({ report, compact = false }: { report: ConversionReport; compact?: boolean }) {
  const size = compact ? 'text-[11px]' : 'text-xs';
  return (
    <div className="space-y-3">
      {report.dropped.length > 0 && (
        <Block size={size} title="Not in the file" tone="text-status-critical">
          {report.dropped.map((d) => (
            <li key={d.what + d.why}>
              <span className="font-semibold">
                {d.what} ({d.count})
              </span>
              <span className="text-ink-muted">: {d.why}.</span>
            </li>
          ))}
        </Block>
      )}
      {report.changed.length > 0 && (
        <Block size={size} title="Changed to fit" tone="text-ink-muted">
          {report.changed.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </Block>
      )}
      {report.kept.length > 0 && (
        <Block size={size} title="Kept" tone="text-ink-muted">
          {report.kept.map((k) => (
            <li key={k}>{k}</li>
          ))}
        </Block>
      )}
      {report.warnings.length > 0 && (
        <Block size={size} title="Know before you use it" tone="text-ink-muted">
          {report.warnings.map((w) => (
            <li key={w} className="text-ink-muted">
              {w}
            </li>
          ))}
        </Block>
      )}
    </div>
  );
}

export function FormatSelect({ id }: { id?: string }) {
  const format = useMissionsStore((s) => s.exportFormat);
  const setExportFormat = useMissionsStore((s) => s.setExportFormat);
  return (
    <select
      id={id}
      value={format}
      onChange={(e) => setExportFormat(e.target.value as MissionFormatId)}
      className={INPUT_CLASS}
      aria-label="File format"
    >
      {FORMATS.map((f) => (
        <option key={f.id} value={f.id}>
          {f.label} (.{f.extensions[0]})
        </option>
      ))}
    </select>
  );
}

export function DjiAircraftSelect() {
  const aircraft = useMissionsStore((s) => s.djiAircraft);
  const setDjiAircraft = useMissionsStore((s) => s.setDjiAircraft);
  return (
    <select
      value={aircraft ?? ''}
      onChange={(e) => setDjiAircraft((e.target.value || null) as DjiAircraftId | null)}
      className={INPUT_CLASS}
      aria-label="DJI aircraft"
    >
      <option value="">Choose the aircraft</option>
      {DJI_AIRCRAFT.map((a) => (
        <option key={a.id} value={a.id}>
          {a.label}
        </option>
      ))}
    </select>
  );
}

export function downloadWritten(file: WrittenFile): void {
  // a copy, so the Blob owns plain bytes whatever buffer the writer used
  const bytes = new Uint8Array(file.data);
  downloadFile(file.name, new Blob([bytes.buffer], { type: file.mime }), file.mime);
}

/** The hidden file input and the function that opens it. */
export function useOpenMissionFiles() {
  const openFiles = useMissionsStore((s) => s.openFiles);
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPTED_EXTENSIONS.join(',')}
      multiple
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length > 0) void openFiles(files);
        e.target.value = '';
      }}
    />
  );
  return { input, open: () => inputRef.current?.click() };
}

/** Copy the mission, its checks and what each format would do, as JSON for an assistant. */
export function CopyBriefButton() {
  const mission = useMissionsStore((s) => s.mission);
  const djiAircraft = useMissionsStore((s) => s.djiAircraft);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    if (!mission) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(missionBrief(mission, djiAircraft), null, 2));
      setState('copied');
    } catch {
      setState('failed');
    }
    setTimeout(() => setState('idle'), 2500);
  };
  return (
    <div className="space-y-1.5">
      <button onClick={() => void copy()} disabled={!mission} className={BTN}>
        {state === 'copied' ? <Check size={13} className="text-status-good" /> : <ClipboardCopy size={13} />}
        {state === 'copied' ? 'Copied' : 'Copy for an assistant'}
      </button>
      <p className="text-[11px] leading-snug text-ink-muted">
        {state === 'failed'
          ? 'The browser did not allow the copy. Download the mission document instead: it holds the same mission.'
          : 'Puts the mission, its checks and what each format would drop on the clipboard as JSON, to paste into Claude, ChatGPT or another assistant.'}
      </p>
    </div>
  );
}
