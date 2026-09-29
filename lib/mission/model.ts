// The internal mission model. Every file format is read INTO this and written
// OUT of it, so the screens, the checks and the converters only ever deal with
// one shape.
//
// Two rules keep it honest:
//   1. Anything a format holds that this model has no word for is kept as a RAW
//      item, untouched, and written back as it was. Reading a file and saving it
//      in the same format never loses an instruction.
//   2. A height is never stored without saying what it is measured from.
//
// No imports: runs in the browser and under plain Node.

/** What a height is measured from. */
export type HeightRef =
  /** Above the takeoff point. What PX4 and ArduPilot missions usually mean. */
  | 'home'
  /** Above mean sea level. */
  | 'amsl'
  /** Above the WGS84 ellipsoid, the surface GPS itself uses. Not sea level. */
  | 'ellipsoid'
  /** Above the ground directly beneath, from terrain data. */
  | 'ground'
  /** The file does not say. */
  | 'unknown';

export const HEIGHT_REF_LABEL: Record<HeightRef, string> = {
  home: 'above takeoff',
  amsl: 'above sea level',
  ellipsoid: 'above the GPS ellipsoid',
  ground: 'above the ground below',
  unknown: 'reference not stated',
};

/** Something the aircraft does at a waypoint. */
export type MissionAction =
  | { kind: 'photo' }
  | { kind: 'video-start' }
  | { kind: 'video-stop' }
  | { kind: 'hover'; seconds: number }
  | { kind: 'yaw'; headingDeg: number }
  | { kind: 'gimbal'; pitchDeg: number | null; yawDeg: number | null }
  /** An action this model has no word for, kept exactly as the file had it. */
  | { kind: 'raw'; name: string; params: Record<string, string> };

/**
 * The MAVLink row an item was read from. The model has words for some of a
 * row's numbers and none for the rest; the writer puts the item's own values
 * in the slots it has words for and takes every other number from here, so a
 * file that is read and written back comes out as it went in.
 */
export interface MavOrigin {
  command: number;
  frame: number;
  params: (number | null)[];
  autoContinue: boolean;
}

interface ItemBase {
  /** Stable while the mission is open; not written to any file. */
  id: string;
  note?: string;
  origin?: MavOrigin;
}

export interface TakeoffItem extends ItemBase {
  kind: 'takeoff';
  /** Some formats put a position on takeoff; most do not. */
  lat: number | null;
  lng: number | null;
  height: number;
  heightRef: HeightRef;
}

export interface WaypointItem extends ItemBase {
  kind: 'waypoint';
  lat: number;
  lng: number;
  /** null when the format carries no height (a Garmin route, a flat KML line). */
  height: number | null;
  heightRef: HeightRef;
  name?: string;
  /** Speed to fly onward from here, m/s. */
  speed?: number;
  /** Seconds to wait here. */
  holdS?: number;
  /** Heading to hold here, degrees from north. */
  headingDeg?: number;
  /** How close counts as arrived, metres. */
  acceptRadiusM?: number;
  actions?: MissionAction[];
}

export interface LandItem extends ItemBase {
  kind: 'land';
  lat: number | null;
  lng: number | null;
}

export interface ReturnItem extends ItemBase {
  kind: 'return';
}

export interface SpeedItem extends ItemBase {
  kind: 'speed';
  speed: number;
}

export interface RoiItem extends ItemBase {
  kind: 'roi';
  /** null position = stop looking at the point of interest. */
  lat: number | null;
  lng: number | null;
  height: number | null;
}

export interface CameraDistanceItem extends ItemBase {
  kind: 'camera-distance';
  /** Metres between photos; 0 stops the triggering. */
  distanceM: number;
}

/** A MAVLink mission command this model has no word for. */
export interface RawItem extends ItemBase {
  kind: 'raw';
  command: number;
  frame: number;
  /** param1..4, then x (latitude), y (longitude), z (height). */
  params: (number | null)[];
  label: string;
}

export type MissionItem =
  | TakeoffItem
  | WaypointItem
  | LandItem
  | ReturnItem
  | SpeedItem
  | RoiItem
  | CameraDistanceItem
  | RawItem;

export type MissionItemKind = MissionItem['kind'];

export interface MissionPoint {
  lat: number;
  lng: number;
}

