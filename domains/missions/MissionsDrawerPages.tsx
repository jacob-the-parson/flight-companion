// Missions right-drawer pages (zero-prop, store-connected):
//   MissionsItemPage    — the selected item: where, how high, what it does
//   MissionsMissionPage — the whole mission: name, takeoff point, every height
//   MissionsChecksPage  — what stands out, worst first
//   MissionsExportPage  — choose a format, read what it drops, download
'use client';
import { Download, Plus, Trash2 } from 'lucide-react';
import { DrawerField, DrawerSection, DrawerStat } from '@/components/ui/DrawerSection';
import { FieldNumber } from '@/components/ui/FieldNumber';
import { INPUT_CLASS } from '@/components/shell/ModalProfile';
import { formatById } from '@/lib/mission/formats';
import { frameLabel } from '@/lib/mission/mavlink';
import { MAV_CMD } from '@/lib/mission/mavlinkCommands';
import {
  describeItem,
  HEIGHT_REF_LABEL,
  ITEM_LABEL,
  type HeightRef,
  type MissionAction,
  type MissionItem,
  type WaypointItem,
} from '@/lib/mission/model';
import { fmtAltitude, fmtDistance, fmtDuration } from '@/lib/units';
import { usePrefsStore } from '@/stores/core/prefsStore';
import {
  useMissionChecks,
  useMissionsStore,
  useMissionStats,
  useSelectedItem,
  useWritten,
  type AddableKind,
} from '@/stores/domains/missionsStore';
import {
  ACCENT,
  BTN,
  CheckCard,
  CopyBriefButton,
  DjiAircraftSelect,
  downloadWritten,
  FormatSelect,
  ReportCard,
} from './MissionsParts';

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="p-4 text-xs italic leading-snug text-ink-muted opacity-80">{children}</p>
);

// the references a person can choose; "unknown" is only ever read from a file
const REFS: HeightRef[] = ['home', 'amsl', 'ground', 'ellipsoid'];

function RefSelect({ value, onChange }: { value: HeightRef; onChange: (ref: HeightRef) => void }) {
  return (
    <DrawerField label="Measured">
      <select value={value} onChange={(e) => onChange(e.target.value as HeightRef)} className={INPUT_CLASS}>
        {value === 'unknown' && <option value="unknown">{HEIGHT_REF_LABEL.unknown}</option>}
        {REFS.map((r) => (
          <option key={r} value={r}>
            {HEIGHT_REF_LABEL[r]}
          </option>
        ))}
      </select>
    </DrawerField>
  );
}

function Position({ item, onChange }: { item: { lat: number; lng: number }; onChange: (p: { lat: number; lng: number }) => void }) {
  return (
    <>
      <FieldNumber label="Latitude" unit="°" min={-90} max={90} step={0.00001} value={item.lat} onChange={(lat) => onChange({ lat, lng: item.lng })} />
      <FieldNumber label="Longitude" unit="°" min={-180} max={180} step={0.00001} value={item.lng} onChange={(lng) => onChange({ lat: item.lat, lng })} />
    </>
  );
}

const ACTION_LABEL: Record<MissionAction['kind'], string> = {
  photo: 'Take a photo',
  'video-start': 'Start recording video',
  'video-stop': 'Stop recording video',
  hover: 'Hover',
  yaw: 'Turn to a heading',
  gimbal: 'Tilt the camera',
  raw: 'Other action',
};

function newAction(kind: MissionAction['kind']): MissionAction {
  switch (kind) {
    case 'hover':
      return { kind, seconds: 5 };
    case 'yaw':
      return { kind, headingDeg: 0 };
    case 'gimbal':
      return { kind, pitchDeg: -90, yawDeg: null };
    case 'raw':
      return { kind, name: 'action', params: {} };
    default:
      return { kind };
  }
}

