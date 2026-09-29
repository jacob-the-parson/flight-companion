// PlannerWorkspace — the center surface. Single-canvas archetype:
//   HeaderWorkspace [ identity · survey type · map tools ]
//   → the map (click to draw, drag a corner to move it, right-click to remove it)
//   → a strip of the five numbers that decide whether the plan is flyable.
'use client';
import { useMemo } from 'react';
import { Crosshair, Home, LocateFixed, Maximize2, PenLine, Route, Undo2 } from 'lucide-react';
import { MapView, type MapShape } from '@/components/shared/MapView';
import { HeaderWorkspace } from '@/components/ui/HeaderWorkspace';
import { SegmentedTrack } from '@/components/ui/SegmentedTrack';
import { MIN_DRAW_ZOOM, SURVEY_TYPES, type SurveyType } from '@/lib/planner/survey';
import { fmtArea, fmtDistance, fmtDuration, fmtNum } from '@/lib/units';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useSiteStore } from '@/stores/core/siteStore';
import { usePlannerStore, usePlanResult, useVertices } from '@/stores/domains/plannerStore';

const TOOL_BTN =
  'flex items-center gap-1.5 rounded-md border border-edge bg-control px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40';

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 px-3 py-2" title={hint}>
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="truncate font-mono text-sm text-ink">{value}</div>
    </div>
  );
}

