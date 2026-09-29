// Planner domain store — the plan being drawn, its camera and numbers, and the
// saved plans. The flight path itself is never stored: it is derived from these
// inputs by usePlanResult(), so it can never disagree with them. Persisted.
//
// Each KIND OF SHAPE keeps its own points: the area (grid, crosshatch,
// perimeter), the line (corridor) and the centre (orbit). Switching survey type
// shows a different shape; it never throws one away.
import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CAMERA_PRESETS, CUSTOM_CAMERA_ID, DEFAULT_CAMERA, type Camera } from '@/lib/planner/cameras';
import { centroid, type LatLng } from '@/lib/planner/geo';
import {
  DEFAULT_PARAMS,
  MIN_DRAW_ZOOM,
  planSurvey,
  type PlanResult,
  type SurveyParams,
  type SurveyType,
} from '@/lib/planner/survey';
import { enduranceMinutes, useActiveAircraft } from '@/stores/core/aircraftStore';
import { uid } from '@/lib/units';

export type MapTool = 'draw' | 'home';
export type ShapeKind = 'area' | 'line' | 'centre';

export interface PlanShapes {
  area: LatLng[];
  line: LatLng[];
  centre: LatLng[];
}

export function shapeKind(type: SurveyType): ShapeKind {
  return type === 'corridor' ? 'line' : type === 'orbit' ? 'centre' : 'area';
}

export interface PlanSnapshot {
  name: string;
  surveyType: SurveyType;
  shapes: PlanShapes;
  home: LatLng | null;
  params: SurveyParams;
  camera: Camera;
}

export interface SavedPlan extends PlanSnapshot {
  id: string;
  savedAt: number;
}

interface PlannerState extends PlanSnapshot {
  tool: MapTool;
  saved: SavedPlan[];
  /** Id of the saved plan the working plan came from, if any. */
  loadedId: string | null;
  view: { center: LatLng; zoom: number } | null;
  /** Bumped to ask the map to frame the plan. */
  fitRequest: number;

  setName: (name: string) => void;
  setSurveyType: (t: SurveyType) => void;
  setTool: (t: MapTool) => void;
  mapClick: (p: LatLng) => void;
  moveVertex: (index: number, p: LatLng) => void;
  removeVertex: (index: number) => void;
  undoVertex: () => void;
  setHome: (p: LatLng | null) => void;
  setParam: <K extends keyof SurveyParams>(key: K, value: SurveyParams[K]) => void;
  setCameraPreset: (id: string) => void;
  setCameraField: <K extends keyof Camera>(key: K, value: Camera[K]) => void;
  setView: (center: LatLng, zoom: number) => void;
  requestFit: () => void;
  clearPlan: () => void;
  savePlan: () => void;
  loadPlan: (id: string) => void;
  deletePlan: (id: string) => void;
}

const NO_SHAPES: PlanShapes = { area: [], line: [], centre: [] };

const BLANK: PlanSnapshot = {
  name: 'Untitled plan',
  surveyType: 'grid',
  shapes: NO_SHAPES,
  home: null,
  params: DEFAULT_PARAMS,
  camera: DEFAULT_CAMERA,
};

/** Change the points of the shape the current survey type uses. */
function edit(s: PlannerState, fn: (points: LatLng[]) => LatLng[]): Partial<PlannerState> {
  const kind = shapeKind(s.surveyType);
  return { shapes: { ...s.shapes, [kind]: fn(s.shapes[kind]) } };
}

function hasPoints(shapes: PlanShapes): boolean {
  return shapes.area.length + shapes.line.length + shapes.centre.length > 0;
}