function Actions({ item, save }: { item: WaypointItem; save: (next: WaypointItem) => void }) {
  const actions = item.actions ?? [];
  const put = (next: MissionAction[]) => {
    const { actions: _old, ...rest } = item;
    void _old;
    save(next.length > 0 ? { ...rest, actions: next } : rest);
  };
  const edit = (i: number, a: MissionAction) => put(actions.map((x, k) => (k === i ? a : x)));

  return (
    <DrawerSection title="When it gets there">
      {actions.length === 0 && <p className="text-[11px] text-ink-muted">Nothing. It flies on to the next item.</p>}
      {actions.map((a, i) => (
        <div key={i} className="space-y-2 rounded-md border border-edge bg-surface-raised/60 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-ink">
              {i + 1}. {a.kind === 'raw' ? a.name : ACTION_LABEL[a.kind]}
            </span>
            <button
              onClick={() => put(actions.filter((_, k) => k !== i))}
              className="rounded p-1 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
              title="Remove this action"
              aria-label={`Remove action ${i + 1}`}
            >
              <Trash2 size={13} />
            </button>
          </div>
          {a.kind === 'hover' && (
            <FieldNumber label="For" unit="s" min={0} max={3600} step={1} value={a.seconds} onChange={(seconds) => edit(i, { ...a, seconds })} />
          )}
          {a.kind === 'yaw' && (
            <FieldNumber label="Heading" unit="° from north" min={0} max={360} step={5} value={a.headingDeg} onChange={(headingDeg) => edit(i, { ...a, headingDeg })} />
          )}
          {a.kind === 'gimbal' && (
            <FieldNumber
              label="Camera tilt"
              unit="°"
              min={-120}
              max={45}
              step={5}
              value={a.pitchDeg ?? 0}
              onChange={(pitchDeg) => edit(i, { ...a, pitchDeg })}
              hint="0 looks at the horizon, −90 straight down."
            />
          )}
          {a.kind === 'raw' && (
            <p className="text-[11px] leading-snug text-ink-muted">
              Kept as the file had it, so it can be written back. The app has no word for it.
            </p>
          )}
        </div>
      ))}
      <select
        value=""
        onChange={(e) => {
          if (e.target.value) put([...actions, newAction(e.target.value as MissionAction['kind'])]);
        }}
        className={INPUT_CLASS}
        aria-label="Add an action"
      >
        <option value="">Add an action</option>
        {(['photo', 'hover', 'gimbal', 'yaw', 'video-start', 'video-stop'] as const).map((k) => (
          <option key={k} value={k}>
            {ACTION_LABEL[k]}
          </option>
        ))}
      </select>
      <p className="text-[11px] leading-snug text-ink-muted">
        A DJI route keeps actions as they are. A plan or a waypoint list turns them into commands after the
        waypoint, and has no command for a camera tilt.
      </p>
    </DrawerSection>
  );
}

/** A field that is either a number or not there at all. */
function Optional({
  label,
  unit,
  value,
  fallback,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  unit: string;
  value: number | undefined;
  fallback: number;
  min: number;
  max: number;
  step: number;
  hint: string;
  onChange: (v: number | undefined) => void;
}) {
  const on = value !== undefined;
  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-start gap-2 text-xs text-ink">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onChange(e.target.checked ? fallback : undefined)}
          className={`mt-0.5 h-3.5 w-3.5 ${ACCENT.check}`}
        />
        <span>
          {label}
          <span className="block text-[11px] text-ink-muted">{hint}</span>
        </span>
      </label>
      {on && <FieldNumber label={label} unit={unit} min={min} max={max} step={step} value={value} onChange={onChange} />}
    </div>
  );
}

function without<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const { [key]: _gone, ...rest } = obj;
  void _gone;
  return rest;
}

