// Small pieces shared by the Missions workspace, its views and its drawer pages.
'use client';
import { useRef, useState } from 'react';
import { Check, CircleCheck, CircleMinus, CircleX, ClipboardCopy } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { CardCheck, LEVEL_STYLE, worstLevel as worst, type CheckLevel } from '@/components/ui/CardCheck';
import { CardReport } from '@/components/ui/CardReport';
import { INPUT_CLASS } from '@/components/shell/ModalProfile';
import { missionBrief } from '@/lib/mission/brief';
import type { MissionCheck } from '@/lib/mission/checks';
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

export { LEVEL_STYLE };

export const BTN =
  'flex w-full items-center justify-center gap-1.5 rounded-md border border-edge bg-control py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40';

export const TOOL_BTN =
  'flex items-center gap-1.5 whitespace-nowrap rounded-md border border-edge bg-control px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40';

export function CheckCard({ check }: { check: MissionCheck }) {
  const select = useMissionsStore((s) => s.select);
  const mission = useMissionsStore((s) => s.mission);
  return (
    <CardCheck
      level={check.level}
      title={check.title}
      detail={check.detail}
      chips={(check.items ?? []).map(String)}
      onChip={(n) => select(mission?.items[Number(n) - 1]?.id ?? null)}
      chipTitle={(n) => `Select item ${n}`}
    />
  );
}

/** Worst level among a list of checks. */
export function worstLevel(checks: MissionCheck[]): CheckLevel {
  return worst(checks.map((c) => c.level));
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
/** What a writer kept, changed and dropped. Shown before every download. */
export function ReportCard({ report, compact = false }: { report: ConversionReport; compact?: boolean }) {
  return <CardReport report={report} compact={compact} />;
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
