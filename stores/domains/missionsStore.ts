// Missions domain store — the mission that is open, what is selected in it, the
// format it will be written in, and the saved missions. Persisted.
//
// ONE WAY IN: a mission arrives by being READ, whether from a file on disk, a
// plan handed over by the planner, or an example. Reading is the tested path
// (scripts/verify-mission.mjs), so everything on screen has been through it.
//
// Every change to the mission goes through change(), which keeps the mission
// that was there so Undo can bring it back. That includes opening a file over
// unsaved work.
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { tryWrite, type WriteAttempt } from '@/lib/mission/brief';
import { checkMission, type MissionCheck } from '@/lib/mission/checks';
import type { DjiAircraftId } from '@/lib/mission/codecs/djiWpml';
import { readMission } from '@/lib/mission/formats';
import {
  emptyMission,
  hasPosition,
  MissionFormatError,
  missionStats,
  newId,
  type HeightRef,
  type Mission,
  type MissionFormatId,
  type MissionItem,
  type MissionPoint,
  type MissionStats,
  type WaypointItem,
} from '@/lib/mission/model';
import { sampleById } from '@/lib/mission/samples';
import { uid } from '@/lib/units';
import { useAircraftStore } from '@/stores/core/aircraftStore';

export type MissionView = 'map' | 'items' | 'file' | 'convert';
export type MissionTool = 'select' | 'add' | 'home';
export type AddableKind = 'takeoff' | 'return' | 'land' | 'speed' | 'camera-distance' | 'roi';

/** Zoomed out further than this, a click cannot place a point to within a field's width. */
export const MIN_EDIT_ZOOM = 13;
const UNDO_DEPTH = 40;
const SAVED_LIMIT = 30;

export interface SavedMission {
  id: string;
  savedAt: number;
  mission: Mission;
}

interface MissionsState {
  mission: Mission | null;
  selectedId: string | null;
  view: MissionView;
  tool: MissionTool;
  exportFormat: MissionFormatId;
  djiAircraft: DjiAircraftId | null;
  saved: SavedMission[];
  /** Id of the saved mission the open one came from, if any. */
  loadedId: string | null;
  /** Id of the example that is open, if one is. */
  sampleId: string | null;
  /** Changed since it was opened or saved. */
  dirty: boolean;
  /** Earlier states of the mission, newest last. Memory only. */
  past: (Mission | null)[];
  mapView: { center: MissionPoint; zoom: number } | null;
  fitRequest: number;
  notice: string | null;

  openFiles: (files: File[]) => Promise<void>;
  openBytes: (bytes: Uint8Array, fileName: string, from?: string) => boolean;
  openSample: (id: string) => void;
  newMission: () => void;
  closeMission: () => void;
  undo: () => void;

  setView: (view: MissionView) => void;
  setTool: (tool: MissionTool) => void;
  setExportFormat: (format: MissionFormatId) => void;
  setDjiAircraft: (id: DjiAircraftId | null) => void;
  select: (id: string | null) => void;

  mapClick: (p: MissionPoint) => void;
  moveItem: (id: string, p: MissionPoint) => void;
  setHome: (p: MissionPoint | null) => void;
  setHomeHeight: (heightAmsl: number | null) => void;
  patchMission: (patch: Partial<Pick<Mission, 'name' | 'cruiseSpeed' | 'firmware'>>) => void;
  replaceItem: (item: MissionItem) => void;
  addItem: (kind: AddableKind) => void;
  removeItem: (id: string) => void;
  shiftItem: (id: string, by: 1 | -1) => void;
  reverseRoute: () => void;
  setEveryHeight: (height: number, ref: HeightRef) => void;
  shiftEveryHeight: (by: number) => void;

  save: () => void;
  load: (id: string) => void;
  deleteSaved: (id: string) => void;

  setMapView: (center: MissionPoint, zoom: number) => void;
  requestFit: () => void;
  dismissNotice: () => void;
}

function activeFirmware(): 'px4' | 'ardupilot' {
  const s = useAircraftStore.getState();
  return (s.profiles.find((p) => p.id === s.activeId) ?? s.profiles[0]).firmware;
}

function blank(): Mission {
  const m = emptyMission();
  m.firmware = activeFirmware();
  m.cruiseSpeed = 5;
  return m;
}

/** A new state of the mission, with the old one kept for Undo. */
function change(s: MissionsState, next: Mission | null, more: Partial<MissionsState> = {}): Partial<MissionsState> {
  return { mission: next, past: [...s.past, s.mission].slice(-UNDO_DEPTH), dirty: true, ...more };
}