function WaypointFields({ item, save }: { item: WaypointItem; save: (next: MissionItem) => void }) {
  const set = <K extends 'speed' | 'holdS' | 'headingDeg'>(key: K, v: number | undefined) =>
    save(v === undefined ? (without(item, key) as WaypointItem) : { ...item, [key]: v });
  return (
    <>
      <DrawerSection title="Where" first>
        <DrawerField label="Name">
          <input
            value={item.name ?? ''}
            placeholder="No name"
            onChange={(e) => save(e.target.value ? { ...item, name: e.target.value } : (without(item, 'name') as WaypointItem))}
            className={INPUT_CLASS}
          />
        </DrawerField>
        <Position item={item} onChange={(p) => save({ ...item, ...p })} />
      </DrawerSection>

      <DrawerSection title="How high">
        {item.height === null ? (
          <>
            <p className="text-xs leading-snug text-ink">
              This waypoint has no height. The file it came from did not give one.
            </p>
            <button onClick={() => save({ ...item, height: 30, heightRef: 'home' })} className={BTN}>
              Give it 30 m above takeoff
            </button>
          </>
        ) : (
          <>
            <FieldNumber label="Height" unit="m" min={-500} max={9000} step={1} value={item.height} onChange={(height) => save({ ...item, height })} />
            <RefSelect value={item.heightRef} onChange={(heightRef) => save({ ...item, heightRef })} />
            <p className="text-[11px] leading-snug text-ink-muted">
              Changing what a height is measured from does not change the number. 30 m above takeoff and 30 m
              above sea level are different places.
            </p>
          </>
        )}
      </DrawerSection>

      <DrawerSection title="On the way">
        <Optional
          label="Wait here"
          unit="s"
          value={item.holdS}
          fallback={5}
          min={0}
          max={3600}
          step={1}
          hint="Seconds to stay before flying on."
          onChange={(v) => set('holdS', v)}
        />
        <Optional
          label="Hold a heading"
          unit="° from north"
          value={item.headingDeg}
          fallback={0}
          min={0}
          max={360}
          step={5}
          hint="Off: the aircraft points the way the autopilot chooses, usually along the route."
          onChange={(v) => set('headingDeg', v)}
        />
        <Optional
          label="Change speed from here"
          unit="m/s"
          value={item.speed}
          fallback={5}
          min={0.5}
          max={30}
          step={0.5}
          hint="Off: it keeps the speed it had."
          onChange={(v) => set('speed', v)}
        />
      </DrawerSection>

      <Actions item={item} save={save} />
    </>
  );
}

function RawFields({ item }: { item: Extract<MissionItem, { kind: 'raw' }> }) {
  const known = MAV_CMD[item.command];
  return (
    <DrawerSection title="A command kept as read" first>
      <p className="text-xs leading-snug text-ink">{known?.description ?? 'This command is not in MAVLink’s common set.'}</p>
      <DrawerStat label="MAVLink command" value={`${item.command}${known ? ` ${known.name}` : ''}`} />
      <DrawerStat label="Frame" value={`${item.frame} ${frameLabel(item.frame)}`} />
      {item.params.map((p, i) => (
        <DrawerStat key={i} label={`${i + 1}. ${known?.params[i + 1] ?? 'Parameter'}`} value={p === null ? 'not set' : String(p)} />
      ))}
      <p className="text-[11px] leading-snug text-ink-muted">
        The app carries this command through unchanged and writes it back exactly as it was read. It does not
        check what it does. Edit it in the ground station.
      </p>
    </DrawerSection>
  );
}

