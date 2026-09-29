// DJI WPML route, .kmz — a ZIP holding two XML files.
// Source: DJI's Cloud-API-Doc repository (MIT), docs/en/60.api-reference/00.dji-wpml/
//
//   wpmz/template.kml    the "template file": what the user planned
//   wpmz/waylines.wpml   the "execution file": what the aircraft flies
//   wpmz/res/            optional resources
//
// Both are KML with extra elements in the namespace http://www.dji.com/wpmz/1.0.2.
// Coordinates are "longitude,latitude", as in KML.
//
// DJI's product lists for this format name M300 RTK, M350 RTK, M30/M30T,
// M3E/M3T/M3M and M3D/M3TD. No other aircraft is claimed here.
//
// Reading prefers waylines.wpml, because that is what flies. Writing produces
// both files from the "waypoint" template type. The three mapping templates
// (mapping2d, mapping3d, mappingStrip) are read for their area and route; they
// are not written, because generating a mapping route is the job of DJI's tools.
import { strFromU8, unzipSync, zipSync } from 'fflate';
import {
  emptyMission,
  emptyReport,
  MissionFormatError,
  newId,
  type HeightRef,
  type Mission,
  type MissionAction,
  type WaypointItem,
  type WrittenFile,
} from '../model.ts';
import { child, encode, nodes, num, parseCoordinates, parseXml, text, XmlWriter, type XmlNode, type XmlValue } from '../xml.ts';
import { safeName } from './qgcPlan.ts';

export const WPML_NS = 'http://www.dji.com/wpmz/1.0.2';
const KML_NS = 'http://www.opengis.net/kml/2.2';

/** Aircraft and the camera each is sold with, from DJI's tables of enum values. */
export const DJI_AIRCRAFT = [
  { id: 'm30', label: 'Matrice 30', drone: 67, sub: 0, payload: 52 },
  { id: 'm30t', label: 'Matrice 30T', drone: 67, sub: 1, payload: 53 },
  { id: 'm3e', label: 'Mavic 3E', drone: 77, sub: 0, payload: 66 },
  { id: 'm3t', label: 'Mavic 3T', drone: 77, sub: 1, payload: 67 },
  { id: 'm3m', label: 'Mavic 3M', drone: 77, sub: 2, payload: 68 },
  { id: 'm3d', label: 'Matrice 3D', drone: 91, sub: 0, payload: 80 },
  { id: 'm3td', label: 'Matrice 3TD', drone: 91, sub: 1, payload: 81 },
  { id: 'm350-h20', label: 'Matrice 350 RTK with H20', drone: 89, sub: 0, payload: 42 },
  { id: 'm350-h20t', label: 'Matrice 350 RTK with H20T', drone: 89, sub: 0, payload: 43 },
  { id: 'm350-h30', label: 'Matrice 350 RTK with H30', drone: 89, sub: 0, payload: 82 },
  { id: 'm350-h30t', label: 'Matrice 350 RTK with H30T', drone: 89, sub: 0, payload: 83 },
  { id: 'm300-h20', label: 'Matrice 300 RTK with H20', drone: 60, sub: 0, payload: 42 },
  { id: 'm300-h20t', label: 'Matrice 300 RTK with H20T', drone: 60, sub: 0, payload: 43 },
] as const;

export type DjiAircraftId = (typeof DJI_AIRCRAFT)[number]['id'];

const ARRAYS = ['Folder', 'Placemark', 'wpml:actionGroup', 'wpml:action'];

export function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);
}

/** The files of a .kmz, by their path inside it. */
export function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes);
  } catch {
    throw new MissionFormatError('The file could not be unpacked. A .kmz is a ZIP archive, and this one is damaged.');
  }
}

export function isWpmlArchive(files: Record<string, Uint8Array>): boolean {
  return Object.keys(files).some((p) => /(^|\/)wpmz\/(waylines\.wpml|template\.kml)$/i.test(p));
}

function find(files: Record<string, Uint8Array>, name: RegExp): string | null {
  const path = Object.keys(files).find((p) => name.test(p));
  return path ? strFromU8(files[path]) : null;
}