function editItems(s: MissionsState, fn: (items: MissionItem[]) => MissionItem[], more: Partial<MissionsState> = {}) {
  if (!s.mission) return s;
  return change(s, { ...s.mission, items: fn(s.mission.items) }, more);
}

/** The height a new waypoint starts with: that of the one before it. */
function heightBefore(items: MissionItem[], index: number): { height: number; heightRef: HeightRef } {
  for (let i = Math.min(index, items.length) - 1; i >= 0; i--) {
    const item = items[i];
    if ((item.kind === 'waypoint' || item.kind === 'takeoff') && item.height !== null && item.heightRef !== 'unknown') {
      return { height: item.height, heightRef: item.heightRef };
    }
  }
  const later = items.find((i): i is WaypointItem => i.kind === 'waypoint' && i.height !== null && i.heightRef !== 'unknown');
  return later && later.height !== null ? { height: later.height, heightRef: later.heightRef } : { height: 30, heightRef: 'home' };
}

/** Where a new item goes: after the selected one, else before the return or landing that ends the mission. */
function insertAt(s: MissionsState, items: MissionItem[]): number {
  const selected = items.findIndex((i) => i.id === s.selectedId);
  if (selected >= 0) return selected + 1;
  const last = items[items.length - 1];
  return last && (last.kind === 'return' || last.kind === 'land') ? items.length - 1 : items.length;
}

const insert = (items: MissionItem[], index: number, item: MissionItem) => [
  ...items.slice(0, index),
  item,
  ...items.slice(index),
];

