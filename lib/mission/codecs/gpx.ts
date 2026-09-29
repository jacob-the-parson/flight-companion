// GPX, .gpx — the exchange format of handheld GPS units and mapping apps.
// Source: GPX 1.1 schema, topografix.com/GPX/1/1/gpx.xsd
//
// Three things a GPX can hold:
//   wpt   a waypoint on its own
//   rte   a route: waypoints in the order to visit them (rtept)
//   trk   a track: where something actually went (trkseg / trkpt)
// A point has lat and lon as attributes and an optional <ele>, which the schema
// defines as "Elevation (in meters) of the point". It carries no speed to fly
// at and no commands.
import {
  emptyMission,
  emptyReport,
  MissionFormatError,
  newId,
  type Mission,
  type WaypointItem,
  type WrittenFile,
} from '../model.ts';
import { child, decode, encode, nodes, num, parseXml, text, XmlWriter, type XmlNode } from '../xml.ts';
import { safeName } from './qgcPlan.ts';

const ARRAYS = ['wpt', 'rte', 'rtept', 'trk', 'trkseg', 'trkpt'];

export function looksLikeGpx(xml: string): boolean {
  return /<gpx[\s>]/.test(xml);
}

function point(n: XmlNode): WaypointItem | null {
  const lat = num(n['@_lat']);
  const lng = num(n['@_lon']);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const ele = num(child(n, 'ele'));
  const name = text(child(n, 'name'));
  const note = text(child(n, 'desc')) ?? text(child(n, 'cmt'));
  return {
    id: newId(),
    kind: 'waypoint',
    lat,
    lng,
    height: ele,
    heightRef: ele === null ? 'unknown' : 'amsl',
    ...(name ? { name } : null),
    ...(note ? { note } : null),
  };
}

export function readGpx(bytes: Uint8Array, fileName: string): Mission {
  const root = child(parseXml(decode(bytes), ARRAYS), 'gpx');
  if (!root) throw new MissionFormatError('The file has no <gpx> element.');

  const mission = emptyMission(fileName.replace(/\.gpx$/i, ''));
  mission.source = 'gpx';
  mission.sourceFile = fileName;
  const creator = text((root as XmlNode)['@_creator']);
  if (creator) mission.notes.push(`Written by: ${creator}`);
  const metaName = text(child(child(root, 'metadata'), 'name'));
  if (metaName) mission.name = metaName;

  const keep = (list: XmlNode[]) => list.map(point).filter((p): p is WaypointItem => p !== null);
  const routes = nodes(child(root, 'rte'));
  const tracks = nodes(child(root, 'trk'));
  const loose = keep(nodes(child(root, 'wpt')));

  if (routes.length > 0) {
    mission.items = keep(nodes(child(routes[0], 'rtept')));
    const name = text(child(routes[0], 'name'));
    if (name) mission.name = name;
    if (routes.length > 1) mission.notes.push(`The file holds ${routes.length} routes. The first was read.`);
    if (loose.length > 0) mission.notes.push(`${loose.length} separate waypoint(s) are not on the route and were left out.`);
  } else if (tracks.length > 0) {
    const segs = nodes(child(tracks[0], 'trkseg'));
    const pts = segs.flatMap((s) => keep(nodes(child(s, 'trkpt'))));
    // a track can hold thousands of fixes; a mission of them is no use to anyone
    const max = 500;
    if (pts.length > max) {
      const stride = Math.ceil(pts.length / max);
      mission.items = pts.filter((_, i) => i % stride === 0 || i === pts.length - 1);
      mission.notes.push(`The track has ${pts.length} points. Every ${stride}${stride === 2 ? 'nd' : stride === 3 ? 'rd' : 'th'} was kept, ${mission.items.length} in all.`);
    } else {
      mission.items = pts;
    }
    mission.notes.push('This is a track: a record of where something went, not a plan. It was read as a route.');
  } else {
    mission.items = loose;
    if (loose.length > 0) {
      mission.notes.push('The file holds separate waypoints and no route. They are listed in the order of the file, which may not be the order to fly them.');
    }
  }
  if (mission.items.length === 0) throw new MissionFormatError('The file holds no points.');
  mission.notes.push('Heights in a GPX are elevations above sea level. It carries no speed and no commands.');
  return mission;
}

export function writeGpx(mission: Mission): WrittenFile {
  const report = emptyReport('gpx');
  const way = mission.items.filter((i): i is WaypointItem => i.kind === 'waypoint');
  if (way.length === 0) throw new MissionFormatError('A GPX route needs at least one waypoint.');
  const homeAmsl = mission.home?.heightAmsl ?? null;

  let written = 0;
  let converted = 0;
  const ele = (w: WaypointItem): number | null => {
    if (w.height === null) return null;
    if (w.heightRef === 'amsl') return w.height;
    if (w.heightRef === 'home' && homeAmsl !== null) {
      converted += 1;
      return w.height + homeAmsl;
    }
    return null;
  };

  const x = new XmlWriter();
  x.open('gpx', {
    version: '1.1',
    creator: 'Flight Companion',
    xmlns: 'http://www.topografix.com/GPX/1/1',
    'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
    'xsi:schemaLocation': 'http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd',
  });
  x.open('metadata').leaf('name', mission.name).leaf('time', new Date().toISOString().replace(/\.\d+Z$/, 'Z')).close('metadata');
  x.open('rte');
  x.leaf('name', mission.name);
  way.forEach((w, i) => {
    x.open('rtept', { lat: w.lat.toFixed(8), lon: w.lng.toFixed(8) });
    // the schema fixes the order: ele, then name, then the comment fields
    const e = ele(w);
    if (e !== null) {
      x.leaf('ele', Math.round(e * 100) / 100);
      written += 1;
    }
    x.leaf('name', w.name ?? String(i + 1));
    if (w.note) x.leaf('desc', w.note);
    x.close('rtept');
  });
  x.close('rte').close('gpx');

  report.kept.push(`${way.length} waypoint(s), in order, as one route.`);
  if (written > 0) report.kept.push(`${written} height(s), as elevation above sea level.`);
  if (converted > 0 && homeAmsl !== null) {
    report.changed.push(`${converted} height(s) above takeoff were turned into elevations above sea level by adding the takeoff point's ${homeAmsl} m.`);
  }
  const count = (kind: string) => mission.items.filter((i) => i.kind === kind).length;
  const drop = (what: string, n: number, why: string) => {
    if (n > 0) report.dropped.push({ what, count: n, why });
  };
  drop('Heights', way.length - written, 'a GPX elevation is above sea level, and these heights could not be restated that way');
  drop('Take-off, landing and return', count('takeoff') + count('land') + count('return'), 'a GPX route is a list of places');
  drop('Speeds and waits', count('speed') + way.filter((w) => w.speed || w.holdS).length + (mission.cruiseSpeed !== null ? 1 : 0), 'GPX has neither');
  drop('Camera, gimbal and other commands', count('camera-distance') + count('roi') + count('raw') + way.reduce((n, w) => n + (w.actions?.length ?? 0), 0), 'GPX has no commands');
  drop('Geofences, areas and rally points', mission.areas.length + mission.circles.length + mission.rally.length, 'a GPX route holds a route only');
  report.warnings.push('A GPX is a route for a map or a handheld GPS. It is not a mission an aircraft can fly.');

  return { name: `${safeName(mission.name)}.gpx`, mime: 'application/gpx+xml', data: encode(x.toString()), report };
}