export function MissionsItemPage() {
  const selected = useSelectedItem();
  const replaceItem = useMissionsStore((s) => s.replaceItem);
  const removeItem = useMissionsStore((s) => s.removeItem);
  const hasMission = useMissionsStore((s) => s.mission !== null);
  if (!hasMission) return <Empty>Open a mission, or start one, to see its items here.</Empty>;
  if (!selected) return <Empty>Select an item on the map or in the Items view to edit it here.</Empty>;
  const { item, number } = selected;

  return (
    <div className="space-y-6 p-4">
      <header className="space-y-0.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-muted">
          Item {number} · {ITEM_LABEL[item.kind]}
        </p>
        <p className="text-sm font-medium leading-snug text-ink">{describeItem(item)}</p>
        {item.note && <p className="text-[11px] text-ink-muted">{item.note}</p>}
      </header>

      {item.kind === 'waypoint' && <WaypointFields item={item} save={replaceItem} />}

      {item.kind === 'takeoff' && (
        <DrawerSection title="Take off" first>
          <FieldNumber label="Climb to" unit="m" min={1} max={500} step={1} value={item.height} onChange={(height) => replaceItem({ ...item, height })} />
          <RefSelect value={item.heightRef} onChange={(heightRef) => replaceItem({ ...item, heightRef })} />
          <p className="text-[11px] leading-snug text-ink-muted">
            The aircraft takes off from wherever it is armed, and climbs to this height before the first
            waypoint.
          </p>
        </DrawerSection>
      )}

      {item.kind === 'land' && (
        <DrawerSection title="Land" first>
          <label className="flex cursor-pointer items-start gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={item.lat !== null && item.lng !== null}
              onChange={(e) => {
                const last = useMissionsStore.getState().mission?.items.filter((i): i is WaypointItem => i.kind === 'waypoint').pop();
                replaceItem(e.target.checked && last ? { ...item, lat: last.lat, lng: last.lng } : { ...item, lat: null, lng: null });
              }}
              className={`mt-0.5 h-3.5 w-3.5 ${ACCENT.check}`}
            />
            <span>
              Land at a chosen place
              <span className="block text-[11px] text-ink-muted">Off: it lands where it is when it reaches this item.</span>
            </span>
          </label>
          {item.lat !== null && item.lng !== null && (
            <Position item={{ lat: item.lat, lng: item.lng }} onChange={(p) => replaceItem({ ...item, ...p })} />
          )}
        </DrawerSection>
      )}

      {item.kind === 'return' && (
        <DrawerSection title="Return" first>
          <p className="text-xs leading-snug text-ink-muted">
            The aircraft flies back to where it took off and lands. How high it flies on the way, and whether
            it goes to a rally point instead, are parameters of the autopilot and not part of the mission.
          </p>
        </DrawerSection>
      )}

      {item.kind === 'speed' && (
        <DrawerSection title="Speed" first>
          <FieldNumber label="Fly at" unit="m/s" min={0.5} max={30} step={0.5} value={item.speed} onChange={(speed) => replaceItem({ ...item, speed })} />
        </DrawerSection>
      )}

      {item.kind === 'camera-distance' && (
        <DrawerSection title="Camera trigger" first>
          <FieldNumber
            label="A photo every"
            unit="m"
            min={0}
            max={1000}
            step={0.5}
            value={item.distanceM}
            onChange={(distanceM) => replaceItem({ ...item, distanceM })}
            hint="0 stops the photos. Only useful if the camera is wired to the autopilot’s trigger output."
          />
        </DrawerSection>
      )}

      {item.kind === 'roi' &&
        (item.lat !== null && item.lng !== null ? (
          <DrawerSection title="Point of interest" first>
            <Position item={{ lat: item.lat, lng: item.lng }} onChange={(p) => replaceItem({ ...item, ...p })} />
            <FieldNumber label="Height of the point" unit="m" min={-500} max={9000} step={1} value={item.height ?? 0} onChange={(height) => replaceItem({ ...item, height })} />
            <p className="text-[11px] leading-snug text-ink-muted">
              From here on the aircraft turns to face this point as it flies. It does not fly to it.
            </p>
          </DrawerSection>
        ) : (
          <DrawerSection title="Point of interest" first>
            <p className="text-xs leading-snug text-ink-muted">
              From here on the aircraft stops facing the point of interest.
            </p>
          </DrawerSection>
        ))}

      {item.kind === 'raw' && <RawFields item={item} />}

      <DrawerSection title="Remove">
        <button onClick={() => removeItem(item.id)} className={BTN}>
          <Trash2 size={13} className="text-red-500" /> Remove item {number}
        </button>
      </DrawerSection>
    </div>
  );
}

const ADD: { kind: AddableKind; label: string; where: string }[] = [
  { kind: 'takeoff', label: 'Takeoff', where: 'at the start' },
  { kind: 'return', label: 'Return', where: 'at the end' },
  { kind: 'land', label: 'Landing', where: 'at the end' },
  { kind: 'speed', label: 'Speed change', where: 'after the selected item' },
  { kind: 'camera-distance', label: 'Camera trigger', where: 'after the selected item' },
  { kind: 'roi', label: 'Point of interest', where: 'after the selected item' },
];

