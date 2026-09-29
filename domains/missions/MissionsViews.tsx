// The four views of a mission:
//   MissionsMap     — the route on the map; click, drag, right-click
//   MissionsItems   — every item as a row, in the order it is flown
//   MissionsFile    — the file itself, as the chosen format writes it
//   MissionsConvert — what each format can hold, and what this one would drop
'use client';
import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Download, GraduationCap, Home, MousePointer2, PenLine, Trash2 } from 'lucide-react';
import { SegmentedTrack } from '@/components/ui/SegmentedTrack';
import { MapView, type MapShape } from '@/components/shared/MapView';
import { fileParts } from '@/lib/mission/brief';
import { FORMATS, formatById } from '@/lib/mission/formats';
import {
  describeItem,
  flownPoints,
  hasPosition,
  HEIGHT_REF_LABEL,
  ITEM_LABEL,
  type Mission,
  type MissionItem,
} from '@/lib/mission/model';
import { FORMAT_READING } from '@/lib/mission/samples';
import { fmtAltitude, fmtDistance, fmtDuration } from '@/lib/units';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { MIN_EDIT_ZOOM, useMissionsStore, useMissionStats, useWritten, type MissionTool } from '@/stores/domains/missionsStore';
import { ACCENT, DjiAircraftSelect, downloadWritten, FormatSelect, HoldsCell, ReportCard, TOOL_BTN } from './MissionsParts';

const TOOLS: { id: MissionTool; label: string; icon: typeof Home; title: string }[] = [
  { id: 'select', label: 'Select', icon: MousePointer2, title: 'A click selects. Drag a point to move it.' },
  { id: 'add', label: 'Add', icon: PenLine, title: 'A click on the map adds a waypoint' },
  { id: 'home', label: 'Takeoff', icon: Home, title: 'The next click on the map sets the takeoff point' },
];

/** Above this many waypoints the map draws dots; numbers would cover the route. */
const NUMBERED_LIMIT = 60;

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 px-3 py-2" title={hint}>
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="truncate font-mono text-sm text-ink">{value}</div>
    </div>
  );
}

function shapesOf(mission: Mission, selectedId: string | null): MapShape[] {
  const out: MapShape[] = [];
  mission.areas.forEach((a, i) =>
    out.push({
      kind: 'polygon',
      id: `area${i}`,
      points: a.points,
      color: a.role === 'keep-out' ? 'series-4' : 'series-1',
      weight: 2,
      dashed: a.role !== 'survey',
      fill: a.role === 'keep-out' ? 0.18 : a.role === 'survey' ? 0.08 : 0,
    }),
  );
  mission.circles.forEach((c, i) =>
    out.push({
      kind: 'circle',
      id: `circle${i}`,
      center: c.center,
      radiusM: c.radiusM,
      color: c.role === 'keep-out' ? 'series-4' : 'series-1',
      dashed: true,
      fill: c.role === 'keep-out' ? 0.18 : 0,
    }),
  );

  const flown = flownPoints(mission);
  out.push({ kind: 'polyline', id: 'route', points: flown, color: 'series-2', weight: 2 });
  if (mission.home && flown.length > 0) {
    const last = mission.items[mission.items.length - 1];
    out.push({
      kind: 'polyline',
      id: 'out',
      points: [mission.home, flown[0]],
      color: 'muted',
      weight: 2,
      dashed: true,
    });
    if (last?.kind === 'return') {
      out.push({
        kind: 'polyline',
        id: 'back',
        points: [flown[flown.length - 1], mission.home],
        color: 'muted',
        weight: 2,
        dashed: true,
      });
    }
  }

  const numbered = flown.length <= NUMBERED_LIMIT;
  mission.items.forEach((item, i) => {
    if (!hasPosition(item)) return;
    if (item.kind !== 'waypoint' && item.kind !== 'roi' && item.lat === 0 && item.lng === 0) return;
    const selected = item.id === selectedId;
    const at = { lat: item.lat, lng: item.lng };
    const title = `${i + 1}. ${describeItem(item)}. Drag to move, right-click to remove.`;
    if (item.kind === 'roi') {
      out.push({ kind: 'marker', id: `i:${item.id}`, at, color: 'series-3', label: 'P', title, draggable: true, style: 'pin', selected });
    } else if (item.kind === 'waypoint') {
      out.push({
        kind: 'marker',
        id: `i:${item.id}`,
        at,
        color: 'series-2',
        title,
        draggable: true,
        selected,
        ...(numbered || selected ? { style: 'pin', label: String(i + 1), size: i + 1 > 99 ? 26 : 22 } : { style: 'dot', size: 10 }),
      });
    } else {
      out.push({
        kind: 'marker',
        id: `i:${item.id}`,
        at,
        color: 'series-2',
        label: item.kind === 'takeoff' ? 'T' : 'L',
        title,
        draggable: true,
        style: 'pin',
        selected,
      });
    }
  });
  mission.rally.forEach((r, i) =>
    out.push({ kind: 'marker', id: `rally${i}`, at: r, color: 'muted', label: 'R', title: `Rally point, ${r.height} m ${HEIGHT_REF_LABEL[r.heightRef]}`, style: 'pin' }),
  );
  if (mission.home) {
    out.push({ kind: 'marker', id: 'home', at: mission.home, color: 'good', label: 'H', title: 'Takeoff point. Drag to move.', draggable: true, style: 'square' });
  }
  return out;
}