const HEIGHT_MODE: Record<string, HeightRef> = {
  WGS84: 'ellipsoid',
  relativeToStartPoint: 'home',
  realTimeFollowSurface: 'ground',
  aboveGroundLevel: 'ground',
  EGM96: 'amsl',
};

function readActions(placemark: XmlNode): MissionAction[] {
  const out: MissionAction[] = [];
  for (const group of nodes(child(placemark, 'wpml:actionGroup'))) {
    for (const a of nodes(child(group, 'wpml:action'))) {
      const name = text(child(a, 'wpml:actionActuatorFunc')) ?? '';
      const p = child(a, 'wpml:actionActuatorFuncParam');
      const get = (k: string) => num(child(p, k));
      if (name === 'takePhoto') out.push({ kind: 'photo' });
      else if (name === 'startRecord') out.push({ kind: 'video-start' });
      else if (name === 'stopRecord') out.push({ kind: 'video-stop' });
      else if (name === 'hover') out.push({ kind: 'hover', seconds: get('wpml:hoverTime') ?? 0 });
      else if (name === 'rotateYaw') out.push({ kind: 'yaw', headingDeg: get('wpml:aircraftHeading') ?? 0 });
      else if (name === 'gimbalRotate') {
        out.push({
          kind: 'gimbal',
          pitchDeg: get('wpml:gimbalPitchRotateEnable') === 1 ? get('wpml:gimbalPitchRotateAngle') : null,
          yawDeg: get('wpml:gimbalYawRotateEnable') === 1 ? get('wpml:gimbalYawRotateAngle') : null,
        });
      } else {
        const params: Record<string, string> = {};
        if (p && typeof p === 'object' && !Array.isArray(p)) {
          for (const [k, v] of Object.entries(p)) {
            const t = text(v as XmlValue);
            if (t !== null) params[k.replace(/^wpml:/, '')] = t;
          }
        }
        out.push({ kind: 'raw', name: name || 'unnamed', params });
      }
    }
  }
  return out;
}