export interface MissionArea {
  name: string;
  points: MissionPoint[];
  /** survey = an area to cover; keep-in and keep-out are geofences. */
  role: 'survey' | 'keep-in' | 'keep-out';
}

export interface MissionCircle {
  center: MissionPoint;
  radiusM: number;
  role: 'keep-in' | 'keep-out';
}

export interface RallyPoint extends MissionPoint {
  height: number;
  heightRef: HeightRef;
}

export type MissionFormatId =
  | 'qgc-plan'
  | 'qgc-wpl'
  | 'garmin-fpl'
  | 'dji-wpml'
  | 'kml'
  | 'gpx'
  | 'csv'
  | 'fc-mission';

export interface Mission {
  name: string;
  /** The format this mission was read from; null for one made in the app. */
  source: MissionFormatId | null;
  sourceFile: string | null;
  /** What the file says it was made for, in words. */
  vehicle: string | null;
  firmware: 'px4' | 'ardupilot' | 'dji' | 'garmin' | null;
  home: { lat: number; lng: number; heightAmsl: number | null } | null;
  /** Speed used where an item does not give its own, m/s. */
  cruiseSpeed: number | null;
  items: MissionItem[];
  areas: MissionArea[];
  circles: MissionCircle[];
  rally: RallyPoint[];
  /** What the reader noticed: assumptions it made, things it could not read. */
  notes: string[];
  /** Format-specific values kept so a file can be written back as it was. */
  extras: Record<string, unknown>;
}