export function MissionsMap() {
  const mission = useMissionsStore((s) => s.mission);
  const selectedId = useMissionsStore((s) => s.selectedId);
  const tool = useMissionsStore((s) => s.tool);
  const mapView = useMissionsStore((s) => s.mapView);
  const fitRequest = useMissionsStore((s) => s.fitRequest);
  const mapClick = useMissionsStore((s) => s.mapClick);
  const moveItem = useMissionsStore((s) => s.moveItem);
  const removeItem = useMissionsStore((s) => s.removeItem);
  const setHome = useMissionsStore((s) => s.setHome);
  const select = useMissionsStore((s) => s.select);
  const setTool = useMissionsStore((s) => s.setTool);
  const setMapView = useMissionsStore((s) => s.setMapView);
  const units = usePrefsStore((s) => s.units);
  const stats = useMissionStats();

  const shapes = useMemo(() => (mission ? shapesOf(mission, selectedId) : []), [mission, selectedId]);
  const placing = tool !== 'select';
  const tooFarOut = placing && (mapView?.zoom ?? 0) < MIN_EDIT_ZOOM;

  const has = {
    fence: !!mission && (mission.areas.some((a) => a.role === 'keep-in') || mission.circles.some((c) => c.role === 'keep-in')),
    keepOut: !!mission && (mission.areas.some((a) => a.role === 'keep-out') || mission.circles.some((c) => c.role === 'keep-out')),
    survey: !!mission && mission.areas.some((a) => a.role === 'survey'),
    poi: !!mission && mission.items.some((i) => i.kind === 'roi' && i.lat !== null),
    rally: !!mission && mission.rally.length > 0,
    home: !!mission?.home,
  };

  const message = tooFarOut
    ? 'Zoom in to the flying site before placing a point.'
    : tool === 'home'
      ? 'Click the map where the aircraft will take off.'
      : tool === 'add'
        ? selectedId
          ? 'Click the map to add a waypoint after the selected item.'
          : 'Click the map to add a waypoint at the end of the route.'
        : null;

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <MapView
          shapes={shapes}
          initialView={mapView}
          fitKey={fitRequest}
          cursor={placing && !tooFarOut ? 'crosshair' : 'grab'}
          onMapClick={mapClick}
          onViewChange={setMapView}
          onMarkerClick={(id) => {
            if (id.startsWith('i:')) select(id.slice(2));
          }}
          onMarkerDrag={(id, p) => {
            if (id === 'home') setHome(p);
            else if (id.startsWith('i:')) moveItem(id.slice(2), p);
          }}
          onMarkerContext={(id) => {
            if (id.startsWith('i:')) removeItem(id.slice(2));
          }}
        />

        {/* what a click does: on the map, where the click happens. Zoom is top left. */}
        <div className="absolute right-3 top-3 z-[500] max-w-[calc(100%-4.5rem)] rounded-lg shadow-vibe-sm">
          <SegmentedTrack ariaLabel="What a click on the map does" size="sm" options={TOOLS} value={tool} onChange={setTool} />
        </div>

        {/* legend: identity is never colour alone */}
        <div className="pointer-events-none absolute right-3 top-14 z-[500] space-y-1 rounded-lg border border-edge bg-surface-raised/95 px-3 py-2 text-[11px] text-ink shadow-vibe-sm">
          <div className="flex items-center gap-2">
            <span className="h-0.5 w-5 rounded-full bg-viz-2" /> Route, numbered in the order flown
          </div>
          {has.home && (
            <div className="flex items-center gap-2">
              <span className="ml-1 h-3 w-3 rounded-[3px] bg-status-good" />
              <span className="ml-1">Takeoff point (H)</span>
            </div>
          )}
          {has.survey && (
            <div className="flex items-center gap-2">
              <span className="h-0.5 w-5 rounded-full bg-viz-1" /> Area to cover
            </div>
          )}
          {has.fence && (
            <div className="flex items-center gap-2">
              <span className="w-5 border-t-2 border-dashed border-viz-1" /> Fence: stay inside
            </div>
          )}
          {has.keepOut && (
            <div className="flex items-center gap-2">
              <span className="w-5 border-t-2 border-dashed border-viz-4" /> Fence: stay out
            </div>
          )}
          {has.poi && (
            <div className="flex items-center gap-2">
              <span className="ml-1 h-3 w-3 rounded-full bg-viz-3" />
              <span className="ml-1">Point of interest (P)</span>
            </div>
          )}
          {has.rally && (
            <div className="flex items-center gap-2">
              <span className="ml-1 h-3 w-3 rounded-full bg-ink-muted" />
              <span className="ml-1">Rally point (R)</span>
            </div>
          )}
        </div>

        {message && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-[500] flex justify-center px-4">
            <div className="max-w-xl rounded-lg border border-edge bg-surface-raised/95 px-4 py-2 text-center text-xs text-ink shadow-vibe">
              {message}
            </div>
          </div>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-2 divide-x divide-edge border-t border-edge sm:grid-cols-5">
        <Stat label="Items · waypoints" value={stats ? `${stats.items} · ${stats.waypoints}` : 'n/a'} />
        <Stat
          label="Length"
          value={stats && stats.lengthM > 0 ? fmtDistance(stats.lengthM, units) : 'n/a'}
          hint="Along the route, from the takeoff point and back to it when the mission ends with a return"
        />
        <Stat
          label="Lowest · highest"
          value={
            stats && stats.lowest !== null && stats.highest !== null
              ? `${fmtAltitude(stats.lowest, units, 0)} · ${fmtAltitude(stats.highest, units, 0)}`
              : 'n/a'
          }
          hint={
            stats && stats.heightRefs.length > 1
              ? 'These heights are measured from more than one reference, so lowest and highest may not compare'
              : stats?.heightRefs[0]
                ? `Measured ${HEIGHT_REF_LABEL[stats.heightRefs[0]]}`
                : 'No waypoint has a height'
          }
        />
        <Stat
          label="Farthest"
          value={stats && stats.farthestFromHomeM !== null ? fmtDistance(stats.farthestFromHomeM, units) : 'n/a'}
          hint="Straight-line distance of the farthest point from the takeoff point"
        />
        <Stat
          label="Time"
          value={stats && stats.timeS !== null ? fmtDuration(stats.timeS) : 'n/a'}
          hint="At the speeds the mission states, plus its waits. No climb, no turns, no wind."
        />
      </div>
    </div>
  );
}

