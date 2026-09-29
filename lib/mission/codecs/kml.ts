// KML, .kml and plain .kmz — the format Google Earth made common, now an OGC
// standard. Source: OGC KML 2.2, schemas.opengis.net/kml/2.2.0/ogckml22.xsd
//
// KML describes SHAPES, not missions. It has three of interest:
//   Point        one place
//   LineString   places in order: a route or a track
//   Polygon      an area
// Coordinates are "longitude,latitude[,altitude]". What the altitude is measured
// from is given by <altitudeMode>: clampToGround (the default, altitude ignored),
// relativeToGround, or absolute (above sea level). KML has no "above the takeoff
// point", which is what most drone missions use.
import {
  emptyMission,
  emptyReport,
  MissionFormatError,
  newId,
  type HeightRef,
  type Mission,
  type WaypointItem,
  type WrittenFile,
} from '../model.ts';
import { child, decode, encode, nodes, parseCoordinates, parseXml, text, XmlWriter, type XmlNode } from '../xml.ts';
import { unzip } from './djiWpml.ts';
import { safeName } from './qgcPlan.ts';

export const KML_NS = 'http://www.opengis.net/kml/2.2';
const ARRAYS = ['Placemark', 'Folder', 'Document', 'LineString', 'Polygon', 'Point'];

export function looksLikeKml(xml: string): boolean {
  return /<kml[\s>]/.test(xml);
}

function refOf(mode: string | null, hasAltitude: boolean): HeightRef {
  if (!hasAltitude) return 'unknown';
  if (mode === 'absolute') return 'amsl';
  if (mode === 'relativeToGround') return 'ground';
  return 'unknown';
}

/** Every Placemark in a document, however deeply it is filed. */
function placemarks(node: XmlNode, out: XmlNode[] = []): XmlNode[] {
  out.push(...nodes(child(node, 'Placemark')));
  for (const key of ['Document', 'Folder']) for (const n of nodes(child(node, key))) placemarks(n, out);
  return out;
}

/** Geometry may sit directly in a Placemark or inside a MultiGeometry. */
function geometry(pm: XmlNode, name: string): XmlNode[] {
  return [...nodes(child(pm, name)), ...nodes(child(child(pm, 'MultiGeometry'), name))];
}