export const usePlannerStore = create<PlannerState>()(
  persist(
    (set, get) => ({
      ...BLANK,
      tool: 'draw',
      saved: [],
      loadedId: null,
      view: null,
      fitRequest: 0,

      setName: (name) => set({ name }),
      setSurveyType: (surveyType) =>
        set((s) => {
          // the first visit to Orbit starts at the middle of the drawn area
          if (surveyType === 'orbit' && s.shapes.centre.length === 0 && s.shapes.area.length >= 3) {
            return { surveyType, shapes: { ...s.shapes, centre: [centroid(s.shapes.area)] } };
          }
          return { surveyType };
        }),
      setTool: (tool) => set({ tool }),

      mapClick: (p) =>
        set((s) => {
          // zoomed out, a click cannot place a corner to within a field's width
          if ((s.view?.zoom ?? 0) < MIN_DRAW_ZOOM) return s;
          if (s.tool === 'home') return { home: p, tool: 'draw' };
          return edit(s, (pts) => (s.surveyType === 'orbit' ? [p] : [...pts, p]));
        }),
      moveVertex: (index, p) => set((s) => edit(s, (pts) => pts.map((v, i) => (i === index ? p : v)))),
      removeVertex: (index) => set((s) => edit(s, (pts) => pts.filter((_, i) => i !== index))),
      undoVertex: () => set((s) => edit(s, (pts) => pts.slice(0, -1))),
      setHome: (home) => set({ home }),

      setParam: (key, value) => set((s) => ({ params: { ...s.params, [key]: value } })),
      setCameraPreset: (id) => {
        if (id === CUSTOM_CAMERA_ID) {
          set((s) => ({
            camera: { ...s.camera, id: CUSTOM_CAMERA_ID, name: 'Custom camera', source: 'entered by hand' },
          }));
          return;
        }
        const preset = CAMERA_PRESETS.find((c) => c.id === id);
        if (preset) set({ camera: { ...preset } });
      },
      // editing any number makes it a custom camera: a preset is only a preset
      // while it matches the manufacturer's figures
      setCameraField: (key, value) =>
        set((s) => ({
          camera: {
            ...s.camera,
            [key]: value,
            ...(key === 'name' ? null : { id: CUSTOM_CAMERA_ID, source: 'entered by hand' }),
          },
        })),

      setView: (center, zoom) => set({ view: { center, zoom } }),
      requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1 })),

      clearPlan: () => set({ shapes: NO_SHAPES, home: null, loadedId: null, name: BLANK.name, tool: 'draw' }),

      savePlan: () => {
        const s = get();
        if (!hasPoints(s.shapes)) return;
        const snapshot: PlanSnapshot = {
          name: s.name,
          surveyType: s.surveyType,
          shapes: s.shapes,
          home: s.home,
          params: s.params,
          camera: s.camera,
        };
        const id = s.loadedId ?? uid('plan');
        const plan: SavedPlan = { ...structuredClone(snapshot), id, savedAt: Date.now() };
        set({ saved: [plan, ...s.saved.filter((p) => p.id !== id)].slice(0, 100), loadedId: id });
      },
      loadPlan: (id) => {
        const plan = get().saved.find((p) => p.id === id);
        if (!plan) return;
        const copy = structuredClone(plan);
        set((s) => ({
          name: copy.name,
          surveyType: copy.surveyType,
          shapes: copy.shapes,
          home: copy.home,
          params: copy.params,
          camera: copy.camera,
          loadedId: id,
          tool: 'draw',
          fitRequest: s.fitRequest + 1,
        }));
      },
      deletePlan: (id) =>
        set((s) => ({
          saved: s.saved.filter((p) => p.id !== id),
          loadedId: s.loadedId === id ? null : s.loadedId,
        })),
    }),
    {
      name: 'fc-planner',
      version: 2,
      // version 1 kept one list of points for every survey type
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Record<string, unknown>;
        if (version >= 2) return state;
        const lift = (plan: Record<string, unknown>) => {
          const points = Array.isArray(plan.vertices) ? (plan.vertices as LatLng[]) : [];
          const kind = shapeKind((plan.surveyType as SurveyType) ?? 'grid');
          const { vertices: _old, ...rest } = plan;
          void _old;
          return { ...rest, shapes: { ...NO_SHAPES, [kind]: points } };
        };
        const lifted = lift(state);
        const saved = Array.isArray(state.saved) ? (state.saved as Record<string, unknown>[]).map(lift) : [];
        return { ...lifted, saved };
      },
      partialize: (s) => ({
        name: s.name,
        surveyType: s.surveyType,
        shapes: s.shapes,
        home: s.home,
        params: s.params,
        camera: s.camera,
        saved: s.saved,
        loadedId: s.loadedId,
        view: s.view,
      }),
    },
  ),
);

/** The points of the shape the current survey type uses. */
export function useVertices(): LatLng[] {
  return usePlannerStore((s) => s.shapes[shapeKind(s.surveyType)]);
}

/** The flight path and its numbers, derived from the plan and the active aircraft. */
export function usePlanResult(): PlanResult {
  const surveyType = usePlannerStore((s) => s.surveyType);
  const vertices = useVertices();
  const home = usePlannerStore((s) => s.home);
  const params = usePlannerStore((s) => s.params);
  const camera = usePlannerStore((s) => s.camera);
  const aircraft = useActiveAircraft();
  const enduranceMin = enduranceMinutes(aircraft);

  return useMemo(
    () => planSurvey({ type: surveyType, vertices, home, camera, params, enduranceMin }),
    [surveyType, vertices, home, camera, params, enduranceMin],
  );
}
