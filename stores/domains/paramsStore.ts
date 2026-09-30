// Parameters domain store — the set that is open, the set it is compared with,
// what is selected, and the saved sets.
//
// Three kinds of memory:
//   - small things (view, filter, the LIST of saved sets) are persisted in
//     localStorage;
//   - the sets themselves, a thousand rows each, are kept in IndexedDB
//     (idb-keyval): the open one under fc-params:working, saved ones under
//     fc-params:<id>;
//   - PX4's reference is fetched once and lives in memory.
//
// The app never sends a parameter to an aircraft. Values changed here exist in
// this browser until a file is downloaded and a person loads it in the ground
// station.
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import { detectAutopilot, diffSets, findingsOf, type ParamDiff, type ParamFinding } from '@/lib/params/analysis';
import { readParams, writeParams } from '@/lib/params/codecs';
import {
  isFloatType,
  ParamFormatError,
  sameValue,
  type ParamEntry,
  type ParamFormatId,
  type ParamReference,
  type ParamSet,
  type WrittenParams,
} from '@/lib/params/model';
import { paramSampleById } from '@/lib/params/samples';
import { uid } from '@/lib/units';

export type ParamView = 'list' | 'compare' | 'file';
export type ParamFilter = 'all' | 'not-default' | 'flagged' | 'edited' | 'notes';
export type ReferenceState = 'idle' | 'loading' | 'ready' | 'failed';

