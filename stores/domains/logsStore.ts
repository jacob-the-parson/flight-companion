// Logs domain store — which logs are open, which one is on screen, and the
// shared view state every chart reads: the visible time range and the cursor.
//
// Two kinds of memory:
//   - the LIST of logs (name, size) is persisted in localStorage;
//   - the FILES are kept in IndexedDB (idb-keyval), so a log opened yesterday is
//     still there today and is read again when it is selected.
// The analysed data (typed arrays) lives only in memory.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import type { ChartData, FlightSummary } from '@/lib/ulog/analysis';
import { closeLog, openLog, requestSeries } from '@/lib/ulog/client';
import { useSiteStore } from '@/stores/core/siteStore';
import { uid } from '@/lib/units';

export type LogView = 'overview' | 'charts' | 'map' | 'events' | 'params';
export type LogStatus = 'stored' | 'reading' | 'ready' | 'failed';

export interface LogEntry {
  id: string;
  name: string;
  bytes: number;
  addedAt: number;
  status: LogStatus;
  error?: string;
  summary?: FlightSummary;
  custom?: ChartData[];
}

interface LogsState {
  logs: LogEntry[];
  activeId: string | null;
  view: LogView;
  /** Visible time range in seconds; null = the whole log. */
  xRange: [number, number] | null;
  /** Time under the pointer on any chart, seconds; null = pointer is elsewhere. */
  cursorT: number | null;
  hiddenCharts: string[];
  /** Short message for the user: a file that was refused, a plot that failed. */
  notice: string | null;

  addFiles: (files: File[]) => Promise<void>;
  select: (id: string) => Promise<void>;
  remove: (id: string) => void;
  setView: (view: LogView) => void;
  setXRange: (range: [number, number] | null) => void;
  setCursor: (t: number | null) => void;
  focusAt: (t: number) => void;
  toggleChart: (chartId: string) => void;
  addCustomChart: (topic: string, fields: string[]) => Promise<void>;
  removeCustomChart: (chartId: string) => void;
  dismissNotice: () => void;
}

const key = (id: string) => `fc-log:${id}`;

function patch(logs: LogEntry[], id: string, p: Partial<LogEntry>): LogEntry[] {
  return logs.map((l) => (l.id === id ? { ...l, ...p } : l));
}