function heightText(item: MissionItem): string {
  if (item.kind === 'waypoint' || item.kind === 'takeoff') return item.height === null ? '' : String(item.height);
  if (item.kind === 'roi') return item.height === null ? '' : String(item.height);
  return '';
}

export function MissionsItems() {
  const mission = useMissionsStore((s) => s.mission);
  const selectedId = useMissionsStore((s) => s.selectedId);
  const select = useMissionsStore((s) => s.select);
  const shiftItem = useMissionsStore((s) => s.shiftItem);
  const removeItem = useMissionsStore((s) => s.removeItem);
  if (!mission) return null;

  if (mission.items.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-ink-muted">
        The mission has no items yet. Switch to the map and choose Add, or add a takeoff from the Mission
        page of the tools drawer.
      </p>
    );
  }
  const th = 'sticky top-0 z-10 border-b border-edge bg-surface-raised px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-muted';
  const icon = 'rounded p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink disabled:opacity-30';

  return (
    <div className="h-full overflow-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-0 text-xs">
        <caption className="sr-only">Mission items in the order they are flown</caption>
        <thead>
          <tr>
            <th className={`${th} w-10 text-right`}>#</th>
            <th className={th}>Item</th>
            <th className={`${th} text-right`}>Latitude</th>
            <th className={`${th} text-right`}>Longitude</th>
            <th className={`${th} text-right`}>Height, m</th>
            <th className={th}>Measured</th>
            <th className={th}>What it does</th>
            <th className={`${th} w-24`}>
              <span className="sr-only">Move and remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {mission.items.map((item, i) => {
            const active = item.id === selectedId;
            const placed = hasPosition(item) && !(item.kind !== 'waypoint' && item.lat === 0 && item.lng === 0);
            const td = `border-b border-edge px-3 py-1.5 ${active ? 'bg-teal-50/70 dark:bg-teal-950/30' : ''}`;
            return (
              <tr
                key={item.id}
                onClick={() => select(item.id)}
                aria-selected={active}
                className="cursor-pointer transition-colors hover:bg-control/60"
              >
                <td className={`${td} text-right font-mono text-ink-muted`}>{i + 1}</td>
                <td className={`${td} font-medium text-ink`}>
                  {ITEM_LABEL[item.kind]}
                  {item.kind === 'waypoint' && item.name ? <span className="ml-1.5 font-normal text-ink-muted">{item.name}</span> : null}
                </td>
                <td className={`${td} text-right font-mono text-ink`}>{placed && hasPosition(item) ? item.lat.toFixed(7) : ''}</td>
                <td className={`${td} text-right font-mono text-ink`}>{placed && hasPosition(item) ? item.lng.toFixed(7) : ''}</td>
                <td className={`${td} text-right font-mono text-ink`}>
                  {item.kind === 'waypoint' && item.height === null ? (
                    <span className="font-sans text-status-critical">none</span>
                  ) : (
                    heightText(item)
                  )}
                </td>
                <td className={`${td} text-ink-muted`}>
                  {(item.kind === 'waypoint' || item.kind === 'takeoff') && item.height !== null ? HEIGHT_REF_LABEL[item.heightRef] : ''}
                </td>
                <td className={`${td} text-ink-muted`}>{describeItem(item)}</td>
                <td className={td}>
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      className={icon}
                      disabled={i === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        shiftItem(item.id, -1);
                      }}
                      title="Earlier in the mission"
                      aria-label={`Move item ${i + 1} earlier`}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      className={icon}
                      disabled={i === mission.items.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        shiftItem(item.id, 1);
                      }}
                      title="Later in the mission"
                      aria-label={`Move item ${i + 1} later`}
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      className={`${icon} hover:text-red-500`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeItem(item.id);
                      }}
                      title="Remove. Undo brings it back."
                      aria-label={`Remove item ${i + 1}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Text longer than this is cut in the File view; the download is always whole. */
const PREVIEW_LIMIT = 300_000;

function FormatBar() {
  const format = useMissionsStore((s) => s.exportFormat);
  const written = useWritten();
  return (
    <div className="flex shrink-0 flex-wrap items-end gap-3 border-b border-edge px-4 py-3">
      <label className="w-64 max-w-full space-y-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Format</span>
        <FormatSelect />
      </label>
      {format === 'dji-wpml' && (
        <label className="w-64 max-w-full space-y-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-muted">For the aircraft</span>
          <DjiAircraftSelect />
        </label>
      )}
      <button
        disabled={!written?.ok}
        onClick={() => written?.ok && downloadWritten(written.file)}
        className={`${TOOL_BTN} py-2`}
      >
        <Download size={13} className="text-green-600 dark:text-green-500" />
        {written?.ok ? written.file.name : 'Download'}
      </button>
    </div>
  );
}

function CannotWrite({ reason }: { reason: string }) {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-lg rounded-lg border border-amber-300 bg-amber-50/70 p-4 text-sm text-ink dark:border-amber-800 dark:bg-amber-950/30">
        <p className="font-semibold">This mission cannot be written in this format yet</p>
        <p className="mt-1 text-ink-muted">{reason}</p>
      </div>
    </div>
  );
}

export function MissionsFile() {
  const format = useMissionsStore((s) => s.exportFormat);
  const learn = usePrefsStore((s) => s.learn);
  const written = useWritten();
  const parts = useMemo(() => (written?.ok ? fileParts(written.file) : []), [written]);
  const f = formatById(format);

  return (
    <div className="flex h-full flex-col">
      <FormatBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-4 p-4">
          <p className="max-w-3xl text-xs leading-snug text-ink-muted">
            <span className="font-semibold text-ink">{f.label}.</span> {f.about} Read by: {f.usedBy}. Definition taken
            from: {f.source}.
          </p>

          {learn && (
            <aside className="max-w-3xl rounded-lg border border-edge bg-control/50 p-3">
              <h3 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
                <GraduationCap size={13} className={ACCENT.text} /> How to read this file
              </h3>
              <ul className="list-disc space-y-1 pl-4 text-xs leading-snug text-ink">
                {FORMAT_READING[format].map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </aside>
          )}

          {written && !written.ok && <CannotWrite reason={written.reason} />}

          {parts.map((part) => {
            const cut = part.text.length > PREVIEW_LIMIT;
            const text = cut ? part.text.slice(0, PREVIEW_LIMIT) : part.text;
            return (
              <section key={part.name} className="overflow-hidden rounded-lg border border-edge">
                <h3 className="flex items-center justify-between gap-3 border-b border-edge bg-control/60 px-3 py-1.5 font-mono text-[11px] text-ink">
                  <span className="truncate">{part.name}</span>
                  <span className="shrink-0 text-ink-muted">
                    {part.text.split('\n').length - (part.text.endsWith('\n') ? 1 : 0)} lines
                  </span>
                </h3>
                <pre className="max-h-[70vh] overflow-auto bg-surface-sunken p-3 font-mono text-[11px] leading-relaxed text-ink">
                  {text}
                </pre>
                {cut && (
                  <p className="border-t border-edge px-3 py-1.5 text-[11px] text-ink-muted">
                    The beginning of the file is shown. The download holds all of it.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const COLUMNS = [
  ['heights', 'Heights to fly at'],
  ['speeds', 'Speeds'],
  ['commands', 'Commands'],
  ['actions', 'Waypoint actions'],
  ['geofence', 'Fences'],
  ['names', 'Names'],
] as const;

export function MissionsConvert() {
  const mission = useMissionsStore((s) => s.mission);
  const format = useMissionsStore((s) => s.exportFormat);
  const setExportFormat = useMissionsStore((s) => s.setExportFormat);
  const written = useWritten();
  if (!mission) return null;
  const from = mission.source ? formatById(mission.source) : null;
  const th = 'border-b border-edge px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-muted';

  return (
    <div className="flex h-full flex-col">
      <FormatBar />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 p-4">
          <section className="space-y-2">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">What each format can hold</h2>
            <p className="text-xs leading-snug text-ink-muted">
              {from ? `This mission was read from a ${from.label.toLowerCase()}. ` : 'This mission was made in the app. '}
              A format can only keep what it has a place for. Choose a row to see what it would do to this mission.
            </p>
            <div className="overflow-x-auto rounded-lg border border-edge">
              <table className="w-full min-w-[720px] border-separate border-spacing-0 text-xs">
                <caption className="sr-only">What each file format can hold</caption>
                <thead>
                  <tr className="bg-control/60">
                    <th className={th}>Format</th>
                    <th className={th}>An aircraft can fly it</th>
                    {COLUMNS.map(([, label]) => (
                      <th key={label} className={th}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FORMATS.map((f) => {
                    const active = f.id === format;
                    const td = `border-b border-edge px-3 py-2 ${active ? 'bg-teal-50/70 dark:bg-teal-950/30' : ''}`;
                    return (
                      <tr
                        key={f.id}
                        onClick={() => setExportFormat(f.id)}
                        aria-selected={active}
                        className="cursor-pointer transition-colors hover:bg-control/60"
                      >
                        <td className={`${td} font-medium text-ink`}>
                          {f.label} <span className="font-mono font-normal text-ink-muted">.{f.extensions[0]}</span>
                        </td>
                        <td className={td}>
                          <HoldsCell value={f.flyable ? 'yes' : 'no'} />
                        </td>
                        {COLUMNS.map(([key]) => (
                          <td key={key} className={td}>
                            <HoldsCell value={f.holds[key]} />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">
              This mission as a {formatById(format).label.toLowerCase()}
            </h2>
            {written && !written.ok && <CannotWrite reason={written.reason} />}
            {written?.ok && (
              <div className="rounded-lg border border-edge bg-surface-raised p-4">
                <ReportCard report={written.file.report} />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