export function MissionsMissionPage() {
  const mission = useMissionsStore((s) => s.mission);
  const patchMission = useMissionsStore((s) => s.patchMission);
  const setHome = useMissionsStore((s) => s.setHome);
  const setHomeHeight = useMissionsStore((s) => s.setHomeHeight);
  const setTool = useMissionsStore((s) => s.setTool);
  const setView = useMissionsStore((s) => s.setView);
  const addItem = useMissionsStore((s) => s.addItem);
  const reverseRoute = useMissionsStore((s) => s.reverseRoute);
  const setEveryHeight = useMissionsStore((s) => s.setEveryHeight);
  const shiftEveryHeight = useMissionsStore((s) => s.shiftEveryHeight);
  const units = usePrefsStore((s) => s.units);
  const stats = useMissionStats();
  if (!mission || !stats) return <Empty>Open a mission, or start one, to see it here.</Empty>;
  const waypoints = stats.waypoints;

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Mission" first>
        <DrawerField label="Name">
          <input value={mission.name} onChange={(e) => patchMission({ name: e.target.value })} className={INPUT_CLASS} />
        </DrawerField>
        <DrawerField label="Made for">
          <select
            value={mission.firmware ?? ''}
            onChange={(e) => patchMission({ firmware: (e.target.value || null) as typeof mission.firmware })}
            className={INPUT_CLASS}
          >
            <option value="">Not stated</option>
            <option value="px4">PX4</option>
            <option value="ardupilot">ArduPilot</option>
            <option value="dji">DJI</option>
            <option value="garmin">Garmin</option>
          </select>
        </DrawerField>
        <FieldNumber
          label="Speed"
          unit="m/s"
          min={0.5}
          max={30}
          step={0.5}
          value={mission.cruiseSpeed ?? 5}
          onChange={(cruiseSpeed) => patchMission({ cruiseSpeed })}
          hint={mission.cruiseSpeed === null ? 'The file states no speed. 5 m/s is shown and is not part of the mission until you change it.' : 'Used where an item does not give its own.'}
        />
      </DrawerSection>

      <DrawerSection title="Numbers">
        <DrawerStat label="Items" value={stats.items} />
        <DrawerStat label="Waypoints" value={waypoints} />
        <DrawerStat label="Length" value={stats.lengthM > 0 ? fmtDistance(stats.lengthM, units) : 'n/a'} />
        <DrawerStat label="Longest leg" value={stats.longestLegM > 0 ? fmtDistance(stats.longestLegM, units) : 'n/a'} />
        <DrawerStat label="Lowest" value={stats.lowest === null ? 'n/a' : fmtAltitude(stats.lowest, units, 0)} />
        <DrawerStat label="Highest" value={stats.highest === null ? 'n/a' : fmtAltitude(stats.highest, units, 0)} />
        <DrawerStat label="Time" value={stats.timeS === null ? 'n/a' : fmtDuration(stats.timeS)} />
        <p className="text-[11px] leading-snug text-ink-muted">
          Time is distance over the stated speeds, plus waits. It leaves out the climb, the turns and the wind.
          The Flight Planner estimates those.
        </p>
      </DrawerSection>

      <DrawerSection title="Takeoff point">
        {mission.home ? (
          <>
            <Position item={mission.home} onChange={(p) => setHome(p)} />
            <FieldNumber
              label="Its height above sea level"
              unit="m"
              min={-500}
              max={9000}
              step={1}
              value={mission.home.heightAmsl ?? 0}
              onChange={(h) => setHomeHeight(h)}
              hint={
                mission.home.heightAmsl === null
                  ? 'Not known. 0 is shown and is not used. Needed to turn heights above takeoff into heights above sea level, which KML, GPX and Garmin use.'
                  : 'Used to turn heights above takeoff into heights above sea level. Check it after moving the takeoff point.'
              }
            />
            <button onClick={() => setHome(null)} className={BTN}>
              Remove the takeoff point
            </button>
          </>
        ) : (
          <>
            <p className="text-xs leading-snug text-ink-muted">
              The mission does not say where takeoff is. Distances from the pilot cannot be worked out.
            </p>
            <button
              onClick={() => {
                setView('map');
                setTool('home');
              }}
              className={BTN}
            >
              Set it on the map
            </button>
          </>
        )}
      </DrawerSection>

      <DrawerSection title="Add an item">
        <div className="grid grid-cols-2 gap-1.5">
          {ADD.map((a) => (
            <button key={a.kind} onClick={() => addItem(a.kind)} className={BTN} title={`Added ${a.where}`}>
              <Plus size={12} /> {a.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-ink-muted">
          Waypoints are added on the map with the Add tool.
        </p>
      </DrawerSection>

      <DrawerSection title="Every waypoint at once">
        <div className="grid grid-cols-2 gap-1.5">
          <button disabled={waypoints === 0} onClick={() => shiftEveryHeight(5)} className={BTN}>
            Raise 5 m
          </button>
          <button disabled={waypoints === 0} onClick={() => shiftEveryHeight(-5)} className={BTN}>
            Lower 5 m
          </button>
        </div>
        <button disabled={waypoints === 0} onClick={() => setEveryHeight(30, 'home')} className={BTN}>
          Set every height to 30 m above takeoff
        </button>
        <button disabled={waypoints < 2} onClick={reverseRoute} className={BTN}>
          Fly the route the other way round
        </button>
        <p className="text-[11px] leading-snug text-ink-muted">Undo, in the header, takes back any of these.</p>
      </DrawerSection>
    </div>
  );
}

export function MissionsChecksPage() {
  const hasMission = useMissionsStore((s) => s.mission !== null);
  const checks = useMissionChecks();
  if (!hasMission) return <Empty>Open a mission, or start one, to see its checks here.</Empty>;
  return (
    <div className="space-y-3 p-4">
      {checks.map((c) => (
        <CheckCard key={c.id} check={c} />
      ))}
      <p className="text-[11px] leading-snug text-ink-muted">
        These checks read the mission and nothing else. They do not know the ground, the trees, the airspace
        or the weather. The numbers under a check select the item it points at.
      </p>
    </div>
  );
}

export function MissionsExportPage() {
  const hasMission = useMissionsStore((s) => s.mission !== null);
  const format = useMissionsStore((s) => s.exportFormat);
  const checks = useMissionChecks();
  const written = useWritten();
  if (!hasMission) return <Empty>Open a mission, or start one, to write it to a file.</Empty>;
  const f = formatById(format);
  const blocked = checks.some((c) => c.level === 'critical');

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Format" first>
        <FormatSelect />
        {format === 'dji-wpml' && (
          <DrawerField label="For the aircraft">
            <DjiAircraftSelect />
          </DrawerField>
        )}
        <p className="text-[11px] leading-snug text-ink-muted">
          {f.about} Read by: {f.usedBy}.
        </p>
      </DrawerSection>

      <DrawerSection title="What the file will hold">
        {written && !written.ok && <p className="text-xs leading-snug text-ink">{written.reason}</p>}
        {written?.ok && <ReportCard report={written.file.report} compact />}
      </DrawerSection>

      <DrawerSection title="Download">
        {blocked && f.flyable && (
          <p className="rounded-lg border border-red-300 bg-red-50/70 p-2.5 text-xs leading-snug text-ink dark:border-red-900 dark:bg-red-950/30">
            This mission has a check marked Stop. You can still download it. Read the Checks page first.
          </p>
        )}
        <button disabled={!written?.ok} onClick={() => written?.ok && downloadWritten(written.file)} className={BTN}>
          <Download size={13} className="text-green-600 dark:text-green-500" />
          {written?.ok ? written.file.name : `Download .${f.extensions[0]}`}
        </button>
        <CopyBriefButton />
      </DrawerSection>

      {f.flyable && (
        <DrawerSection title="Before you upload it">
          <ol className="list-decimal space-y-1.5 pl-4 text-[11px] leading-snug text-ink-muted">
            <li>Open the file in the ground station&apos;s own planner. This app never talks to an aircraft.</li>
            <li>Look at every waypoint on the ground station&apos;s map and check each height there.</li>
            <li>Check what each height is measured from. The ground under the route may be higher than takeoff.</li>
            <li>Upload from the ground station, with the aircraft on the ground and the props off.</li>
          </ol>
        </DrawerSection>
      )}
    </div>
  );
}