// under the path the pages are served from, which is empty except on a hosted page
export const REFERENCE_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/data/px4-v1.16.0-parameters.json`;
const WORKING = 'fc-params:working';
const COMPARED = 'fc-params:compared';
const key = (id: string) => `fc-params:${id}`;
const SAVED_LIMIT = 40;

export interface SavedParams {
  id: string;
  name: string;
  count: number;
  autopilot: string;
  version: string | null;
  savedAt: number;
}

/** A parameter is found by its component and its name: two components may share a name. */
export function entryKey(e: Pick<ParamEntry, 'componentId' | 'name'>): string {
  return `${e.componentId}/${e.name}`;
}

interface ParamsState {
  set: ParamSet | null;
  /** The set the open one is compared with, and what to call it. */
  other: ParamSet | null;
  reference: ParamReference | null;
  referenceState: ReferenceState;
  selected: string | null;
  view: ParamView;
  filter: ParamFilter;
  search: string;
  exportFormat: ParamFormatId;
  saved: SavedParams[];
  loadedId: string | null;
  sampleId: string | null;
  dirty: boolean;
  /** True once the open set has been looked for in IndexedDB. */
  restored: boolean;
  notice: string | null;

  loadReference: () => Promise<void>;
  restore: () => Promise<void>;
  openFiles: (files: File[]) => Promise<void>;
  openBytes: (bytes: Uint8Array, fileName: string) => boolean;
  openSample: (id: string) => void;
  closeSet: () => void;

  select: (key: string | null) => void;
  setValue: (key: string, value: number) => void;
  putBack: (key: string) => void;
  setNote: (key: string, note: string) => void;
  rename: (name: string) => void;

  setView: (view: ParamView) => void;
  setFilter: (filter: ParamFilter) => void;
  setSearch: (search: string) => void;
  setExportFormat: (format: ParamFormatId) => void;

  compareWithFile: (file: File) => Promise<void>;
  compareWithSaved: (id: string) => Promise<void>;
  compareWithSample: (id: string) => void;
  clearCompare: () => void;

  save: () => Promise<void>;
  load: (id: string) => Promise<void>;
  deleteSaved: (id: string) => void;
  dismissNotice: () => void;
}

function editEntry(s: ParamsState, k: string, fn: (e: ParamEntry) => ParamEntry): Partial<ParamsState> {
  if (!s.set) return s;
  let done = false;
  const entries = s.set.entries.map((e) => {
    if (done || entryKey(e) !== k) return e;
    done = true;
    return fn(e);
  });
  return done ? { set: { ...s.set, entries }, dirty: true } : s;
}

/** A set read before the reference arrived is looked at again once it is here. */
function withAutopilot(set: ParamSet, reference: ParamReference | null): ParamSet {
  // a file that names its autopilot in its header is taken at its word
  if (set.stack) return set;
  const found = detectAutopilot(set, reference);
  return { ...set, autopilot: found.autopilot, autopilotFrom: found.from };
}

export const useParamsStore = create<ParamsState>()(
  persist(
    (set, get) => ({
      set: null,
      other: null,
      reference: null,
      referenceState: 'idle',
      selected: null,
      view: 'list',
      filter: 'all',
      search: '',
      exportFormat: 'qgc-params',
      saved: [],
      loadedId: null,
      sampleId: null,
      dirty: false,
      restored: false,
      notice: null,

      loadReference: async () => {
        if (get().referenceState === 'loading' || get().referenceState === 'ready') return;
        set({ referenceState: 'loading' });
        try {
          const res = await fetch(REFERENCE_URL);
          if (!res.ok) throw new Error(String(res.status));
          const reference = (await res.json()) as ParamReference;
          set((s) => ({
            reference,
            referenceState: 'ready',
            set: s.set ? withAutopilot(s.set, reference) : s.set,
            other: s.other ? withAutopilot(s.other, reference) : s.other,
          }));
          // an example chosen before the reference arrived is built now
          const waiting = get().sampleId;
          if (waiting && !get().set) get().openSample(waiting);
        } catch {
          set({ referenceState: 'failed' });
        }
      },

      restore: async () => {
        if (get().restored) return;
        try {
          const [working, compared] = await Promise.all([idbGet<ParamSet>(WORKING), idbGet<ParamSet>(COMPARED)]);
          // a file opened while this was being looked up wins
          set((s) => ({ restored: true, set: s.set ?? working ?? null, other: s.other ?? compared ?? null }));
        } catch {
          set({ restored: true });
        }
      },

      openFiles: async (files) => {
        const [first, second] = files;
        if (!first) return;
        const opened = get().openBytes(new Uint8Array(await first.arrayBuffer()), first.name);
        // two files dropped together are a comparison: the first against the second
        if (opened && second) {
          await get().compareWithFile(second);
          if (get().other) set({ view: 'compare' });
        }
        if (files.length > 2) {
          set((s) => ({ notice: `${s.notice ? `${s.notice} ` : ''}Two files were read: the first is open and is compared with the second. The others were left.` }));
        }
      },

      openBytes: (bytes, fileName) => {
        let read: ParamSet;
        try {
          read = readParams(bytes, fileName, get().reference);
        } catch (e) {
          set({ notice: `${fileName}: ${e instanceof ParamFormatError ? e.message : 'The file could not be read.'}` });
          return false;
        }
        const lost = get().set !== null && get().dirty;
        set((s) => ({
          set: read,
          selected: null,
          loadedId: null,
          sampleId: null,
          dirty: false,
          search: '',
          filter: 'all',
          view: s.view === 'compare' && !s.other ? 'list' : s.view,
          exportFormat: read.source === 'mp-param' ? 'mp-param' : 'qgc-params',
          notice: lost ? 'The set that was open had changes that were not saved. They are gone: save before opening another.' : null,
        }));
        return true;
      },

      openSample: (id) => {
        const sample = paramSampleById(id);
        if (!sample) return;
        const reference = get().reference;
        if (!reference) {
          // the examples are built from the reference; remember the choice until it arrives
          set({ sampleId: id, notice: get().referenceState === 'failed' ? 'The examples are built from PX4’s reference, which could not be loaded.' : null });
          void get().loadReference();
          return;
        }
        const built = sample.build(reference);
        const partner = sample.compareWith ? paramSampleById(sample.compareWith) : undefined;
        set({
          set: built,
          other: partner ? partner.build(reference) : null,
          selected: null,
          loadedId: null,
          sampleId: id,
          dirty: false,
          search: '',
          filter: 'all',
          view: partner ? 'compare' : 'list',
          exportFormat: 'qgc-params',
          notice: null,
        });
      },

      closeSet: () => set({ set: null, other: null, selected: null, loadedId: null, sampleId: null, dirty: false, notice: null, search: '' }),

      select: (selected) => set({ selected }),

      setValue: (k, value) =>
        set((s) =>
          editEntry(s, k, (e) => {
            const original = e.original ?? e.value;
            const v = e.type !== null && !isFloatType(e.type) ? Math.round(value) : value;
            // typing the file's own value back is not a change
            if (sameValue(v, original, e.type)) {
              const { original: _gone, ...rest } = e;
              void _gone;
              return { ...rest, value: original };
            }
            return { ...e, value: v, original };
          }),
        ),

      putBack: (k) =>
        set((s) =>
          editEntry(s, k, (e) => {
            if (e.original === undefined) return e;
            const { original, ...rest } = e;
            return { ...rest, value: original };
          }),
        ),

      setNote: (k, note) =>
        set((s) =>
          editEntry(s, k, (e) => {
            const { note: _old, ...rest } = e;
            void _old;
            return note.trim() === '' ? rest : { ...rest, note };
          }),
        ),

      rename: (name) => set((s) => (s.set ? { set: { ...s.set, name }, dirty: true } : s)),

      setView: (view) => set({ view }),
      setFilter: (filter) => set({ filter }),
      setSearch: (search) => set({ search }),
      setExportFormat: (exportFormat) => set({ exportFormat }),

      compareWithFile: async (file) => {
        try {
          const other = readParams(new Uint8Array(await file.arrayBuffer()), file.name, get().reference);
          set({ other, notice: null });
        } catch (e) {
          set({ notice: `${file.name}: ${e instanceof ParamFormatError ? e.message : 'The file could not be read.'}` });
        }
      },

      compareWithSaved: async (id) => {
        const other = await idbGet<ParamSet>(key(id)).catch(() => undefined);
        if (other) set({ other, notice: null });
        else set({ notice: 'That saved set is no longer in this browser’s storage.' });
      },

      compareWithSample: (id) => {
        const sample = paramSampleById(id);
        const reference = get().reference;
        if (sample && reference) set({ other: sample.build(reference), notice: null });
      },

      clearCompare: () => set({ other: null }),

      save: async () => {
        const s = get();
        if (!s.set) return;
        const id = s.loadedId ?? uid('params');
        try {
          await idbSet(key(id), s.set);
        } catch {
          set({ notice: 'The set could not be saved: this browser refused the storage. Download it as a file instead.' });
          return;
        }
        const entry: SavedParams = {
          id,
          name: s.set.name,
          count: s.set.entries.length,
          autopilot: s.set.autopilot,
          version: s.set.version,
          savedAt: Date.now(),
        };
        const saved = [entry, ...s.saved.filter((m) => m.id !== id)];
        for (const gone of saved.slice(SAVED_LIMIT)) void del(key(gone.id));
        set({ saved: saved.slice(0, SAVED_LIMIT), loadedId: id, sampleId: null, dirty: false });
      },

      load: async (id) => {
        const found = await idbGet<ParamSet>(key(id)).catch(() => undefined);
        if (!found) {
          set((s) => ({ notice: 'That saved set is no longer in this browser’s storage.', saved: s.saved.filter((m) => m.id !== id) }));
          return;
        }
        set({ set: found, selected: null, loadedId: id, sampleId: null, dirty: false, search: '', filter: 'all', notice: null });
      },

      deleteSaved: (id) => {
        void del(key(id));
        set((s) => ({ saved: s.saved.filter((m) => m.id !== id), loadedId: s.loadedId === id ? null : s.loadedId }));
      },

      dismissNotice: () => set({ notice: null }),
    }),
    {
      name: 'fc-params',
      version: 1,
      partialize: (s) => ({
        view: s.view,
        exportFormat: s.exportFormat,
        saved: s.saved,
        loadedId: s.loadedId,
        sampleId: s.sampleId,
        dirty: s.dirty,
      }),
    },
  ),
);

// the open set and the one it is compared with follow the store into IndexedDB,
// a moment after the last change so that typing a note is not a write per key
if (typeof window !== 'undefined') {
  let timer: ReturnType<typeof setTimeout> | null = null;
  useParamsStore.subscribe((s, before) => {
    if (!s.restored || (s.set === before.set && s.other === before.other)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const now = useParamsStore.getState();
      void (now.set ? idbSet(WORKING, now.set) : del(WORKING)).catch(() => undefined);
      void (now.other ? idbSet(COMPARED, now.other) : del(COMPARED)).catch(() => undefined);
    }, 400);
  });
}

export function useSelectedEntry(): ParamEntry | null {
  const set = useParamsStore((s) => s.set);
  const selected = useParamsStore((s) => s.selected);
  return useMemo(() => set?.entries.find((e) => entryKey(e) === selected) ?? null, [set, selected]);
}

export function useFindings(): ParamFinding[] {
  const set = useParamsStore((s) => s.set);
  const reference = useParamsStore((s) => s.reference);
  return useMemo(() => (set ? findingsOf(set, reference) : []), [set, reference]);
}

export function useDiff(): ParamDiff | null {
  const set = useParamsStore((s) => s.set);
  const other = useParamsStore((s) => s.other);
  return useMemo(() => (set && other ? diffSets(set, other) : null), [set, other]);
}

export type WriteParamsAttempt = { ok: true; file: WrittenParams } | { ok: false; reason: string };

export function useWrittenParams(): WriteParamsAttempt | null {
  const set = useParamsStore((s) => s.set);
  const format = useParamsStore((s) => s.exportFormat);
  const reference = useParamsStore((s) => s.reference);
  return useMemo(() => {
    if (!set) return null;
    try {
      return { ok: true, file: writeParams(set, format, reference) };
    } catch (e) {
      if (e instanceof ParamFormatError) return { ok: false, reason: e.message };
      throw e;
    }
  }, [set, format, reference]);
}
