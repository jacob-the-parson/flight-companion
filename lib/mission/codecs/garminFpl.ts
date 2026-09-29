// Garmin flight plan, .fpl — XML. Source: Garmin's own schema,
// http://www8.garmin.com/xmlschemas/FlightPlanv1.xsd
//
// This is a CREWED-AIRCRAFT format, read by Garmin avionics and by the tablet
// apps pilots use. It holds a table of named waypoints and a route, which is
// the order to visit them in. It does NOT hold a height for each leg, a speed,
// or any instruction to the aircraft. The schema's own words on the one height
// it allows: elevation is "in meters" and "ignored by panel mount devices".
//
// Limits taken from the schema:
//   identifier   [A-Z0-9]{1,12}
//   type         USER WAYPOINT | AIRPORT | NDB | VOR | INT | INT-VRP
//   country-code two of [A-Z0-9], or empty ("should be the empty string for user waypoints")
//   comment      up to 25 of [A-Z0-9 /], or empty
//   route-name   up to 25 of [A-Z0-9 /], or empty
//   waypoints    at most 3000 in the table, at most 300 in the route
//   flight-plan-index  1 to 98
import {
  emptyMission,
  emptyReport,
  MissionFormatError,
  newId,
  type Mission,
  type WaypointItem,
  type WrittenFile,
} from '../model.ts';
import { child, decode, encode, nodes, num, parseXml, text, XmlWriter } from '../xml.ts';
import { safeName } from './qgcPlan.ts';

export const GARMIN_NS = 'http://www8.garmin.com/xmlschemas/FlightPlan/v1';
export const GARMIN_TYPES = ['USER WAYPOINT', 'AIRPORT', 'NDB', 'VOR', 'INT', 'INT-VRP'] as const;
const MAX_TABLE = 3000;
const MAX_ROUTE = 300;

export function looksLikeFpl(xml: string): boolean {
  return /<flight-plan[\s>]/.test(xml) && xml.includes('garmin.com/xmlschemas/FlightPlan');
}

export function readGarminFpl(bytes: Uint8Array, fileName: string): Mission {
  const doc = parseXml(decode(bytes), ['waypoint', 'route-point']);
  const root = child(doc, 'flight-plan');
  if (!root) throw new MissionFormatError('The file has no <flight-plan>. It is not a Garmin flight plan.');

  const mission = emptyMission(fileName.replace(/\.fpl$/i, ''));
  mission.source = 'garmin-fpl';
  mission.sourceFile = fileName;
  mission.firmware = 'garmin';
  mission.vehicle = 'Garmin avionics (crewed aircraft)';

  interface Entry {
    identifier: string;
    type: string;
    country: string;
    lat: number;
    lng: number;
    comment: string;
    elevation: number | null;
  }
  const table = new Map<string, Entry>();
  const order: Entry[] = [];
  const key = (id: string, type: string, country: string) => `${id}|${type}|${country}`;

  for (const w of nodes(child(child(root, 'waypoint-table'), 'waypoint'))) {
    const lat = num(child(w, 'lat'));
    const lng = num(child(w, 'lon'));
    const identifier = text(child(w, 'identifier')) ?? '';
    if (lat === null || lng === null || identifier === '') continue;
    const entry: Entry = {
      identifier,
      type: text(child(w, 'type')) ?? 'USER WAYPOINT',
      country: text(child(w, 'country-code')) ?? '',
      lat,
      lng,
      comment: text(child(w, 'comment')) ?? '',
      elevation: num(child(w, 'elevation')),
    };
    table.set(key(entry.identifier, entry.type, entry.country), entry);
    order.push(entry);
  }
  if (order.length === 0) throw new MissionFormatError('The flight plan has no waypoints with a position.');

  const route = child(root, 'route');
  const routeName = text(child(route, 'route-name'));
  if (routeName) mission.name = routeName;
  const description = text(child(root, 'file-description')) ?? text(child(route, 'route-description'));
  if (description) mission.notes.push(`File description: ${description}`);

  const toItem = (e: Entry): WaypointItem => ({
    id: newId(),
    kind: 'waypoint',
    lat: e.lat,
    lng: e.lng,
    height: e.elevation,
    // the schema calls it elevation, the height of the place itself
    heightRef: e.elevation === null ? 'unknown' : 'amsl',
    name: e.identifier,
    ...(e.comment || e.type !== 'USER WAYPOINT'
      ? { note: [e.type !== 'USER WAYPOINT' ? e.type : '', e.comment].filter(Boolean).join(': ') }
      : null),
  });

  const points = nodes(child(route, 'route-point'));
  if (points.length > 0) {
    let missing = 0;
    for (const p of points) {
      const e = table.get(
        key(
          text(child(p, 'waypoint-identifier')) ?? '',
          text(child(p, 'waypoint-type')) ?? 'USER WAYPOINT',
          text(child(p, 'waypoint-country-code')) ?? '',
        ),
      );
      if (e) mission.items.push(toItem(e));
      else missing += 1;
    }
    if (missing > 0) {
      mission.notes.push(`${missing} route point(s) name a waypoint that is not in the file's table. They were left out.`);
    }
    const unused = order.length - new Set(mission.items.map((i) => (i.kind === 'waypoint' ? i.name : ''))).size;
    if (unused > 0) mission.notes.push(`${unused} waypoint(s) are in the table but not on the route.`);
  } else {
    mission.items = order.map(toItem);
    mission.notes.push('The file has a waypoint table and no route. The waypoints are listed in the order of the table.');
  }

  mission.notes.push(
    'A Garmin flight plan carries no flying height, no speed and no commands. Where a height is shown it is the elevation of the place, not a height to fly at. Give every waypoint a height before using this as a drone mission.',
  );
  const index = num(child(route, 'flight-plan-index'));
  mission.extras.garmin = { flightPlanIndex: index ?? 1, created: text(child(root, 'created')) };
  return mission;
}