export const useMissionsStore = create<MissionsState>()(
  persist(
    (set, get) => ({
      mission: null,
      selectedId: null,
      view: 'map',
      tool: 'select',
      exportFormat: 'qgc-plan',
      djiAircraft: null,
      saved: [],
      loadedId: null,
      sampleId: null,
      dirty: false,
      past: [],
      mapView: null,
      fitRequest: 0,
      notice: null,

      openFiles: async (files) => {
        const [first, ...rest] = files;
        if (!first) return;
        const opened = get().openBytes(new Uint8Array(await first.arrayBuffer()), first.name);
        // the others go to the saved list, so nothing that was dropped is lost
        const kept: SavedMission[] = [];
        const refused: string[] = [];
        for (const file of rest) {
          try {
            const mission = readMission(new Uint8Array(await file.arrayBuffer()), file.name);
            kept.push({ id: uid('mission'), savedAt: Date.now(), mission });
          } catch (e) {
            refused.push(`${file.name}: ${e instanceof Error ? e.message : 'could not be read'}`);
          }
        }
        if (kept.length > 0) set((s) => ({ saved: [...kept, ...s.saved].slice(0, SAVED_LIMIT) }));
        if (rest.length > 0) {
          const said = opened ? get().notice : null;
          set({
            notice: [
              said,
              kept.length > 0 ? `${kept.length} more file${kept.length > 1 ? 's were' : ' was'} read and put in the saved list.` : null,
              ...refused,
            ]
              .filter(Boolean)
              .join(' '),
          });
        }
      },

      openBytes: (bytes, fileName, from) => {
        let mission: Mission;
        try {
          mission = readMission(bytes, fileName);
        } catch (e) {
          // a file that is refused changes nothing that is open
          set({
            notice: `${fileName}: ${e instanceof MissionFormatError ? e.message : 'The file could not be read.'}`,
          });
          return false;
        }
        const replaced = get().mission !== null && get().dirty;
        set((s) => ({
          ...change(s, mission),
          dirty: false,
          selectedId: null,
          loadedId: null,
          sampleId: null,
          tool: 'select',
          exportFormat: mission.source && mission.source !== 'csv' ? mission.source : s.exportFormat,
          mapView: null,
          fitRequest: s.fitRequest + 1,
          notice: [
            from ? `Opened from ${from}.` : null,
            replaced ? 'The mission that was open had changes that were not saved. Undo brings it back.' : null,
          ]
            .filter(Boolean)
            .join(' ') || null,
        }));
        return true;
      },

      openSample: (id) => {
        const sample = sampleById(id);
        if (!sample) return;
        const replaced = get().mission !== null && get().dirty;
        set((s) => ({
          ...change(s, sample.build()),
          dirty: false,
          selectedId: null,
          loadedId: null,
          sampleId: id,
          tool: 'select',
          exportFormat: sample.lookAt,
          mapView: null,
          fitRequest: s.fitRequest + 1,
          notice: replaced ? 'The mission that was open had changes that were not saved. Undo brings it back.' : null,
        }));
      },

      newMission: () =>
        set((s) => ({
          ...change(s, blank()),
          dirty: false,
          selectedId: null,
          loadedId: null,
          sampleId: null,
          tool: 'add',
          view: 'map',
          notice: null,
        })),

      closeMission: () =>
        set((s) => ({
          ...change(s, null),
          dirty: false,
          selectedId: null,
          loadedId: null,
          sampleId: null,
          tool: 'select',
          notice: null,
        })),

      undo: () =>
        set((s) => {
          if (s.past.length === 0) return s;
          const mission = s.past[s.past.length - 1];
          const still = mission?.items.some((i) => i.id === s.selectedId) ?? false;
          return {
            mission,
            past: s.past.slice(0, -1),
            dirty: true,
            selectedId: still ? s.selectedId : null,
          };
        }),

      setView: (view) => set({ view }),
      setTool: (tool) => set({ tool }),
      setExportFormat: (exportFormat) => set({ exportFormat }),
      setDjiAircraft: (djiAircraft) => set({ djiAircraft }),
      select: (selectedId) => set({ selectedId }),

      mapClick: (p) =>
        set((s) => {
          if (s.tool === 'select') return s.selectedId === null ? s : { selectedId: null };
          if ((s.mapView?.zoom ?? 0) < MIN_EDIT_ZOOM) return s;
          const mission = s.mission ?? blank();
          if (s.tool === 'home') {
            return change(s, { ...mission, home: { ...p, heightAmsl: mission.home?.heightAmsl ?? null } }, { tool: 'select' });
          }
          const index = insertAt(s, mission.items);
          const item: WaypointItem = { id: newId(), kind: 'waypoint', ...p, ...heightBefore(mission.items, index) };
          return change(s, { ...mission, items: insert(mission.items, index, item) }, { selectedId: item.id });
        }),

      moveItem: (id, p) =>
        set((s) =>
          editItems(s, (items) =>
            items.map((i) =>
              i.id === id && (i.kind === 'waypoint' || i.kind === 'takeoff' || i.kind === 'land' || i.kind === 'roi')
                ? { ...i, lat: p.lat, lng: p.lng }
                : i,
            ),
          ),
        ),

      setHome: (p) =>
        set((s) => {
          if (!s.mission) return s;
          return change(s, {
            ...s.mission,
            home: p ? { ...p, heightAmsl: s.mission.home?.heightAmsl ?? null } : null,
          });
        }),

      setHomeHeight: (heightAmsl) =>
        set((s) => (s.mission?.home ? change(s, { ...s.mission, home: { ...s.mission.home, heightAmsl } }) : s)),

      patchMission: (patch) => set((s) => (s.mission ? change(s, { ...s.mission, ...patch }) : s)),

      replaceItem: (item) => set((s) => editItems(s, (items) => items.map((i) => (i.id === item.id ? item : i)))),

      addItem: (kind) =>
        set((s) => {
          const mission = s.mission ?? blank();
          const items = mission.items;
          const id = newId();
          const done = (next: MissionItem[]) => change(s, { ...mission, items: next }, { selectedId: id, notice: null });

          if (kind === 'takeoff') {
            if (items.some((i) => i.kind === 'takeoff')) return { notice: 'The mission already has a takeoff.' };
            const first = heightBefore(items, 0);
            return done([{ id, kind, lat: null, lng: null, height: Math.min(first.height, 20), heightRef: 'home' }, ...items]);
          }
          if (kind === 'return' || kind === 'land') {
            const last = items[items.length - 1];
            const kept = last && (last.kind === 'return' || last.kind === 'land') ? items.slice(0, -1) : items;
            return done([...kept, kind === 'return' ? { id, kind } : { id, kind, lat: null, lng: null }]);
          }
          const index = insertAt(s, items);
          if (kind === 'speed') return done(insert(items, index, { id, kind, speed: mission.cruiseSpeed ?? 5 }));
          if (kind === 'camera-distance') return done(insert(items, index, { id, kind, distanceM: 10 }));
          // a point of interest starts in the middle of the route, to be dragged to its place
          const placed = items.filter(hasPosition).filter((i) => i.kind === 'waypoint');
          const centre =
            placed.length > 0
              ? {
                  lat: placed.reduce((a, i) => a + i.lat, 0) / placed.length,
                  lng: placed.reduce((a, i) => a + i.lng, 0) / placed.length,
                }
              : (s.mapView?.center ?? mission.home);
          if (!centre) return { notice: 'Add a waypoint first, so the point of interest has somewhere to start.' };
          return done(insert(items, index, { id, kind: 'roi', lat: centre.lat, lng: centre.lng, height: 0 }));
        }),

      removeItem: (id) =>
        set((s) =>
          editItems(s, (items) => items.filter((i) => i.id !== id), {
            selectedId: s.selectedId === id ? null : s.selectedId,
          }),
        ),

      shiftItem: (id, by) =>
        set((s) =>
          editItems(s, (items) => {
            const from = items.findIndex((i) => i.id === id);
            const to = from + by;
            if (from < 0 || to < 0 || to >= items.length) return items;
            const next = [...items];
            [next[from], next[to]] = [next[to], next[from]];
            return next;
          }),
        ),

      // the waypoints change places; every other item stays where it is in the list
      reverseRoute: () =>
        set((s) =>
          editItems(s, (items) => {
            const way = items.filter((i) => i.kind === 'waypoint').reverse();
            let n = 0;
            return items.map((i) => (i.kind === 'waypoint' ? way[n++] : i));
          }),
        ),

      setEveryHeight: (height, ref) =>
        set((s) =>
          editItems(s, (items) =>
            items.map((i) => (i.kind === 'waypoint' ? { ...i, height, heightRef: ref } : i)),
          ),
        ),

      shiftEveryHeight: (by) =>
        set((s) =>
          editItems(s, (items) =>
            items.map((i) =>
              (i.kind === 'waypoint' || i.kind === 'takeoff') && i.height !== null
                ? { ...i, height: Math.round((i.height + by) * 100) / 100 }
                : i,
            ),
          ),
        ),

      save: () => {
        const s = get();
        if (!s.mission) return;
        const id = s.loadedId ?? uid('mission');
        const entry: SavedMission = { id, savedAt: Date.now(), mission: structuredClone(s.mission) };
        set({
          saved: [entry, ...s.saved.filter((m) => m.id !== id)].slice(0, SAVED_LIMIT),
          loadedId: id,
          sampleId: null,
          dirty: false,
        });
      },

      load: (id) => {
        const entry = get().saved.find((m) => m.id === id);
        if (!entry) return;
        set((s) => ({
          ...change(s, structuredClone(entry.mission)),
          dirty: false,
          selectedId: null,
          loadedId: id,
          sampleId: null,
          tool: 'select',
          mapView: null,
          fitRequest: s.fitRequest + 1,
          notice: null,
        }));
      },

      deleteSaved: (id) =>
        set((s) => ({
          saved: s.saved.filter((m) => m.id !== id),
          loadedId: s.loadedId === id ? null : s.loadedId,
        })),

      setMapView: (center, zoom) => set({ mapView: { center, zoom } }),
      requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),
      dismissNotice: () => set({ notice: null }),
    }),
    {
      name: 'fc-missions',
      version: 1,
      partialize: (s) => ({
        mission: s.mission,
        view: s.view,
        exportFormat: s.exportFormat,
        djiAircraft: s.djiAircraft,
        saved: s.saved,
        loadedId: s.loadedId,
        sampleId: s.sampleId,
        dirty: s.dirty,
        mapView: s.mapView,
      }),
    },
  ),
);

export function useSelectedItem(): { item: MissionItem; number: number } | null {
  const mission = useMissionsStore((s) => s.mission);
  const selectedId = useMissionsStore((s) => s.selectedId);
  return useMemo(() => {
    const index = mission?.items.findIndex((i) => i.id === selectedId) ?? -1;
    return mission && index >= 0 ? { item: mission.items[index], number: index + 1 } : null;
  }, [mission, selectedId]);
}

export function useMissionStats(): MissionStats | null {
  const mission = useMissionsStore((s) => s.mission);
  return useMemo(() => (mission ? missionStats(mission) : null), [mission]);
}

export function useMissionChecks(): MissionCheck[] {
  const mission = useMissionsStore((s) => s.mission);
  return useMemo(() => (mission ? checkMission(mission) : []), [mission]);
}

/** The mission written in the chosen format, or the reason it cannot be. */
export function useWritten(): WriteAttempt | null {
  const mission = useMissionsStore((s) => s.mission);
  const format = useMissionsStore((s) => s.exportFormat);
  const djiAircraft = useMissionsStore((s) => s.djiAircraft);
  return useMemo(() => (mission ? tryWrite(mission, format, djiAircraft) : null), [mission, format, djiAircraft]);
}
