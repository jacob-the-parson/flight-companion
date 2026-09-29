// The two plain formats, made to be read by a person, a spreadsheet or an
// assistant rather than by an aircraft.
//
//   fc-mission  JSON. The internal model itself, with a named schema. Nothing
//               is lost: it is the one format that holds everything.
//   csv         One row per item. Units are in the column names.
import {
  emptyMission,
  emptyReport,
  HEIGHT_REF_LABEL,
  MissionFormatError,
  newId,
  describeItem,
  missionStats,
  type HeightRef,
  type MavOrigin,
  type Mission,
  type MissionItem,
  type WaypointItem,
  type WrittenFile,
} from '../model.ts';
import { decode, encode } from '../xml.ts';
import { safeName } from './qgcPlan.ts';

export const MISSION_SCHEMA = 'flight-companion/mission@1';

const REFS: HeightRef[] = ['home', 'amsl', 'ellipsoid', 'ground', 'unknown'];
const isRef = (v: unknown): v is HeightRef => typeof v === 'string' && (REFS as string[]).includes(v);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ------------------------------------------------------------------ JSON

export function writeMissionJson(mission: Mission): WrittenFile {
  const report = emptyReport('fc-mission');
  const stats = missionStats(mission);
  const doc = {
    schema: MISSION_SCHEMA,
    about:
      'A flight mission. Latitudes and longitudes are decimal degrees, WGS84. Heights are metres. Every height states what it is measured from in height_reference. Speeds are metres per second.',
    height_references: HEIGHT_REF_LABEL,
    name: mission.name,
    read_from: mission.source,
    read_from_file: mission.sourceFile,
    made_for: mission.vehicle,
    autopilot: mission.firmware,
    takeoff_point: mission.home
      ? {
          latitude_deg: mission.home.lat,
          longitude_deg: mission.home.lng,
          height_above_sea_level_m: mission.home.heightAmsl,
        }
      : null,
    default_speed_m_s: mission.cruiseSpeed,
    summary: {
      items: stats.items,
      waypoints: stats.waypoints,
      length_m: Math.round(stats.lengthM * 10) / 10,
      longest_leg_m: Math.round(stats.longestLegM * 10) / 10,
      lowest_height_m: stats.lowest,
      highest_height_m: stats.highest,
      height_references_used: stats.heightRefs,
      farthest_from_takeoff_m: stats.farthestFromHomeM === null ? null : Math.round(stats.farthestFromHomeM * 10) / 10,
      estimated_time_s: stats.timeS === null ? null : Math.round(stats.timeS),
    },
    items: mission.items.map((item, i) => ({ index: i + 1, in_words: describeItem(item), ...itemOut(item) })),
    areas: mission.areas.map((a) => ({
      name: a.name,
      role: a.role,
      corners: a.points.map((p) => ({ latitude_deg: p.lat, longitude_deg: p.lng })),
    })),
    geofence_circles: mission.circles.map((c) => ({
      role: c.role,
      centre: { latitude_deg: c.center.lat, longitude_deg: c.center.lng },
      radius_m: c.radiusM,
    })),
    rally_points: mission.rally.map((r) => ({
      latitude_deg: r.lat,
      longitude_deg: r.lng,
      height_m: r.height,
      height_reference: r.heightRef,
    })),
    notes_from_the_reader: mission.notes,
    kept_for_the_original_format: mission.extras,
  };
  report.kept.push('Everything. This is the one format that holds the whole mission.');
  report.warnings.push('No ground station reads this file. It is for people, spreadsheets, scripts and assistants.');
  return {
    name: `${safeName(mission.name)}.mission.json`,
    mime: 'application/json',
    data: encode(JSON.stringify(doc, null, 2) + '\n'),
    report,
  };
}

function itemOut(item: MissionItem): Record<string, unknown> {
  const { id: _id, kind, ...rest } = item as MissionItem & Record<string, unknown>;
  void _id;
  const out: Record<string, unknown> = { kind };
  const rename: Record<string, string> = {
    lat: 'latitude_deg',
    lng: 'longitude_deg',
    height: 'height_m',
    heightRef: 'height_reference',
    speed: 'speed_m_s',
    holdS: 'wait_s',
    headingDeg: 'heading_deg',
    acceptRadiusM: 'arrival_radius_m',
    distanceM: 'distance_m',
    command: 'mavlink_command',
    frame: 'mavlink_frame',
    params: 'mavlink_params',
    origin: 'mavlink_row_read_from',
  };
  for (const [k, v] of Object.entries(rest)) out[rename[k] ?? k] = v;
  return out;
}