export const useLogsStore = create<LogsState>()(
  persist(
    (set, get) => {
      /** Read a log's bytes and turn them into a summary; updates the entry as it goes. */
      const read = async (id: string, buffer: ArrayBuffer) => {
        set((s) => ({ logs: patch(s.logs, id, { status: 'reading', error: undefined }) }));
        try {
          const summary = await openLog(id, buffer);
          set((s) => ({ logs: patch(s.logs, id, { status: 'ready', summary, custom: [] }) }));
          const entry = get().logs.find((l) => l.id === id);
          if (summary.home && entry) {
            useSiteStore.getState().setLastTakeoff({ ...summary.home, source: entry.name });
          }
        } catch (err) {
          set((s) => ({
            logs: patch(s.logs, id, {
              status: 'failed',
              error: err instanceof Error ? err.message : 'The file could not be read.',
            }),
          }));
        }
      };

      return {
        logs: [],
        activeId: null,
        view: 'overview',
        xRange: null,
        cursorT: null,
        hiddenCharts: [],
        notice: null,

        addFiles: async (files) => {
          const refused: string[] = [];
          let first: string | null = null;
          for (const file of files) {
            const lower = file.name.toLowerCase();
            if (!lower.endsWith('.ulg')) {
              refused.push(
                lower.endsWith('.bin') || lower.endsWith('.tlog')
                  ? `${file.name}: ArduPilot .bin and MAVLink .tlog logs are not read yet. This version reads PX4 .ulg.`
                  : `${file.name}: not a PX4 .ulg log.`,
              );
              continue;
            }
            const existing = get().logs.find((l) => l.name === file.name && l.bytes === file.size);
            if (existing) {
              first ??= existing.id;
              continue;
            }
            const id = uid('log');
            const buffer = await file.arrayBuffer();
            // keep the file first: the worker takes the buffer away
            try {
              await idbSet(key(id), buffer.slice(0));
            } catch {
              // storage full or unavailable: the log still opens, it just will not persist
            }
            set((s) => ({
              logs: [
                ...s.logs,
                { id, name: file.name, bytes: file.size, addedAt: Date.now(), status: 'reading' },
              ],
            }));
            first ??= id;
            await read(id, buffer);
          }
          if (first) set({ activeId: first, xRange: null, cursorT: null });
          if (refused.length > 0) set({ notice: refused.join(' ') });
        },

        select: async (id) => {
          const entry = get().logs.find((l) => l.id === id);
          if (!entry) return;
          set({ activeId: id, xRange: null, cursorT: null });
          if (entry.status === 'ready' || entry.status === 'reading') return;
          let buffer: ArrayBuffer | undefined;
          try {
            buffer = await idbGet<ArrayBuffer>(key(id));
          } catch {
            buffer = undefined;
          }
          if (!buffer) {
            set((s) => ({
              logs: patch(s.logs, id, {
                status: 'failed',
                error: 'The stored copy of this log is gone. Open the file again.',
              }),
            }));
            return;
          }
          await read(id, buffer);
        },

        remove: (id) => {
          closeLog(id);
          void del(key(id)).catch(() => undefined);
          set((s) => {
            const logs = s.logs.filter((l) => l.id !== id);
            const activeId = s.activeId === id ? (logs[logs.length - 1]?.id ?? null) : s.activeId;
            return { logs, activeId, xRange: null, cursorT: null };
          });
          const next = get().activeId;
          if (next) void get().select(next);
        },

        setView: (view) => set({ view }),
        setXRange: (range) =>
          set((s) => {
            if (range === null) return s.xRange === null ? s : { xRange: null };
            const [a, b] = range;
            if (!(b > a)) return s;
            if (s.xRange && Math.abs(s.xRange[0] - a) < 1e-6 && Math.abs(s.xRange[1] - b) < 1e-6) return s;
            return { xRange: [a, b] };
          }),
        setCursor: (cursorT) => set((s) => (s.cursorT === cursorT ? s : { cursorT })),
        focusAt: (t) => {
          const entry = get().logs.find((l) => l.id === get().activeId);
          const duration = entry?.summary?.duration ?? t + 5;
          const half = Math.min(5, duration / 2);
          const a = Math.max(0, Math.min(t - half, duration - 2 * half));
          set({ xRange: [a, a + 2 * half], view: 'charts' });
        },
        toggleChart: (chartId) =>
          set((s) => ({
            hiddenCharts: s.hiddenCharts.includes(chartId)
              ? s.hiddenCharts.filter((c) => c !== chartId)
              : [...s.hiddenCharts, chartId],
          })),

        addCustomChart: async (topic, fields) => {
          const id = get().activeId;
          if (!id || fields.length === 0) return;
          try {
            const series = await requestSeries(id, topic, fields);
            if (series.length === 0) {
              set({ notice: 'Those fields hold no values in this log.' });
              return;
            }
            const chart: ChartData = {
              id: uid('custom'),
              group: 'Custom',
              title: topic,
              unit: 'as logged',
              note: 'Raw values as the aircraft logged them. Units are those of the PX4 message.',
              series,
            };
            set((s) => ({
              logs: s.logs.map((l) => (l.id === id ? { ...l, custom: [...(l.custom ?? []), chart] } : l)),
              view: 'charts',
            }));
          } catch (err) {
            set({ notice: err instanceof Error ? err.message : 'That plot could not be made.' });
          }
        },
        removeCustomChart: (chartId) =>
          set((s) => ({
            logs: s.logs.map((l) =>
              l.id === s.activeId ? { ...l, custom: (l.custom ?? []).filter((c) => c.id !== chartId) } : l,
            ),
          })),
        dismissNotice: () => set({ notice: null }),
      };
    },
    {
      name: 'fc-logs',
      version: 1,
      partialize: (s) => ({
        // only the index: the analysed data is rebuilt from the stored file
        logs: s.logs
          .filter((l) => l.status !== 'failed')
          .map(({ id, name, bytes, addedAt }) => ({ id, name, bytes, addedAt, status: 'stored' as const })),
        activeId: s.activeId,
        view: s.view,
        hiddenCharts: s.hiddenCharts,
      }),
    },
  ),
);

export function useActiveLog(): LogEntry | null {
  return useLogsStore((s) => s.logs.find((l) => l.id === s.activeId) ?? null);
}

export function useActiveSummary(): FlightSummary | null {
  return useLogsStore((s) => s.logs.find((l) => l.id === s.activeId)?.summary ?? null);
}