export function readKmlText(xml: string, fileName: string): Mission {
  const root = child(parseXml(xml, ARRAYS), 'kml');
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new MissionFormatError('The file has no <kml> element.');
  }
  const mission = emptyMission(fileName.replace(/\.(kml|kmz)$/i, ''));
  mission.source = 'kml';
  mission.sourceFile = fileName;
  const docName = text(child(nodes(child(root, 'Document'))[0], 'name'));
  if (docName) mission.name = docName.replace(/\.(kml|kmz)$/i, '');

  const all = placemarks(root as XmlNode);
  const points: WaypointItem[] = [];
  const lines: { name: string; items: WaypointItem[] }[] = [];
  let clamped = 0;

  for (const pm of all) {
    const name = text(child(pm, 'name')) ?? undefined;
    const description = text(child(pm, 'description')) ?? undefined;

    for (const poly of geometry(pm, 'Polygon')) {
      const ring = child(child(poly, 'outerBoundaryIs'), 'LinearRing');
      const pts = parseCoordinates(text(child(ring, 'coordinates'))).map((c) => ({ lat: c.lat, lng: c.lng }));
      // a ring repeats its first point at the end; the model does not
      if (pts.length > 1 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lng === pts[pts.length - 1].lng) pts.pop();
      if (pts.length >= 3) mission.areas.push({ name: name ?? 'Area', points: pts, role: 'survey' });
    }
    for (const line of geometry(pm, 'LineString')) {
      const mode = text(child(line, 'altitudeMode'));
      const coords = parseCoordinates(text(child(line, 'coordinates')));
      const flat = mode === null || mode === 'clampToGround';
      if (flat) clamped += coords.length;
      lines.push({
        name: name ?? 'Line',
        items: coords.map((c) => ({
          id: newId(),
          kind: 'waypoint' as const,
          lat: c.lat,
          lng: c.lng,
          height: flat ? null : c.alt,
          heightRef: refOf(mode, !flat && c.alt !== null),
        })),
      });
    }
    for (const pt of geometry(pm, 'Point')) {
      const mode = text(child(pt, 'altitudeMode'));
      const c = parseCoordinates(text(child(pt, 'coordinates')))[0];
      if (!c) continue;
      const flat = mode === null || mode === 'clampToGround';
      points.push({
        id: newId(),
        kind: 'waypoint',
        lat: c.lat,
        lng: c.lng,
        height: flat ? null : c.alt,
        heightRef: refOf(mode, !flat && c.alt !== null),
        ...(name ? { name } : null),
        ...(description ? { note: description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) } : null),
      });
    }
  }

  if (lines.length > 0) {
    // the longest line is the route; the rest are said, not silently dropped
    lines.sort((a, b) => b.items.length - a.items.length);
    mission.items = lines[0].items;
    if (lines.length > 1) {
      mission.notes.push(
        `The file holds ${lines.length} lines. The longest, "${lines[0].name}" with ${lines[0].items.length} points, was read as the route.`,
      );
    }
    if (points.length > 0) {
      mission.notes.push(`${points.length} separate point(s) in the file are not on the route and were left out.`);
    }
  } else {
    mission.items = points;
    if (points.length > 0) {
      mission.notes.push('The file holds separate points and no line. They are listed in the order of the file, which may not be the order to fly them.');
    }
  }
  if (mission.items.length === 0 && mission.areas.length === 0) {
    throw new MissionFormatError('The file holds no points, lines or areas.');
  }
  if (clamped > 0) {
    mission.notes.push(
      'The line is drawn on the ground: the file gives it no flying height. Give every waypoint a height before using it as a mission.',
    );
  }
  mission.notes.push('KML describes shapes. It carries no speed, no commands and no takeoff or landing.');
  return mission;
}

export function readKml(bytes: Uint8Array, fileName: string): Mission {
  return readKmlText(decode(bytes), fileName);
}

/** A plain .kmz: a ZIP whose first .kml is the document. */
export function readKmz(bytes: Uint8Array, fileName: string): Mission {
  const files = unzip(bytes);
  const path =
    Object.keys(files).find((p) => /(^|\/)doc\.kml$/i.test(p)) ?? Object.keys(files).find((p) => /\.kml$/i.test(p));
  if (!path) throw new MissionFormatError('The archive holds no .kml file.');
  return readKmlText(decode(files[path]), fileName);
}