/** Turn any text into what Garmin accepts for a comment or a route name. */
function garminText(s: string, max: number): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 /]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

export function writeGarminFpl(mission: Mission): WrittenFile {
  const report = emptyReport('garmin-fpl');
  const waypoints = mission.items.filter((i): i is WaypointItem => i.kind === 'waypoint');
  if (waypoints.length === 0) {
    throw new MissionFormatError('A Garmin flight plan needs at least one waypoint with a position.');
  }

  // identifiers: keep a name that already fits, number the rest, never repeat one
  const used = new Set<string>();
  const renamed: string[] = [];
  const idFor = (w: WaypointItem, i: number): string => {
    const wanted = (w.name ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    let id = wanted || `WP${String(i + 1).padStart(3, '0')}`;
    let n = 2;
    while (used.has(id)) {
      const tail = String(n);
      id = `${(wanted || 'WP').slice(0, 12 - tail.length)}${tail}`;
      n += 1;
    }
    used.add(id);
    if (w.name && w.name !== id) renamed.push(`"${w.name}" became ${id}`);
    return id;
  };

  let list = waypoints;
  if (list.length > MAX_ROUTE) {
    report.dropped.push({
      what: 'Waypoints past the 300th',
      count: list.length - MAX_ROUTE,
      why: 'a Garmin route holds at most 300 points',
    });
    list = list.slice(0, Math.min(MAX_ROUTE, MAX_TABLE));
  }

  const homeAmsl = mission.home?.heightAmsl ?? null;
  let elevationWritten = 0;
  let converted = 0;
  const rows = list.map((w, i) => {
    let elevation: number | null = null;
    if (w.height !== null) {
      if (w.heightRef === 'amsl') elevation = w.height;
      else if (w.heightRef === 'home' && homeAmsl !== null) {
        elevation = w.height + homeAmsl;
        converted += 1;
      }
    }
    if (elevation !== null) elevationWritten += 1;
    return { id: idFor(w, i), w, elevation };
  });

  const x = new XmlWriter();
  x.open('flight-plan', { xmlns: GARMIN_NS });
  x.leaf('file-description', `Written by Flight Companion from "${mission.name}"`);
  x.leaf('created', new Date().toISOString().replace(/\.\d+Z$/, 'Z'));
  x.open('waypoint-table');
  for (const r of rows) {
    x.open('waypoint');
    x.leaf('identifier', r.id);
    x.leaf('type', 'USER WAYPOINT');
    x.leaf('country-code', '');
    x.leaf('lat', r.w.lat);
    x.leaf('lon', r.w.lng);
    x.leaf('comment', garminText(r.w.note ?? '', 25));
    if (r.elevation !== null) x.leaf('elevation', Math.round(r.elevation * 10) / 10);
    x.close('waypoint');
  }
  x.close('waypoint-table');
  x.open('route');
  x.leaf('route-name', garminText(mission.name, 25) || 'ROUTE');
  const extra = mission.extras.garmin as { flightPlanIndex?: number } | undefined;
  const index = extra?.flightPlanIndex ?? 1;
  x.leaf('flight-plan-index', String(Math.min(98, Math.max(1, Math.round(index)))));
  for (const r of rows) {
    x.open('route-point');
    x.leaf('waypoint-identifier', r.id);
    x.leaf('waypoint-type', 'USER WAYPOINT');
    x.leaf('waypoint-country-code', '');
    x.close('route-point');
  }
  x.close('route');
  x.close('flight-plan');

  // ---- the report: this format loses more than any other
  report.kept.push(`${rows.length} waypoint${rows.length === 1 ? '' : 's'}, in order, each with its latitude and longitude.`);
  if (elevationWritten > 0) {
    report.kept.push(
      `${elevationWritten} height(s), written as "elevation" in metres above sea level. Garmin's schema says panel-mount devices ignore it.`,
    );
  }
  if (converted > 0 && homeAmsl !== null) {
    report.changed.push(
      `${converted} height(s) above takeoff were turned into heights above sea level by adding the takeoff point's ${homeAmsl} m.`,
    );
  }
  const noHeight = rows.length - elevationWritten;
  if (noHeight > 0) {
    report.dropped.push({
      what: 'Flying heights',
      count: noHeight,
      why:
        homeAmsl === null
          ? 'a Garmin plan has no height per leg, and the one elevation it allows is above sea level, which needs the takeoff point’s own height above sea level'
          : 'a Garmin plan has no height per leg',
    });
  }
  const count = (kind: string) => mission.items.filter((i) => i.kind === kind).length;
  const drop = (what: string, n: number, why: string) => {
    if (n > 0) report.dropped.push({ what, count: n, why });
  };
  drop('Take-off, landing and return', count('takeoff') + count('land') + count('return'), 'a Garmin plan is a route, not a set of instructions');
  drop('Speed changes', count('speed') + waypoints.filter((w) => w.speed).length + (mission.cruiseSpeed !== null ? 1 : 0), 'a Garmin plan has no speed');
  drop('Waits at a waypoint', waypoints.filter((w) => w.holdS).length, 'a Garmin plan has no hold time');
  drop('Camera and gimbal actions', count('camera-distance') + count('roi') + waypoints.reduce((n, w) => n + (w.actions?.length ?? 0), 0), 'a Garmin plan has no payload commands');
  drop('Other commands', count('raw'), 'a Garmin plan has no commands');
  drop('Geofences, areas and rally points', mission.areas.length + mission.circles.length + mission.rally.length, 'a Garmin plan holds a route only');
  if (renamed.length > 0) {
    report.changed.push(
      `${renamed.length} name(s) were changed to fit Garmin's identifier rule of 1 to 12 capital letters and digits: ${renamed.slice(0, 5).join('; ')}${renamed.length > 5 ? '; and more' : ''}.`,
    );
  }
  const unnamed = rows.filter((r) => !r.w.name).length;
  if (unnamed > 0) report.changed.push(`${unnamed} waypoint(s) had no name and were numbered: WP001, WP002 and so on.`);
  report.warnings.push(
    'This is a format for crewed aircraft. Files this app writes pass Garmin’s published schema. None has been loaded into a Garmin device or app.',
  );

  return { name: `${safeName(mission.name)}.fpl`, mime: 'application/xml', data: encode(x.toString()), report };
}