export function readDjiWpml(bytes: Uint8Array, fileName: string): Mission {
  const files = unzip(bytes);
  const waylines = find(files, /(^|\/)wpmz\/waylines\.wpml$/i);
  const template = find(files, /(^|\/)wpmz\/template\.kml$/i);
  if (!waylines && !template) {
    throw new MissionFormatError(
      'The archive has no wpmz/waylines.wpml and no wpmz/template.kml. It is a .kmz, but not a DJI route.',
    );
  }

  const mission = emptyMission(fileName.replace(/\.kmz$/i, ''));
  mission.source = 'dji-wpml';
  mission.sourceFile = fileName;
  mission.firmware = 'dji';

  const executing = !!waylines;
  const doc = child(child(parseXml(waylines ?? template ?? '', ARRAYS), 'kml'), 'Document');
  if (!doc) throw new MissionFormatError('The route file has no <Document>.');
  if (!executing) {
    mission.notes.push(
      'The archive holds a template and no execution file. Heights are the planned ones; the aircraft flies the execution file that DJI Pilot 2 or FlightHub 2 generates from it.',
    );
  }

  const config = child(doc, 'wpml:missionConfig');
  const droneEnum = num(child(child(config, 'wpml:droneInfo'), 'wpml:droneEnumValue'));
  const droneSub = num(child(child(config, 'wpml:droneInfo'), 'wpml:droneSubEnumValue')) ?? 0;
  const payloadEnum = num(child(child(config, 'wpml:payloadInfo'), 'wpml:payloadEnumValue'));
  const known = DJI_AIRCRAFT.find(
    (a) => a.drone === droneEnum && a.sub === droneSub && (payloadEnum === null || a.payload === payloadEnum),
  ) ?? DJI_AIRCRAFT.find((a) => a.drone === droneEnum && a.sub === droneSub);
  mission.vehicle = known
    ? `DJI ${known.label}`
    : droneEnum !== null
      ? `DJI aircraft, type ${droneEnum}/${droneSub}`
      : 'DJI aircraft';

  const takeoffHeight = num(child(config, 'wpml:takeOffSecurityHeight'));
  const finish = text(child(config, 'wpml:finishAction'));
  const transit = num(child(config, 'wpml:globalTransitionalSpeed'));

  // the takeoff reference point is "latitude,longitude,height", unlike a coordinate
  const ref = text(child(config, 'wpml:takeOffRefPoint'));
  if (ref) {
    const p = ref.split(',').map(Number);
    if (p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 90) {
      mission.home = { lat: p[0], lng: p[1], heightAmsl: null };
      mission.notes.push(
        'The takeoff reference point was read as the home position. Its height is not read as a height above sea level: the file does not say which surface it is measured from.',
      );
    }
  }

  const folders = nodes(child(doc, 'Folder'));
  if (folders.length === 0) throw new MissionFormatError('The route file has no <Folder>, so it holds no route.');
  if (folders.length > 1) {
    mission.notes.push(
      `The file holds ${folders.length} routes. The first is shown. A "mapping3d" template produces five, one for each camera direction.`,
    );
  }
  const folder = folders[0];
  const templateType = text(child(folder, 'wpml:templateType'));
  const coord = child(folder, 'wpml:waylineCoordinateSysParam');
  const mode =
    text(child(folder, 'wpml:executeHeightMode')) ?? text(child(coord, 'wpml:heightMode')) ?? '';
  const heightRef: HeightRef = HEIGHT_MODE[mode] ?? 'unknown';
  if (heightRef === 'unknown') {
    mission.notes.push(`The file's height mode is "${mode || 'missing'}", which DJI's specification does not list.`);
  }
  const globalSpeed = num(child(folder, 'wpml:autoFlightSpeed'));
  const globalHeight = num(child(folder, 'wpml:globalHeight'));
  mission.cruiseSpeed = globalSpeed;

  if (takeoffHeight !== null) {
    mission.items.push({ id: newId(), kind: 'takeoff', lat: null, lng: null, height: takeoffHeight, heightRef: 'home' });
  }

  let areas = 0;
  for (const pm of nodes(child(folder, 'Placemark'))) {
    const polygon = child(pm, 'Polygon');
    if (polygon) {
      const ring = child(child(polygon, 'outerBoundaryIs'), 'LinearRing');
      const points = parseCoordinates(text(child(ring, 'coordinates'))).map((c) => ({ lat: c.lat, lng: c.lng }));
      if (points.length >= 3) {
        mission.areas.push({ name: `${templateType ?? 'mapping'} area`, points, role: 'survey' });
        areas += 1;
      }
      continue;
    }
    const c = parseCoordinates(text(child(child(pm, 'Point'), 'coordinates')))[0];
    if (!c) continue;
    const useGlobalHeight = num(child(pm, 'wpml:useGlobalHeight')) === 1;
    const height =
      num(child(pm, 'wpml:executeHeight')) ??
      (useGlobalHeight ? globalHeight : null) ??
      num(child(pm, 'wpml:height')) ??
      globalHeight;
    const speed = num(child(pm, 'wpml:waypointSpeed'));
    const heading = child(pm, 'wpml:waypointHeadingParam');
    const headingMode = text(child(heading, 'wpml:waypointHeadingMode'));
    const actions = readActions(pm);
    const item: WaypointItem = {
      id: newId(),
      kind: 'waypoint',
      lat: c.lat,
      lng: c.lng,
      height,
      heightRef,
      ...(speed !== null && speed !== globalSpeed ? { speed } : null),
      ...(headingMode === 'fixed' && num(child(heading, 'wpml:waypointHeadingAngle')) !== null
        ? { headingDeg: num(child(heading, 'wpml:waypointHeadingAngle')) as number }
        : null),
      ...(actions.length ? { actions } : null),
    };
    if (num(child(pm, 'wpml:isRisky')) === 1) item.note = 'Marked as a risky point in the file';
    mission.items.push(item);
  }

  if (finish === 'goHome') mission.items.push({ id: newId(), kind: 'return' });
  else if (finish === 'autoLand') mission.items.push({ id: newId(), kind: 'land', lat: null, lng: null });
  else if (finish === 'gotoFirstWaypoint') {
    mission.notes.push('When the route ends the aircraft flies back to the first waypoint and stops there.');
  }

  if (templateType && templateType !== 'waypoint') {
    mission.notes.push(
      `This route was planned with DJI's "${templateType}" template. ${areas > 0 ? 'Its area was read. ' : ''}Saved from here as a DJI route it becomes a plain waypoint route.`,
    );
  }

  mission.extras.dji = {
    droneEnumValue: droneEnum,
    droneSubEnumValue: droneSub,
    payloadEnumValue: payloadEnum,
    flyToWaylineMode: text(child(config, 'wpml:flyToWaylineMode')),
    finishAction: finish,
    exitOnRCLost: text(child(config, 'wpml:exitOnRCLost')),
    executeRCLostAction: text(child(config, 'wpml:executeRCLostAction')),
    globalTransitionalSpeed: transit,
    globalRTHHeight: num(child(config, 'wpml:globalRTHHeight')),
    templateType,
  };
  return mission;
}

