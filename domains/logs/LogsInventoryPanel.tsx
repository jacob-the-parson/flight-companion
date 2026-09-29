// LogsInventoryPanel — the per-domain LEFT-BOTTOM panel: the logs that are open.
// Non-pageable, with its own sticky mini-header (the inventory convention).
'use client';
import { Activity, CircleAlert, FileUp, LoaderCircle, Trash2 } from 'lucide-react';
import { fmtDuration } from '@/lib/units';
import { useLogsStore } from '@/stores/domains/logsStore';
import { useOpenLogFiles } from './LogsWorkspace';

export function LogsInventoryPanel() {
  const logs = useLogsStore((s) => s.logs);
  const activeId = useLogsStore((s) => s.activeId);
  const select = useLogsStore((s) => s.select);
  const remove = useLogsStore((s) => s.remove);
  const { input, open } = useOpenLogFiles();

  return (
    <div className="flex h-full flex-col">
      {input}
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-edge bg-surface-raised/95 px-3 py-2">
        <Activity size={13} className="text-violet-600 dark:text-violet-400" />
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Logs</h3>
        <span className="ml-auto font-mono text-[10px] text-ink-muted">{logs.length}</span>
      </div>
      <div className="space-y-1 p-2">
        {logs.map((l) => {
          const active = l.id === activeId;
          const s = l.summary;
          const worst = s?.findings[0]?.level;
          return (
            <div key={l.id} className="group relative">
              <button
                onClick={() => void select(l.id)}
                className={`flex w-full flex-col rounded-md border px-2.5 py-1.5 pr-8 text-left transition-colors ${
                  active
                    ? 'border-violet-400 bg-violet-50/70 dark:border-violet-700 dark:bg-violet-950/30'
                    : 'border-edge bg-surface-raised/60 hover:border-edge-strong/40'
                }`}
                title={l.name}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-ink">
                  {l.status === 'reading' && <LoaderCircle size={11} className="shrink-0 animate-spin text-ink-muted" />}
                  {l.status === 'failed' && <CircleAlert size={11} className="shrink-0 text-status-critical" />}
                  <span className="truncate">{l.name.replace(/\.ulg$/i, '')}</span>
                </span>
                <span className="truncate text-[10px] text-ink-muted">
                  {l.status === 'failed'
                    ? 'Could not be read'
                    : s
                      ? `${fmtDuration(s.stats.airborneS)} in the air${
                          worst === 'critical' ? ' · stop' : worst === 'warning' ? ' · check' : ''
                        }`
                      : l.status === 'reading'
                        ? 'Reading'
                        : 'Stored, click to read'}
                </span>
              </button>
              <button
                onClick={() => remove(l.id)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                title="Close this log. The file on disk is not touched."
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
        <button
          onClick={open}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-edge p-2 text-xs text-ink-muted transition-colors hover:border-edge-strong/50 hover:text-ink"
        >
          <FileUp size={13} /> Open a log
        </button>
      </div>
    </div>
  );
}
