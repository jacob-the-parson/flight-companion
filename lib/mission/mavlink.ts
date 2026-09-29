// Between the mission model and a MAVLink mission item: one command number, one
// frame number and seven parameters. Both QGroundControl's .plan and the plain
// "QGC WPL 110" list are rows of these.
//
// Commands this file names get a word in the model. Every other command is kept
// RAW: its numbers are carried through untouched and written back as they were.
import { MAV_CMD, MAV_FRAME } from './mavlinkCommands.ts';
import { newId, type HeightRef, type MavOrigin, type Mission, type MissionItem } from './model.ts';

export interface MavRow {
  command: number;
  frame: number;
  /** param1..4, x (latitude), y (longitude), z (height). null = not a number. */
  params: (number | null)[];
  autoContinue: boolean;
}

export const CMD = {
  WAYPOINT: 16,
  RETURN: 20,
  LAND: 21,
  TAKEOFF: 22,
  CHANGE_SPEED: 178,
  ROI_LOCATION: 195,
  ROI_NONE: 197,
  CAM_TRIGG_DIST: 206,
} as const;

export const FRAME = {
  GLOBAL: 0,
  MISSION: 2,
  GLOBAL_RELATIVE_ALT: 3,
  GLOBAL_INT: 5,
  GLOBAL_RELATIVE_ALT_INT: 6,
  GLOBAL_TERRAIN_ALT: 10,
  GLOBAL_TERRAIN_ALT_INT: 11,
} as const;

export function heightRefOfFrame(frame: number): HeightRef {
  if (frame === FRAME.GLOBAL_RELATIVE_ALT || frame === FRAME.GLOBAL_RELATIVE_ALT_INT) return 'home';
  if (frame === FRAME.GLOBAL || frame === FRAME.GLOBAL_INT) return 'amsl';
  if (frame === FRAME.GLOBAL_TERRAIN_ALT || frame === FRAME.GLOBAL_TERRAIN_ALT_INT) return 'ground';
  return 'unknown';
}

export function frameOfHeightRef(ref: HeightRef): number | null {
  if (ref === 'home') return FRAME.GLOBAL_RELATIVE_ALT;
  if (ref === 'amsl') return FRAME.GLOBAL;
  if (ref === 'ground') return FRAME.GLOBAL_TERRAIN_ALT;
  return null; // ellipsoid and unknown have no MAVLink mission frame
}