export function writeKml(mission: Mission): WrittenFile {
  const report = emptyReport('kml');
  const way = mission.items.filter((i): i is WaypointItem => i.kind === 'waypoint');
  if (way.length === 0 && mission.areas.length === 0) {
    throw new MissionFormatError('There is nothing to draw: the mission has no waypoints and no areas.');
  }
  const homeAmsl = mission.home?.heightAmsl ?? null;

  // pick ONE altitude mode for the whole line: a KML line cannot mix them
  const refs = new Set(way.filter((w) => w.height !== null).map((w) => w.heightRef));
  let mode: 'absolute' | 'relativeToGround' | 'clampToGround' = 'clampToGround';
  let heightOf: (w: WaypointItem) => number = () => 0;
  const complete = way.length > 0 && way.every((w) => w.height !== null);
  if (complete && refs.size === 1) {
    const ref = [...refs][0];
    if (ref === 'amsl') {
      mode = 'absolute';
      heightOf = (w) => w.height as number;
      report.kept.push('Heights, as heights above sea level.');
    } else if (ref === 'ground') {
      mode = 'relativeToGround';
      heightOf = (w) => w.height as number;
      report.kept.push('Heights, as heights above the ground.');
    } else if (ref === 'home' && homeAmsl !== null) {
      mode = 'absolute';
      heightOf = (w) => (w.height as number) + homeAmsl;
      report.changed.push(`Heights above takeoff were turned into heights above sea level by adding the takeoff point's ${homeAmsl} m.`);
    } else if (ref === 'home') {
      mode = 'relativeToGround';
      heightOf = (w) => w.height as number;
      report.changed.push(
        'KML has no "above the takeoff point". Heights are written as heights above the ground, with the same numbers. On level ground the two agree; on a slope they do not.',
      );
    }
  }
  if (mode === 'clampToGround' && way.some((w) => w.height !== null)) {
    report.dropped.push({
      what: 'Heights',
      count: way.filter((w) => w.height !== null).length,
      why: refs.size > 1 ? 'they are measured from more than one reference, and a KML line has one' : 'their reference has no KML equivalent',
    });
  }

  const x = new XmlWriter();
  x.open('kml', { xmlns: KML_NS }).open('Document');
  x.leaf('name', mission.name);
  if (way.length > 1) {
    x.open('Placemark');
    x.leaf('name', `${mission.name} route`);
    x.open('LineString');
    if (mode !== 'clampToGround') x.leaf('extrude', '1');
    x.leaf('tessellate', '1');
    if (mode !== 'clampToGround') x.leaf('altitudeMode', mode);
    x.leaf('coordinates', way.map((w) => `${w.lng.toFixed(8)},${w.lat.toFixed(8)},${heightOf(w).toFixed(2)}`).join(' '));
    x.close('LineString').close('Placemark');
  }
  way.forEach((w, i) => {
    x.open('Placemark');
    x.leaf('name', w.name ?? String(i + 1));
    if (w.note) x.leaf('description', w.note);
    x.open('Point');
    if (mode !== 'clampToGround') x.leaf('altitudeMode', mode);
    x.leaf('coordinates', `${w.lng.toFixed(8)},${w.lat.toFixed(8)},${heightOf(w).toFixed(2)}`);
    x.close('Point').close('Placemark');
  });
  if (mission.home) {
    x.open('Placemark').leaf('name', 'Takeoff point');
    x.open('Point').leaf('coordinates', `${mission.home.lng.toFixed(8)},${mission.home.lat.toFixed(8)},0`).close('Point');
    x.close('Placemark');
  }
  for (const a of mission.areas) {
    const ring = [...a.points, a.points[0]];
    x.open('Placemark');
    x.leaf('name', a.role === 'survey' ? a.name : `${a.name} (${a.role})`);
    x.open('Polygon').leaf('tessellate', '1').open('outerBoundaryIs').open('LinearRing');
    x.leaf('coordinates', ring.map((p) => `${p.lng.toFixed(8)},${p.lat.toFixed(8)},0`).join(' '));
    x.close('LinearRing').close('outerBoundaryIs').close('Polygon').close('Placemark');
  }
  x.close('Document').close('kml');

  report.kept.push(`${way.length} waypoint(s), as a line and as separate points.`);
  if (mission.areas.length > 0) report.kept.push(`${mission.areas.length} area(s).`);
  if (mission.home) report.kept.push('The takeoff point.');
  const count = (kind: string) => mission.items.filter((i) => i.kind === kind).length;
  const drop = (what: string, n: number, why: string) => {
    if (n > 0) report.dropped.push({ what, count: n, why });
  };
  drop('Take-off, landing and return', count('takeoff') + count('land') + count('return'), 'KML describes shapes, not instructions');
  drop('Speeds and waits', count('speed') + way.filter((w) => w.speed || w.holdS).length + (mission.cruiseSpeed !== null ? 1 : 0), 'KML has neither');
  drop('Camera, gimbal and other commands', count('camera-distance') + count('roi') + count('raw') + way.reduce((n, w) => n + (w.actions?.length ?? 0), 0), 'KML has no commands');
  drop('Geofence circles', mission.circles.length, 'not written yet');
  drop('Rally points', mission.rally.length, 'not written yet');
  report.warnings.push('A KML is a picture of the route for a map. It is not a mission an aircraft can fly.');

  return { name: `${safeName(mission.name)}.kml`, mime: 'application/vnd.google-earth.kml+xml', data: encode(x.toString()), report };
}