let counter = 0;
export function newId(): string {
  counter += 1;
  return `i${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptyMission(name = 'Untitled mission'): Mission {
  return {
    name,
    source: null,
    sourceFile: null,
    vehicle: null,
    firmware: null,
    home: null,
    cruiseSpeed: null,
    items: [],
    areas: [],
    circles: [],
    rally: [],
    notes: [],
    extras: {},
  };
}

/** Items that have a place on the map. */
export function hasPosition(
  item: MissionItem,
): item is (WaypointItem | TakeoffItem | LandItem | RoiItem) & { lat: number; lng: number } {
  return (
    (item.kind === 'waypoint' || item.kind === 'takeoff' || item.kind === 'land' || item.kind === 'roi') &&
    typeof item.lat === 'number' &&
    typeof item.lng === 'number' &&
    Number.isFinite(item.lat) &&
    Number.isFinite(item.lng)
  );
}

/** The places the aircraft flies to, in order. A point of interest is looked at, not flown to. */
export function flownPoints(m: Mission): (MissionPoint & { index: number; height: number | null })[] {
  const out: (MissionPoint & { index: number; height: number | null })[] = [];
  m.items.forEach((item, index) => {
    if (item.kind === 'roi' || !hasPosition(item)) return;
    // a takeoff or landing at latitude 0, longitude 0 is "where the aircraft is"
    if (item.kind !== 'waypoint' && item.lat === 0 && item.lng === 0) return;
    out.push({
      lat: item.lat,
      lng: item.lng,
      index,
      height: item.kind === 'land' ? 0 : ((item as WaypointItem | TakeoffItem).height ?? null),
    });
  });
  return out;
}

const R = 6371008.8;
const RAD = Math.PI / 180;

export function distanceM(a: MissionPoint, b: MissionPoint): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export interface MissionStats {
  items: number;
  waypoints: number;
  /** Along the flown points, metres. Home is counted when the mission has one. */
  lengthM: number;
  longestLegM: number;
  lowest: number | null;
  highest: number | null;
  /** Every height reference the mission uses. More than one is worth a look. */
  heightRefs: HeightRef[];
  farthestFromHomeM: number | null;
  /** Seconds at the speeds the mission states; null when it states none. */
  timeS: number | null;
  bounds: { south: number; west: number; north: number; east: number } | null;
}

export function missionStats(m: Mission): MissionStats {
  const pts = flownPoints(m);
  let lengthM = 0;
  let longest = 0;
  let timeS = 0;
  let timed = m.cruiseSpeed !== null && m.cruiseSpeed > 0;
  let speed = m.cruiseSpeed ?? 0;
  let prev: MissionPoint | null = m.home;
  let farthest: number | null = m.home ? 0 : null;
  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;

  for (const item of m.items) {
    if (item.kind === 'speed' && item.speed > 0) {
      speed = item.speed;
      timed = true;
    }
    if (item.kind === 'roi' || !hasPosition(item)) continue;
    if (item.kind !== 'waypoint' && item.lat === 0 && item.lng === 0) continue;
    const here = { lat: item.lat, lng: item.lng };
    if (prev) {
      const d = distanceM(prev, here);
      lengthM += d;
      if (d > longest) longest = d;
      if (speed > 0) timeS += d / speed;
    }
    if (item.kind === 'waypoint') {
      if (item.holdS) timeS += item.holdS;
      for (const a of item.actions ?? []) if (a.kind === 'hover') timeS += a.seconds;
      if (item.speed && item.speed > 0) {
        speed = item.speed;
        timed = true;
      }
    }
    if (m.home && farthest !== null) farthest = Math.max(farthest, distanceM(m.home, here));
    south = Math.min(south, here.lat);
    north = Math.max(north, here.lat);
    west = Math.min(west, here.lng);
    east = Math.max(east, here.lng);
    prev = here;
  }
  const last = m.items[m.items.length - 1];
  if (m.home && prev && last && last.kind === 'return') {
    const d = distanceM(prev, m.home);
    lengthM += d;
    if (speed > 0) timeS += d / speed;
  }

  const heights: number[] = [];
  const refs = new Set<HeightRef>();
  for (const item of m.items) {
    if ((item.kind === 'waypoint' || item.kind === 'takeoff') && item.height !== null) {
      heights.push(item.height);
      refs.add(item.heightRef);
    }
  }

  return {
    items: m.items.length,
    waypoints: m.items.filter((i) => i.kind === 'waypoint').length,
    lengthM,
    longestLegM: longest,
    lowest: heights.length ? Math.min(...heights) : null,
    highest: heights.length ? Math.max(...heights) : null,
    heightRefs: [...refs],
    farthestFromHomeM: farthest,
    timeS: timed && pts.length > 0 ? timeS : null,
    bounds: pts.length > 0 ? { south, west, north, east } : null,
  };
}

export const ITEM_LABEL: Record<MissionItemKind, string> = {
  takeoff: 'Take off',
  waypoint: 'Waypoint',
  land: 'Land',
  return: 'Return',
  speed: 'Change speed',
  roi: 'Point of interest',
  'camera-distance': 'Camera trigger',
  raw: 'Command',
};

/** One line saying what an item does, for tables and for an assistant. */
export function describeItem(item: MissionItem): string {
  switch (item.kind) {
    case 'takeoff':
      return `Take off to ${item.height} m ${HEIGHT_REF_LABEL[item.heightRef]}`;
    case 'waypoint': {
      const parts = [item.name ? `"${item.name}"` : 'Waypoint'];
      parts.push(item.height === null ? 'no height given' : `${item.height} m ${HEIGHT_REF_LABEL[item.heightRef]}`);
      if (item.speed) parts.push(`then ${item.speed} m/s`);
      if (item.holdS) parts.push(`wait ${item.holdS} s`);
      if (item.actions?.length) parts.push(`${item.actions.length} action${item.actions.length > 1 ? 's' : ''}`);
      return parts.join(', ');
    }
    case 'land':
      return item.lat === null ? 'Land where it is' : 'Land at this point';
    case 'return':
      return 'Return to the takeoff point';
    case 'speed':
      return `Fly at ${item.speed} m/s from here`;
    case 'roi':
      return item.lat === null ? 'Stop facing the point of interest' : 'Face this point of interest';
    case 'camera-distance':
      return item.distanceM > 0 ? `Take a photo every ${item.distanceM} m` : 'Stop taking photos';
    case 'raw':
      return item.label;
  }
}

/** The changes a writer made, and what it could not carry. Shown before every export. */
export interface ConversionReport {
  format: MissionFormatId;
  /** What went across unchanged, in words. */
  kept: string[];
  /** What the format cannot hold, and so is not in the file. */
  dropped: { what: string; count: number; why: string }[];
  /** What had to be altered to fit, and how. */
  changed: string[];
  /** What the writer assumed, and what nobody has checked. */
  warnings: string[];
}

export function emptyReport(format: MissionFormatId): ConversionReport {
  return { format, kept: [], dropped: [], changed: [], warnings: [] };
}

export class MissionFormatError extends Error {}

export interface WrittenFile {
  name: string;
  mime: string;
  data: Uint8Array;
  report: ConversionReport;
}