function originIn(raw: unknown): { origin: MavOrigin } | null {
  if (!isObj(raw)) return null;
  const command = numOrNull(raw.command);
  const frame = numOrNull(raw.frame);
  if (command === null || frame === null || !Array.isArray(raw.params)) return null;
  return {
    origin: { command, frame, params: raw.params.slice(0, 7).map(numOrNull), autoContinue: raw.autoContinue !== false },
  };
}

function itemIn(raw: Record<string, unknown>): MissionItem | null {
  const id = newId();
  const kind = raw.kind;
  const lat = numOrNull(raw.latitude_deg);
  const lng = numOrNull(raw.longitude_deg);
  const height = numOrNull(raw.height_m);
  const heightRef: HeightRef = isRef(raw.height_reference) ? raw.height_reference : 'unknown';
  const note = {
    ...(typeof raw.note === 'string' ? { note: raw.note } : null),
    ...originIn(raw.mavlink_row_read_from),
  };
  switch (kind) {
    case 'waypoint':
      if (lat === null || lng === null) return null;
      return {
        id,
        kind,
        lat,
        lng,
        height,
        heightRef: height === null ? 'unknown' : heightRef,
        ...(typeof raw.name === 'string' && raw.name ? { name: raw.name } : null),
        ...(numOrNull(raw.speed_m_s) ? { speed: raw.speed_m_s as number } : null),
        ...(numOrNull(raw.wait_s) ? { holdS: raw.wait_s as number } : null),
        ...(numOrNull(raw.heading_deg) !== null ? { headingDeg: raw.heading_deg as number } : null),
        ...(numOrNull(raw.arrival_radius_m) ? { acceptRadiusM: raw.arrival_radius_m as number } : null),
        ...(Array.isArray(raw.actions) && raw.actions.length ? { actions: raw.actions as WaypointItem['actions'] } : null),
        ...note,
      };
    case 'takeoff':
      return { id, kind, lat, lng, height: height ?? 0, heightRef, ...note };
    case 'land':
      return { id, kind, lat, lng, ...note };
    case 'return':
      return { id, kind, ...note };
    case 'speed': {
      const speed = numOrNull(raw.speed_m_s);
      return speed === null ? null : { id, kind, speed, ...note };
    }
    case 'roi':
      return { id, kind, lat, lng, height, ...note };
    case 'camera-distance':
      return { id, kind, distanceM: numOrNull(raw.distance_m) ?? 0, ...note };
    case 'raw': {
      const command = numOrNull(raw.mavlink_command);
      if (command === null) return null;
      return {
        id,
        kind,
        command,
        frame: numOrNull(raw.mavlink_frame) ?? 2,
        params: Array.isArray(raw.mavlink_params) ? raw.mavlink_params.slice(0, 7).map(numOrNull) : [],
        label: typeof raw.label === 'string' ? raw.label : `MAVLink command ${command}`,
        ...note,
      };
    }
    default:
      return null;
  }
}

export function looksLikeMissionJson(text: string): boolean {
  return text.includes(`"schema"`) && text.includes('flight-companion/mission@');
}