export interface DjiWriteOptions {
  aircraft: DjiAircraftId;
}

function writeActions(x: XmlWriter, index: number, groupId: number, actions: MissionAction[]): number {
  const known = actions.filter((a) => a.kind !== 'raw');
  if (known.length === 0) return 0;
  x.open('wpml:actionGroup');
  x.leaf('wpml:actionGroupId', String(groupId));
  x.leaf('wpml:actionGroupStartIndex', String(index));
  x.leaf('wpml:actionGroupEndIndex', String(index));
  x.leaf('wpml:actionGroupMode', 'sequence');
  x.open('wpml:actionTrigger').leaf('wpml:actionTriggerType', 'reachPoint').close('wpml:actionTrigger');
  known.forEach((a, id) => {
    x.open('wpml:action');
    x.leaf('wpml:actionId', String(id));
    const func =
      a.kind === 'photo' ? 'takePhoto'
      : a.kind === 'video-start' ? 'startRecord'
      : a.kind === 'video-stop' ? 'stopRecord'
      : a.kind === 'hover' ? 'hover'
      : a.kind === 'yaw' ? 'rotateYaw'
      : 'gimbalRotate';
    x.leaf('wpml:actionActuatorFunc', func);
    x.open('wpml:actionActuatorFuncParam');
    if (a.kind === 'hover') x.leaf('wpml:hoverTime', a.seconds);
    else if (a.kind === 'yaw') {
      // DJI counts heading from −180 to 180, north at 0
      const h = ((((a.headingDeg + 180) % 360) + 360) % 360) - 180;
      x.leaf('wpml:aircraftHeading', h);
      x.leaf('wpml:aircraftPathMode', 'clockwise');
    } else if (a.kind === 'photo' || a.kind === 'video-start') {
      // as in the sample in DJI's specification: a file suffix and the mount position
      x.leaf('wpml:fileSuffix', `point${index}`);
      x.leaf('wpml:payloadPositionIndex', '0');
    } else if (a.kind === 'gimbal') {
      x.leaf('wpml:payloadPositionIndex', '0');
      x.leaf('wpml:gimbalHeadingYawBase', 'north');
      x.leaf('wpml:gimbalRotateMode', 'absoluteAngle');
      x.leaf('wpml:gimbalPitchRotateEnable', a.pitchDeg === null ? '0' : '1');
      x.leaf('wpml:gimbalPitchRotateAngle', a.pitchDeg ?? 0);
      x.leaf('wpml:gimbalRollRotateEnable', '0');
      x.leaf('wpml:gimbalRollRotateAngle', '0');
      x.leaf('wpml:gimbalYawRotateEnable', a.yawDeg === null ? '0' : '1');
      x.leaf('wpml:gimbalYawRotateAngle', a.yawDeg ?? 0);
      x.leaf('wpml:gimbalRotateTimeEnable', '0');
      x.leaf('wpml:gimbalRotateTime', '0');
    } else {
      x.leaf('wpml:payloadPositionIndex', '0');
    }
    x.close('wpml:actionActuatorFuncParam');
    x.close('wpml:action');
  });
  x.close('wpml:actionGroup');
  return known.length;
}

