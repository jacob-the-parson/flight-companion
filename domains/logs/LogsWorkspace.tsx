// LogsWorkspace — the center surface. Single-surface archetype:
//   HeaderWorkspace [ identity · view switch · open a log ]
//   → the chosen view. With no log open, the whole surface is the drop target.
// Files never leave this computer: they are read in the browser.
'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ChartLine as ChartIcon,
  FileUp,
  LayoutGrid,
  ListOrdered,
  LoaderCircle,
  Map as MapIcon,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from 'lucide-react';
import { HeaderWorkspace } from '@/components/ui/HeaderWorkspace';
import { SegmentedTrack } from '@/components/ui/SegmentedTrack';
import { fmtDuration, fmtNum } from '@/lib/units';
import { useActiveLog, useLogsStore, type LogView } from '@/stores/domains/logsStore';
import { LogsCharts, LogsEvents, LogsMap, LogsOverview, LogsParams } from './LogsViews';

const VIEWS: { id: LogView; label: string; short: string; icon: typeof Activity }[] = [
  { id: 'overview', label: 'Overview', short: 'Sum', icon: LayoutGrid },
  { id: 'charts', label: 'Charts', short: 'Charts', icon: ChartIcon },
  { id: 'map', label: 'Map', short: 'Map', icon: MapIcon },
  { id: 'events', label: 'Events', short: 'Events', icon: ListOrdered },
  { id: 'params', label: 'Parameters', short: 'Params', icon: SlidersHorizontal },
];

export function useOpenLogFiles() {
  const addFiles = useLogsStore((s) => s.addFiles);
  const inputRef = useRef<HTMLInputElement>(null);
  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".ulg"
      multiple
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length > 0) void addFiles(files);
        e.target.value = '';
      }}
    />
  );
  return { input, open: () => inputRef.current?.click() };
}

export function LogsWorkspace() {
  const log = useActiveLog();
  const activeId = useLogsStore((s) => s.activeId);
  const view = useLogsStore((s) => s.view);
  const notice = useLogsStore((s) => s.notice);
  const setView = useLogsStore((s) => s.setView);
  const select = useLogsStore((s) => s.select);
  const addFiles = useLogsStore((s) => s.addFiles);
  const dismissNotice = useLogsStore((s) => s.dismissNotice);
  const { input, open } = useOpenLogFiles();
  const [dragging, setDragging] = useState(false);

  // a log remembered from an earlier visit is read again when it comes on screen
  useEffect(() => {
    if (activeId && log?.status === 'stored') void select(activeId);
  }, [activeId, log?.status, select]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void addFiles(files);
  };

  const summary = log?.summary;

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {input}

      <HeaderWorkspace
        icon={Activity}
        iconClass="text-violet-600 dark:text-violet-400"
        title={log ? log.name.replace(/\.ulg$/i, '') : 'Flight logs'}
        subtitle={
          summary && log
            ? `${summary.system.firmware} · ${summary.system.hardware} · ${fmtDuration(summary.duration)} · ${fmtNum(log.bytes / 1e6, 1)} MB`
            : 'PX4 .ulg logs, read on this computer'
        }
        center={
          summary ? <SegmentedTrack ariaLabel="Log view" options={VIEWS} value={view} onChange={setView} /> : undefined
        }
        actions={
          <button
            onClick={open}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-edge bg-control px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken"
          >
            <FileUp size={13} /> Open a log
          </button>
        }
      />

      {notice && (
        <div role="status" className="flex shrink-0 items-start gap-2 border-b border-edge bg-amber-50/70 px-4 py-2 text-xs text-ink dark:bg-amber-950/30">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-status-warning" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button onClick={dismissNotice} className="rounded p-0.5 text-ink-muted hover:text-ink" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      <div className={`min-h-0 flex-1 ${view === 'map' && summary ? '' : 'overflow-y-auto'}`}>
        {!log && (
          <div className="flex h-full items-center justify-center p-6">
            <button
              onClick={open}
              className="flex w-full max-w-lg flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-edge p-10 text-center transition-colors hover:border-violet-400 hover:bg-violet-50/40 dark:hover:bg-violet-950/20"
            >
              <span className="rounded-2xl bg-violet-100 p-4 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400">
                <FileUp size={28} />
              </span>
              <span className="text-base font-semibold text-ink">Drop a flight log here</span>
              <span className="text-sm text-ink-muted">
                or click to choose one. PX4 <span className="font-mono">.ulg</span> files, from the
                aircraft&apos;s SD card under <span className="font-mono">log/</span> or from the ground
                station&apos;s log download.
              </span>
              <span className="text-xs text-ink-muted">
                The file is read on this computer. Nothing is uploaded, and nothing is sent to the
                aircraft.
              </span>
            </button>
          </div>
        )}

        {log && (log.status === 'reading' || log.status === 'stored') && (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-sm text-ink-muted">
            <LoaderCircle size={24} className="animate-spin text-violet-600 dark:text-violet-400" />
            Reading {log.name}
          </div>
        )}

        {log?.status === 'failed' && (
          <div className="flex h-full items-center justify-center p-8">
            <div className="max-w-md rounded-xl border border-red-300 bg-red-50/70 p-5 text-sm dark:border-red-900 dark:bg-red-950/30">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <TriangleAlert size={16} className="text-status-critical" /> {log.name} could not be read
              </p>
              <p className="mt-1 text-ink-muted">{log.error}</p>
              <p className="mt-2 text-xs text-ink-muted">
                If the file came off the card while the aircraft was still powered, copy it again with
                the battery out.
              </p>
            </div>
          </div>
        )}

        {summary && view === 'overview' && <LogsOverview />}
        {summary && view === 'charts' && <LogsCharts />}
        {summary && view === 'map' && <LogsMap />}
        {summary && view === 'events' && <LogsEvents />}
        {summary && view === 'params' && <LogsParams />}
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-violet-500 bg-violet-50/80 text-base font-semibold text-ink dark:bg-violet-950/70">
          Drop to open
        </div>
      )}
    </div>
  );
}