export function commandLabel(command: number): string {
  const c = MAV_CMD[command];
  if (!c) return `MAVLink command ${command}`;
  const words = c.name.replace(/^(NAV|DO|CONDITION)_/, '').replace(/_/g, ' ').toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} (${c.name})`;
}

export function frameLabel(frame: number): string {
  return MAV_FRAME[frame]?.name ?? `frame ${frame}`;
}

const n = (v: number | null | undefined): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v !== 0;

/** One MAVLink row into the model. The row itself goes along as the item's origin. */
export function itemFromRow(row: MavRow): MissionItem {
  const item = wordsFromRow(row);
  if (item.kind === 'raw') return item; // a raw item IS its row
  return {
    ...item,
    origin: {
      command: row.command,
      frame: row.frame,
      params: [0, 1, 2, 3, 4, 5, 6].map((i) => (typeof row.params[i] === 'number' ? (row.params[i] as number) : null)),
      autoContinue: row.autoContinue,
    },
  };
}

function wordsFromRow(row: MavRow): MissionItem {
  const p = row.params;
  const lat = p[4];
  const lng = p[5];
  const z = p[6];
  const heightRef = heightRefOfFrame(row.frame);
  const placed = has(lat) || has(lng);

  switch (row.command) {
    case CMD.WAYPOINT:
      // a waypoint needs a place; one without is kept as it is
      if (typeof lat !== 'number' || typeof lng !== 'number') break;
      return {
        id: newId(),
        kind: 'waypoint',
        lat,
        lng,
        height: typeof z === 'number' ? z : null,
        heightRef,
        ...(has(p[0]) ? { holdS: p[0] } : null),
        ...(has(p[1]) ? { acceptRadiusM: p[1] } : null),
        ...(has(p[3]) ? { headingDeg: p[3] } : null),
      };
    case CMD.TAKEOFF:
      return {
        id: newId(),
        kind: 'takeoff',
        lat: placed ? n(lat) : null,
        lng: placed ? n(lng) : null,
        height: n(z),
        heightRef,
      };
    case CMD.LAND:
      return { id: newId(), kind: 'land', lat: placed ? n(lat) : null, lng: placed ? n(lng) : null };
    case CMD.RETURN:
      return { id: newId(), kind: 'return' };
    case CMD.CHANGE_SPEED:
      // param2 is the speed; a value of -1 or 0 means "no change", so keep it raw
      if (has(p[1]) && p[1] > 0) {
        return { id: newId(), kind: 'speed', speed: p[1], note: speedNote(p) };
      }
      break;
    case CMD.ROI_LOCATION:
      return { id: newId(), kind: 'roi', lat: n(lat), lng: n(lng), height: typeof z === 'number' ? z : null };
    case CMD.ROI_NONE:
      return { id: newId(), kind: 'roi', lat: null, lng: null, height: null };
    case CMD.CAM_TRIGG_DIST:
      return { id: newId(), kind: 'camera-distance', distanceM: Math.max(0, n(p[0])) };
    default:
      break;
  }
  return {
    id: newId(),
    kind: 'raw',
    command: row.command,
    frame: row.frame,
    params: [0, 1, 2, 3, 4, 5, 6].map((i) => (typeof p[i] === 'number' ? (p[i] as number) : null)),
    label: commandLabel(row.command),
  };
}

function speedNote(p: (number | null)[]): string | undefined {
  // param1: 0 airspeed, 1 ground speed, 2 climb, 3 descent
  const type = n(p[0]);
  if (type === 0) return 'Stated as airspeed';
  if (type === 2) return 'Stated as climb speed';
  if (type === 3) return 'Stated as descent speed';
  return undefined;
}

export interface RowResult {
  row: MavRow | null;
  /** Why the item could not be written, in words. */
  refused?: string;
  /** What had to be changed to write it. */
  changed?: string;
}

const empty = (v: number | null | undefined): boolean => typeof v !== 'number' || !Number.isFinite(v) || v === 0;

/**
 * Put back the numbers the model has no word for. `owned` lists the parameter
 * slots the item's own values decide. Every other slot, and the frame where it
 * still says the same thing, comes from the row the item was read from.
 */
function withOrigin(row: MavRow, origin: MavOrigin | undefined, owned: number[], ref: HeightRef | null): MavRow {
  if (!origin || origin.command !== row.command) return row;
  const params = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const mine = row.params[i] ?? null;
    const theirs = origin.params[i] ?? null;
    if (!owned.includes(i)) return theirs;
    // nothing on either side: keep the file's way of writing nothing (0 or no number)
    return empty(mine) && empty(theirs) ? theirs : mine;
  });
  // a height keeps its frame while the frame still means the item's reference;
  // an item without a height has nothing to disagree with
  const frame = ref === null || heightRefOfFrame(origin.frame) === ref ? origin.frame : row.frame;
  return { command: row.command, frame, params, autoContinue: origin.autoContinue };
}

/** One model item into a MAVLink row. */
export function rowFromItem(item: MissionItem, mission: Mission): RowResult {
  const r = freshRow(item, mission);
  if (!r.row) return r;
  switch (item.kind) {
    case 'waypoint':
      return { ...r, row: withOrigin(r.row, item.origin, [0, 1, 3, 4, 5, 6], item.heightRef) };
    case 'takeoff':
      // a takeoff with no place of its own keeps whatever the file had there
      return {
        ...r,
        row: withOrigin(r.row, item.origin, item.lat === null || item.lng === null ? [6] : [4, 5, 6], item.heightRef),
      };
    case 'land':
      return { ...r, row: withOrigin(r.row, item.origin, item.lat === null || item.lng === null ? [] : [4, 5], null) };
    case 'return':
      return { ...r, row: withOrigin(r.row, item.origin, [], null) };
    case 'speed':
      return { ...r, row: withOrigin(r.row, item.origin, [1], null) };
    case 'roi':
      return { ...r, row: withOrigin(r.row, item.origin, [4, 5, 6], null) };
    case 'camera-distance':
      return { ...r, row: withOrigin(r.row, item.origin, [0], null) };
    case 'raw':
      return r;
  }
}

function freshRow(item: MissionItem, mission: Mission): RowResult {
  const pos = (lat: number | null, lng: number | null): [number, number] => [n(lat), n(lng)];
  const frameFor = (ref: HeightRef): { frame: number; changed?: string } => {
    const f = frameOfHeightRef(ref);
    if (f !== null) return { frame: f };
    return {
      frame: FRAME.GLOBAL_RELATIVE_ALT,
      changed:
        ref === 'ellipsoid'
          ? 'a height above the GPS ellipsoid was written as a height above takeoff, unchanged in value'
          : 'a height with no stated reference was written as a height above takeoff',
    };
  };

  switch (item.kind) {
    case 'waypoint': {
      const { frame, changed } = frameFor(item.heightRef);
      if (item.height === null) {
        return { row: null, refused: 'a waypoint with no height cannot be flown: give it one first' };
      }
      return {
        row: {
          command: CMD.WAYPOINT,
          frame,
          params: [n(item.holdS), n(item.acceptRadiusM), 0, item.headingDeg ?? null, item.lat, item.lng, item.height],
          autoContinue: true,
        },
        changed,
      };
    }
    case 'takeoff': {
      const { frame, changed } = frameFor(item.heightRef);
      const [lat, lng] =
        item.lat !== null && item.lng !== null
          ? pos(item.lat, item.lng)
          : mission.home
            ? pos(mission.home.lat, mission.home.lng)
            : [0, 0];
      return {
        row: { command: CMD.TAKEOFF, frame, params: [0, 0, 0, null, lat, lng, item.height], autoContinue: true },
        changed,
      };
    }
    case 'land': {
      const [lat, lng] = pos(item.lat, item.lng);
      return {
        row: { command: CMD.LAND, frame: FRAME.GLOBAL_RELATIVE_ALT, params: [0, 0, 0, null, lat, lng, 0], autoContinue: true },
      };
    }
    case 'return':
      return { row: { command: CMD.RETURN, frame: FRAME.MISSION, params: [0, 0, 0, 0, 0, 0, 0], autoContinue: true } };
    case 'speed':
      return {
        row: { command: CMD.CHANGE_SPEED, frame: FRAME.MISSION, params: [1, item.speed, -1, 0, 0, 0, 0], autoContinue: true },
      };
    case 'roi':
      if (item.lat === null || item.lng === null) {
        return { row: { command: CMD.ROI_NONE, frame: FRAME.MISSION, params: [0, 0, 0, 0, 0, 0, 0], autoContinue: true } };
      }
      return {
        row: {
          command: CMD.ROI_LOCATION,
          frame: FRAME.GLOBAL_RELATIVE_ALT,
          params: [0, 0, 0, 0, item.lat, item.lng, n(item.height)],
          autoContinue: true,
        },
      };
    case 'camera-distance':
      return {
        row: {
          command: CMD.CAM_TRIGG_DIST,
          frame: FRAME.MISSION,
          params: [item.distanceM, 0, item.distanceM > 0 ? 1 : 0, 0, 0, 0, 0],
          autoContinue: true,
        },
      };
    case 'raw':
      return { row: { command: item.command, frame: item.frame, params: item.params.slice(0, 7), autoContinue: true } };
  }
}

/** Waypoint actions have no place in a MAVLink waypoint; they become commands after it. */
export function rowsFromActions(item: MissionItem): { rows: MavRow[]; dropped: number } {
  if (item.kind !== 'waypoint' || !item.actions?.length) return { rows: [], dropped: 0 };
  const rows: MavRow[] = [];
  let dropped = 0;
  const mission = (command: number, params: number[]): MavRow => ({
    command,
    frame: FRAME.MISSION,
    params,
    autoContinue: true,
  });
  for (const a of item.actions) {
    if (a.kind === 'photo') rows.push(mission(2000, [0, 0, 1, 0, 0, 0, 0]));
    else if (a.kind === 'video-start') rows.push(mission(2500, [0, 0, 0, 0, 0, 0, 0]));
    else if (a.kind === 'video-stop') rows.push(mission(2501, [0, 0, 0, 0, 0, 0, 0]));
    else if (a.kind === 'yaw') rows.push(mission(115, [a.headingDeg, 0, 0, 0, 0, 0, 0]));
    // a hover is written as the waypoint's own hold time by the caller; the
    // gimbal and unnamed actions have no agreed MAVLink mission form here
    else if (a.kind !== 'hover') dropped += 1;
  }
  return { rows, dropped };
}

/** Seconds of hover in a waypoint's actions, to fold into its hold time. */
export function hoverSeconds(item: MissionItem): number {
  if (item.kind !== 'waypoint') return 0;
  return (item.actions ?? []).reduce((s, a) => (a.kind === 'hover' ? s + a.seconds : s), 0);
}