export function writeDjiWpml(mission: Mission, options: DjiWriteOptions): WrittenFile {
  const report = emptyReport('dji-wpml');
  const aircraft = DJI_AIRCRAFT.find((a) => a.id === options.aircraft);
  if (!aircraft) throw new MissionFormatError('Choose the DJI aircraft the route is for.');

  const all = mission.items.filter((i): i is WaypointItem => i.kind === 'waypoint');
  if (all.length < 2) throw new MissionFormatError('A DJI route needs at least two waypoints.');
  const homeAmsl = mission.home?.heightAmsl ?? null;

  // DJI's relative mode is the one that needs no terrain or geoid model, so every
  // height is brought to "above takeoff". A height that cannot be is a refusal.
  let converted = 0;
  const heights: number[] = [];
  for (const w of all) {
    if (w.height === null) {
      throw new MissionFormatError(
        `Waypoint ${all.indexOf(w) + 1} has no height. Every waypoint of a DJI route needs one.`,
      );
    }
    if (w.heightRef === 'home') heights.push(w.height);
    else if (w.heightRef === 'amsl' && homeAmsl !== null) {
      heights.push(w.height - homeAmsl);
      converted += 1;
    } else {
      throw new MissionFormatError(
        w.heightRef === 'amsl'
          ? 'The heights are above sea level and the takeoff point’s own height above sea level is not known, so they cannot be turned into heights above takeoff. Set the takeoff point’s height, or restate the waypoints above takeoff.'
          : `Waypoint ${all.indexOf(w) + 1} states its height ${w.heightRef === 'unknown' ? 'without saying what from' : `as ${w.heightRef}`}. Restate the heights above takeoff before writing a DJI route.`,
      );
    }
  }

  const extra = (mission.extras.dji ?? {}) as Record<string, unknown>;
  const speed = mission.cruiseSpeed ?? 5;
  const takeoffItem = mission.items.find((i) => i.kind === 'takeoff');
  const wantedTakeoff = takeoffItem && takeoffItem.kind === 'takeoff' ? takeoffItem.height : heights[0];
  const takeoff = Math.min(1500, Math.max(1.2, wantedTakeoff));
  const last = mission.items[mission.items.length - 1];
  const finish = last?.kind === 'return' ? 'goHome' : last?.kind === 'land' ? 'autoLand' : 'noAction';
  const rth = typeof extra.globalRTHHeight === 'number' ? extra.globalRTHHeight : Math.max(takeoff, ...heights);
  const now = Date.now();

  const missionConfig = (x: XmlWriter, isTemplate: boolean) => {
    x.open('wpml:missionConfig');
    x.leaf('wpml:flyToWaylineMode', typeof extra.flyToWaylineMode === 'string' ? extra.flyToWaylineMode : 'safely');
    x.leaf('wpml:finishAction', finish);
    x.leaf('wpml:exitOnRCLost', typeof extra.exitOnRCLost === 'string' ? extra.exitOnRCLost : 'executeLostAction');
    x.leaf('wpml:executeRCLostAction', typeof extra.executeRCLostAction === 'string' ? extra.executeRCLostAction : 'goBack');
    x.leaf('wpml:takeOffSecurityHeight', takeoff);
    if (isTemplate && mission.home) {
      x.leaf('wpml:takeOffRefPoint', `${mission.home.lat},${mission.home.lng},${homeAmsl ?? 0}`);
    }
    x.leaf('wpml:globalTransitionalSpeed', typeof extra.globalTransitionalSpeed === 'number' ? extra.globalTransitionalSpeed : speed);
    x.leaf('wpml:globalRTHHeight', rth);
    x.open('wpml:droneInfo');
    x.leaf('wpml:droneEnumValue', String(aircraft.drone));
    x.leaf('wpml:droneSubEnumValue', String(aircraft.sub));
    x.close('wpml:droneInfo');
    x.open('wpml:payloadInfo');
    x.leaf('wpml:payloadEnumValue', String(aircraft.payload));
    x.leaf('wpml:payloadPositionIndex', '0');
    x.close('wpml:payloadInfo');
    x.close('wpml:missionConfig');
  };

  let actionsWritten = 0;
  let rawActions = 0;
  const placemark = (x: XmlWriter, w: WaypointItem, i: number, isTemplate: boolean) => {
    x.open('Placemark');
    x.open('Point').leaf('coordinates', `${w.lng.toFixed(8)},${w.lat.toFixed(8)}`).close('Point');
    x.leaf('wpml:index', String(i));
    if (isTemplate) {
      // the same place against two reference surfaces; in relative mode both are
      // written with the relative height (see the report's warnings)
      x.leaf('wpml:ellipsoidHeight', heights[i]);
      x.leaf('wpml:height', heights[i]);
      x.leaf('wpml:useGlobalHeight', '0');
      x.leaf('wpml:useGlobalSpeed', w.speed ? '0' : '1');
      if (w.speed) x.leaf('wpml:waypointSpeed', w.speed);
      x.leaf('wpml:useGlobalHeadingParam', w.headingDeg === undefined ? '1' : '0');
      x.leaf('wpml:useGlobalTurnParam', '1');
    } else {
      x.leaf('wpml:executeHeight', heights[i]);
      x.leaf('wpml:waypointSpeed', w.speed ?? speed);
    }
    if (!isTemplate || w.headingDeg !== undefined) {
      x.open('wpml:waypointHeadingParam');
      x.leaf('wpml:waypointHeadingMode', w.headingDeg === undefined ? 'followWayline' : 'fixed');
      if (w.headingDeg !== undefined) {
        x.leaf('wpml:waypointHeadingAngle', w.headingDeg);
        x.leaf('wpml:waypointHeadingPathMode', 'followBadArc');
      }
      x.close('wpml:waypointHeadingParam');
    }
    if (!isTemplate) {
      x.open('wpml:waypointTurnParam');
      x.leaf('wpml:waypointTurnMode', 'toPointAndStopWithDiscontinuityCurvature');
      x.leaf('wpml:waypointTurnDampingDist', '0');
      x.close('wpml:waypointTurnParam');
    }
    // a wait at the waypoint is a hover action in this format
    const actions: MissionAction[] = [
      ...(w.holdS && w.holdS > 0 ? [{ kind: 'hover', seconds: w.holdS } as MissionAction] : []),
      ...(w.actions ?? []),
    ];
    const n = writeActions(x, i, i, actions);
    if (!isTemplate) {
      actionsWritten += n;
      rawActions += actions.filter((a) => a.kind === 'raw').length;
    }
    x.close('Placemark');
  };

  const head = (x: XmlWriter) => x.open('kml', { xmlns: KML_NS, 'xmlns:wpml': WPML_NS }).open('Document');

  const t = new XmlWriter();
  head(t);
  t.leaf('wpml:author', 'Flight Companion');
  t.leaf('wpml:createTime', String(now));
  t.leaf('wpml:updateTime', String(now));
  missionConfig(t, true);
  t.open('Folder');
  t.leaf('wpml:templateType', 'waypoint');
  t.leaf('wpml:templateId', '0');
  t.open('wpml:waylineCoordinateSysParam');
  t.leaf('wpml:coordinateMode', 'WGS84');
  t.leaf('wpml:heightMode', 'relativeToStartPoint');
  t.leaf('wpml:positioningType', 'GPS');
  t.close('wpml:waylineCoordinateSysParam');
  t.leaf('wpml:autoFlightSpeed', speed);
  t.leaf('wpml:globalHeight', heights[0]);
  t.leaf('wpml:gimbalPitchMode', 'manual');
  t.open('wpml:globalWaypointHeadingParam');
  t.leaf('wpml:waypointHeadingMode', 'followWayline');
  t.close('wpml:globalWaypointHeadingParam');
  t.leaf('wpml:globalWaypointTurnMode', 'toPointAndStopWithDiscontinuityCurvature');
  t.leaf('wpml:globalUseStraightLine', '1');
  all.forEach((w, i) => placemark(t, w, i, true));
  t.close('Folder').close('Document').close('kml');

  const e = new XmlWriter();
  head(e);
  missionConfig(e, false);
  e.open('Folder');
  e.leaf('wpml:templateId', '0');
  e.leaf('wpml:executeHeightMode', 'relativeToStartPoint');
  e.leaf('wpml:waylineId', '0');
  e.leaf('wpml:autoFlightSpeed', speed);
  all.forEach((w, i) => placemark(e, w, i, false));
  e.close('Folder').close('Document').close('kml');

  const data = zipSync(
    { 'wpmz/template.kml': encode(t.toString()), 'wpmz/waylines.wpml': encode(e.toString()) },
    { level: 6, mtime: new Date(now) },
  );

  // ---- the report
  report.kept.push(`${all.length} waypoints with their heights above takeoff, written to both files of the archive.`);
  if (actionsWritten > 0) report.kept.push(`${actionsWritten} waypoint action(s): photo, video, hover, heading and gimbal.`);
  report.kept.push(`What the route does at its end: ${finish === 'goHome' ? 'return to the takeoff point' : finish === 'autoLand' ? 'land where it is' : 'nothing, the pilot takes over'}.`);
  if (converted > 0 && homeAmsl !== null) {
    report.changed.push(`${converted} height(s) above sea level were turned into heights above takeoff by taking off the takeoff point's ${homeAmsl} m.`);
  }
  if (takeoff !== wantedTakeoff) {
    report.changed.push(`The safe takeoff height was moved from ${wantedTakeoff} m to ${takeoff} m, inside the 1.2 to 1500 m that DJI allows.`);
  }
  if (mission.cruiseSpeed === null) report.changed.push(`The mission states no speed. ${speed} m/s was written.`);
  const count = (kind: string) => mission.items.filter((i) => i.kind === kind).length;
  const drop = (what: string, n: number, why: string) => {
    if (n > 0) report.dropped.push({ what, count: n, why });
  };
  drop('Actions without a name in this app', rawActions, 'only actions the app can describe are written');
  drop('Speed-change items', count('speed'), 'a DJI route sets speed on the waypoint, not between waypoints');
  drop('Camera trigger by distance', count('camera-distance'), 'it is an action group with a distance trigger in this format, which the app does not write yet');
  drop('Points of interest', count('roi'), 'not written yet');
  drop('Other commands', count('raw'), 'MAVLink commands mean nothing to a DJI aircraft');
  drop('Waypoint names', all.filter((w) => w.name).length, 'a DJI waypoint has an index, not a name');
  drop('Geofences, areas and rally points', mission.areas.length + mission.circles.length + mission.rally.length, 'a waypoint route holds the route only');
  report.warnings.push(`Written for the ${aircraft.label}. A route made for one aircraft may be refused by another.`);
  report.warnings.push(`Return height is written as ${rth} m, the highest point of the route. Raise it in DJI Pilot 2 if anything near the site is taller.`);
  if (typeof extra.exitOnRCLost !== 'string') {
    report.warnings.push('If the remote control link is lost the route is written to stop and fly back to the takeoff point. Change it in DJI Pilot 2 if the site needs otherwise.');
  }
  report.warnings.push(
    'DJI publishes no schema to check a route against. The file follows the element order of the samples in DJI’s specification. It has not been opened in DJI Pilot 2 or FlightHub 2: open it there and look at it before flying it.',
  );
  report.warnings.push(
    'DJI’s specification does not say what ellipsoid height to write when heights are relative to takeoff. Both height fields of the template carry the relative height.',
  );

  return { name: `${safeName(mission.name)}.kmz`, mime: 'application/vnd.google-earth.kmz', data, report };
}