export function readMissionJson(bytes: Uint8Array, fileName: string): Mission {
  let doc: unknown;
  try {
    doc = JSON.parse(decode(bytes));
  } catch {
    throw new MissionFormatError('The file is not valid JSON.');
  }
  if (!isObj(doc) || typeof doc.schema !== 'string' || !doc.schema.startsWith('flight-companion/mission@')) {
    throw new MissionFormatError('The file does not name the schema "flight-companion/mission@1".');
  }
  const mission = emptyMission(typeof doc.name === 'string' ? doc.name : fileName.replace(/(\.mission)?\.json$/i, ''));
  mission.source = 'fc-mission';
  mission.sourceFile = fileName;
  mission.vehicle = typeof doc.made_for === 'string' ? doc.made_for : null;
  mission.firmware =
    doc.autopilot === 'px4' || doc.autopilot === 'ardupilot' || doc.autopilot === 'dji' || doc.autopilot === 'garmin'
      ? doc.autopilot
      : null;
  if (isObj(doc.takeoff_point)) {
    const lat = numOrNull(doc.takeoff_point.latitude_deg);
    const lng = numOrNull(doc.takeoff_point.longitude_deg);
    if (lat !== null && lng !== null) {
      mission.home = { lat, lng, heightAmsl: numOrNull(doc.takeoff_point.height_above_sea_level_m) };
    }
  }
  mission.cruiseSpeed = numOrNull(doc.default_speed_m_s);
  let skipped = 0;
  for (const raw of Array.isArray(doc.items) ? doc.items : []) {
    const item = isObj(raw) ? itemIn(raw) : null;
    if (item) mission.items.push(item);
    else skipped += 1;
  }
  for (const a of Array.isArray(doc.areas) ? doc.areas : []) {
    if (!isObj(a) || !Array.isArray(a.corners)) continue;
    const points = a.corners
      .filter(isObj)
      .map((c) => ({ lat: Number(c.latitude_deg), lng: Number(c.longitude_deg) }))
      .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (points.length >= 3) {
      mission.areas.push({
        name: typeof a.name === 'string' ? a.name : 'Area',
        points,
        role: a.role === 'keep-in' || a.role === 'keep-out' ? a.role : 'survey',
      });
    }
  }
  for (const c of Array.isArray(doc.geofence_circles) ? doc.geofence_circles : []) {
    if (!isObj(c) || !isObj(c.centre)) continue;
    const lat = numOrNull(c.centre.latitude_deg);
    const lng = numOrNull(c.centre.longitude_deg);
    const radiusM = numOrNull(c.radius_m);
    if (lat !== null && lng !== null && radiusM !== null) {
      mission.circles.push({ center: { lat, lng }, radiusM, role: c.role === 'keep-out' ? 'keep-out' : 'keep-in' });
    }
  }
  for (const r of Array.isArray(doc.rally_points) ? doc.rally_points : []) {
    if (!isObj(r)) continue;
    const lat = numOrNull(r.latitude_deg);
    const lng = numOrNull(r.longitude_deg);
    if (lat !== null && lng !== null) {
      mission.rally.push({ lat, lng, height: numOrNull(r.height_m) ?? 0, heightRef: isRef(r.height_reference) ? r.height_reference : 'home' });
    }
  }
  if (Array.isArray(doc.notes_from_the_reader)) {
    mission.notes = doc.notes_from_the_reader.filter((n): n is string => typeof n === 'string');
  }
  if (isObj(doc.kept_for_the_original_format)) mission.extras = doc.kept_for_the_original_format;
  if (skipped > 0) mission.notes.push(`${skipped} item(s) in the file could not be understood and were left out.`);
  return mission;
}

// ------------------------------------------------------------------ CSV

const COLUMNS = [
  'index',
  'kind',
  'name',
  'latitude_deg',
  'longitude_deg',
  'height_m',
  'height_reference',
  'speed_m_s',
  'wait_s',
  'heading_deg',
  'in_words',
] as const;

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeCsv(mission: Mission): WrittenFile {
  const report = emptyReport('csv');
  const rows = [COLUMNS.join(',')];
  mission.items.forEach((item, i) => {
    const w = item as Partial<WaypointItem> & { speed?: number };
    rows.push(
      [
        i + 1,
        item.kind,
        'name' in item ? item.name : '',
        'lat' in item ? item.lat : '',
        'lng' in item ? item.lng : '',
        'height' in item ? item.height : '',
        'heightRef' in item && 'height' in item && item.height !== null ? item.heightRef : '',
        w.speed ?? '',
        w.holdS ?? '',
        w.headingDeg ?? '',
        describeItem(item),
      ]
        .map(cell)
        .join(','),
    );
  });
  report.kept.push(`${mission.items.length} item(s), one per row, with units in the column names.`);
  const actions = mission.items.reduce((n, i) => n + (i.kind === 'waypoint' ? (i.actions?.length ?? 0) : 0), 0);
  if (actions > 0) report.dropped.push({ what: 'Waypoint actions', count: actions, why: 'a row has no place for a list; they are counted in the last column' });
  const raws = mission.items.filter((i) => i.kind === 'raw').length;
  if (raws > 0) report.dropped.push({ what: 'Command parameters', count: raws, why: 'the command is named in the last column; its seven parameters are not written' });
  const triggers = mission.items.filter((i) => i.kind === 'camera-distance').length;
  if (triggers > 0) report.dropped.push({ what: 'Camera trigger distances', count: triggers, why: 'the distance is said in the last column; the table has no column for it' });
  const shapes = mission.areas.length + mission.circles.length + mission.rally.length;
  if (shapes > 0) report.dropped.push({ what: 'Geofences, areas and rally points', count: shapes, why: 'a table of items holds the mission only' });
  if (mission.home) report.dropped.push({ what: 'Takeoff point', count: 1, why: 'a table of items holds the mission only' });
  report.warnings.push('No ground station reads this file. It is for a spreadsheet.');
  return { name: `${safeName(mission.name)}.csv`, mime: 'text/csv', data: encode(rows.join('\n') + '\n'), report };
}