export function PlannerWorkspace() {
  const name = usePlannerStore((s) => s.name);
  const surveyType = usePlannerStore((s) => s.surveyType);
  const vertices = useVertices();
  const home = usePlannerStore((s) => s.home);
  const params = usePlannerStore((s) => s.params);
  const tool = usePlannerStore((s) => s.tool);
  const view = usePlannerStore((s) => s.view);
  const fitRequest = usePlannerStore((s) => s.fitRequest);
  const setSurveyType = usePlannerStore((s) => s.setSurveyType);
  const setTool = usePlannerStore((s) => s.setTool);
  const mapClick = usePlannerStore((s) => s.mapClick);
  const moveVertex = usePlannerStore((s) => s.moveVertex);
  const removeVertex = usePlannerStore((s) => s.removeVertex);
  const undoVertex = usePlannerStore((s) => s.undoVertex);
  const setHome = usePlannerStore((s) => s.setHome);
  const setView = usePlannerStore((s) => s.setView);
  const requestFit = usePlannerStore((s) => s.requestFit);
  const lastTakeoff = useSiteStore((s) => s.lastTakeoff);
  const units = usePrefsStore((s) => s.units);
  const result = usePlanResult();

  const shapes = useMemo<MapShape[]>(() => {
    const out: MapShape[] = [];
    // the drawn input
    if (surveyType === 'orbit') {
      if (vertices[0]) {
        out.push({ kind: 'circle', id: 'orbit', center: vertices[0], radiusM: params.orbitRadius, color: 'series-1', dashed: true, fill: 0.06 });
      }
    } else if (surveyType === 'corridor') {
      out.push({ kind: 'polyline', id: 'centre', points: vertices, color: 'series-1', weight: 2, dashed: true });
    } else {
      out.push({ kind: 'polygon', id: 'area', points: vertices, color: 'series-1', weight: 2, fill: 0.1 });
    }
    // the flight path, and the legs to and from the takeoff point
    if (result.ok) {
      out.push({ kind: 'polyline', id: 'path', points: result.waypoints, color: 'series-2', weight: 2 });
      if (home && result.waypoints.length > 0) {
        out.push({
          kind: 'polyline',
          id: 'transit',
          points: [result.waypoints[result.waypoints.length - 1], home, result.waypoints[0]],
          color: 'muted',
          weight: 2,
          dashed: true,
        });
      }
      const first = result.waypoints[0];
      const last = result.waypoints[result.waypoints.length - 1];
      if (first) out.push({ kind: 'marker', id: 'start', at: first, color: 'series-2', label: 'S', title: 'First waypoint', style: 'pin' });
      if (last && last !== first && surveyType !== 'orbit' && surveyType !== 'perimeter') {
        out.push({ kind: 'marker', id: 'end', at: last, color: 'series-2', label: 'E', title: 'Last waypoint', style: 'pin' });
      }
    }
    vertices.forEach((v, i) =>
      out.push({
        kind: 'marker',
        id: `v${i}`,
        at: v,
        color: 'series-1',
        title: surveyType === 'orbit' ? 'Centre of the orbit. Drag to move.' : `Corner ${i + 1}. Drag to move, right-click to remove.`,
        draggable: true,
        style: 'dot',
        size: 14,
      }),
    );
    if (home) {
      out.push({ kind: 'marker', id: 'home', at: home, color: 'good', label: 'H', title: 'Takeoff point. Drag to move.', draggable: true, style: 'square' });
    }
    return out;
  }, [surveyType, vertices, home, params.orbitRadius, result]);

  const tooFarOut = (view?.zoom ?? 0) < MIN_DRAW_ZOOM;

  const typeOptions = SURVEY_TYPES.map((t) => ({ id: t.id, label: t.label, short: t.short, title: t.use }));
  const current = SURVEY_TYPES.find((t) => t.id === surveyType) ?? SURVEY_TYPES[0];

  const locate = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setView({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 17);
        setHome({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        requestFit();
      },
      () => undefined,
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <div className="flex h-full flex-col">
      <HeaderWorkspace
        icon={Route}
        iconClass="text-sky-600 dark:text-sky-400"
        title={name}
        subtitle={current.use}
        fit="wide"
        center={
          <SegmentedTrack
            ariaLabel="Survey type"
            options={typeOptions}
            value={surveyType}
            onChange={(id: SurveyType) => setSurveyType(id)}
          />
        }
        actions={
          <>
            <SegmentedTrack
              ariaLabel="What a click on the map does"
              size="sm"
              options={[
                { id: 'draw', label: 'Draw', icon: PenLine, title: 'A click on the map adds a point' },
                { id: 'home', label: 'Takeoff', icon: Home, title: 'The next click on the map sets the takeoff point' },
              ]}
              value={tool}
              onChange={setTool}
            />
            <button onClick={undoVertex} disabled={vertices.length === 0} className={TOOL_BTN} title="Remove the last point" aria-label="Remove the last point">
              <Undo2 size={13} />
            </button>
            <button onClick={requestFit} disabled={vertices.length === 0 && !home} className={TOOL_BTN} title="Frame the plan" aria-label="Frame the plan">
              <Maximize2 size={13} />
            </button>
            <button onClick={locate} className={TOOL_BTN} title="Go to where this device is and set the takeoff point there" aria-label="Go to where this device is">
              <LocateFixed size={13} />
            </button>
            {lastTakeoff && (
              <button
                onClick={() => {
                  setHome({ lat: lastTakeoff.lat, lng: lastTakeoff.lng });
                  setView({ lat: lastTakeoff.lat, lng: lastTakeoff.lng }, 18);
                  requestFit();
                }}
                className={TOOL_BTN}
                title={`Set the takeoff point where ${lastTakeoff.source} took off`}
              >
                <Crosshair size={13} /> <span className="whitespace-nowrap">From log</span>
              </button>
            )}
          </>
        }
      />

      <div className="relative min-h-0 flex-1">
        <MapView
          shapes={shapes}
          initialView={view}
          fitKey={fitRequest}
          cursor={tooFarOut ? 'grab' : 'crosshair'}
          onMapClick={mapClick}
          onViewChange={setView}
          onMarkerDrag={(id, p) => {
            if (id === 'home') setHome(p);
            else if (id.startsWith('v')) moveVertex(Number(id.slice(1)), p);
          }}
          onMarkerContext={(id) => {
            if (id === 'home') setHome(null);
            else if (id.startsWith('v')) removeVertex(Number(id.slice(1)));
          }}
        />

        {/* legend: identity is never colour alone */}
        <div className="pointer-events-none absolute right-3 top-3 z-[500] space-y-1 rounded-lg border border-edge bg-surface-raised/95 px-3 py-2 text-[11px] text-ink shadow-vibe-sm">
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-5 rounded-full bg-viz-1" /> Drawn {current.shape === 'line' ? 'line' : current.shape === 'point' ? 'centre' : 'area'}
          </div>
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-5 rounded-full bg-viz-2" /> Flight path
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-[3px] bg-status-good" /> Takeoff point
          </div>
        </div>

        {(tooFarOut || !result.ok || tool === 'home') && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[500] flex justify-center px-4">
            <div className="max-w-xl rounded-lg border border-edge bg-surface-raised/95 px-4 py-2 text-center text-xs text-ink shadow-vibe">
              {tooFarOut
                ? 'Zoom in to the flying site before drawing. The locate button goes to where this device is; after opening a log, "From log" goes to where it took off.'
                : tool === 'home'
                  ? 'Click the map where the aircraft will take off.'
                  : result.reason}
            </div>
          </div>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-2 divide-x divide-edge border-t border-edge sm:grid-cols-5">
        <Stat
          label="Ground detail"
          value={`${fmtNum(result.footprint.gsdCm, 2)} cm/px`}
          hint="Ground sample distance: the size on the ground of one pixel"
        />
        <Stat label="Area" value={result.ok ? fmtArea(result.areaM2, units) : 'n/a'} />
        <Stat label="Lines · photos" value={result.ok ? `${result.lines} · ${result.photos}` : 'n/a'} />
        <Stat label="Distance" value={result.ok ? fmtDistance(result.totalLength, units) : 'n/a'} hint="Survey pattern plus the flight to and from the takeoff point" />
        <Stat label="Flight time" value={result.ok ? fmtDuration(result.flightTime) : 'n/a'} hint="Includes climb, turns and descent" />
      </div>
    </div>
  );
}