/** Split one CSV line, honouring quotes. */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function readCsv(bytes: Uint8Array, fileName: string): Mission {
  const lines = decode(bytes)
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '');
  if (lines.length < 2) throw new MissionFormatError('The table needs a header row and at least one row of values.');
  const header = splitCsv(lines[0]).map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iLat = col('latitude_deg', 'latitude', 'lat', 'y');
  const iLng = col('longitude_deg', 'longitude', 'lon', 'lng', 'long', 'x');
  if (iLat < 0 || iLng < 0) {
    throw new MissionFormatError(
      'The header row needs a latitude column and a longitude column. Accepted names: latitude_deg, latitude, lat and longitude_deg, longitude, lon, lng.',
    );
  }
  const iKind = col('kind');
  const iName = col('name', 'label', 'id');
  const iHeight = col('height_m', 'height', 'altitude_m', 'altitude', 'alt', 'elevation', 'ele');
  const iRef = col('height_reference');
  const iSpeed = col('speed_m_s', 'speed');
  const iHold = col('wait_s', 'hold_s', 'hold');
  const iHeading = col('heading_deg', 'heading', 'yaw');

  const mission = emptyMission(fileName.replace(/\.csv$/i, ''));
  mission.source = 'csv';
  mission.sourceFile = fileName;
  let bad = 0;
  let assumed = 0;
  let wordsOnly = 0;
  for (const line of lines.slice(1)) {
    const c = splitCsv(line);
    const n = (i: number): number | null => {
      if (i < 0 || c[i] === undefined || c[i] === '') return null;
      const v = Number(c[i]);
      return Number.isFinite(v) ? v : null;
    };
    const kind = iKind >= 0 ? c[iKind] : 'waypoint';
    const lat = n(iLat);
    const lng = n(iLng);
    const height = n(iHeight);
    // rows this app wrote for items a table cannot hold: the words are there, the numbers are not
    if (kind === 'camera-distance' || kind === 'raw') {
      wordsOnly += 1;
      continue;
    }
    if (kind === 'roi') {
      mission.items.push({ id: newId(), kind: 'roi', lat, lng, height });
      continue;
    }
    const stated = iRef >= 0 && isRef(c[iRef]) ? (c[iRef] as HeightRef) : null;
    if (height !== null && !stated) assumed += 1;
    const ref: HeightRef = stated ?? 'unknown';
    if (kind === 'return') mission.items.push({ id: newId(), kind: 'return' });
    else if (kind === 'land') mission.items.push({ id: newId(), kind: 'land', lat, lng });
    else if (kind === 'takeoff') mission.items.push({ id: newId(), kind: 'takeoff', lat, lng, height: height ?? 0, heightRef: ref });
    else if (kind === 'speed' && n(iSpeed)) mission.items.push({ id: newId(), kind: 'speed', speed: n(iSpeed) as number });
    else if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) bad += 1;
    else {
      mission.items.push({
        id: newId(),
        kind: 'waypoint',
        lat,
        lng,
        height,
        heightRef: height === null ? 'unknown' : ref,
        ...(iName >= 0 && c[iName] ? { name: c[iName] } : null),
        ...(n(iSpeed) ? { speed: n(iSpeed) as number } : null),
        ...(n(iHold) ? { holdS: n(iHold) as number } : null),
        ...(n(iHeading) !== null ? { headingDeg: n(iHeading) as number } : null),
      });
    }
  }
  if (mission.items.length === 0) throw new MissionFormatError('No row of the table holds a usable latitude and longitude.');
  if (bad > 0) mission.notes.push(`${bad} row(s) had no usable latitude and longitude and were left out.`);
  if (wordsOnly > 0) {
    mission.notes.push(`${wordsOnly} row(s) name a command and do not hold its numbers, so they were left out.`);
  }
  if (assumed > 0) {
    mission.notes.push(
      `${assumed} height(s) come with no height_reference column, so the table does not say what they are measured from. Set the reference before using this as a mission.`,
    );
  }
  return mission;
}
