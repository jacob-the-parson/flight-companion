// QGroundControl .plan — JSON. Source: docs.qgroundcontrol.com, "Plan File Format".
//
// Three shapes are in the wild and all three are read:
//   current   items carry `params` of seven values, the last three being the place
//   older     items carry `params` of four values and a `coordinate` of three
//   .mission  the format before .plan: items at the top level, param1..param4
// One shape is written: the current one.
import {
  emptyMission,
  emptyReport,
  MissionFormatError,
  type Mission,
  type MissionArea,
  type MissionCircle,
  type MissionItem,
  type WrittenFile,
} from '../model.ts';
import { commandLabel, hoverSeconds, itemFromRow, rowFromItem, rowsFromActions, type MavRow } from '../mavlink.ts';
import { decode, encode } from '../xml.ts';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function rowOf(item: Json): MavRow | null {
  const command = numOrNull(item.command);
  if (command === null) return null;
  const frame = numOrNull(item.frame) ?? 3;
  let params: (number | null)[];
  if (Array.isArray(item.params) && item.params.length >= 7) {
    params = item.params.slice(0, 7).map(numOrNull);
  } else {
    const four = Array.isArray(item.params)
      ? item.params.slice(0, 4).map(numOrNull)
      : [item.param1, item.param2, item.param3, item.param4].map(numOrNull);
    while (four.length < 4) four.push(null);
    const c = Array.isArray(item.coordinate) ? item.coordinate.map(numOrNull) : [null, null, null];
    params = [...four, c[0] ?? null, c[1] ?? null, c[2] ?? null];
  }
  return { command, frame, params, autoContinue: item.autoContinue !== false };
}

function readItems(list: unknown[], mission: Mission): MissionItem[] {
  const out: MissionItem[] = [];
  for (const raw of list) {
    if (!isObj(raw)) continue;
    if (raw.type === 'ComplexItem') {
      // A survey, corridor or structure scan. QGroundControl stores the recipe AND,
      // under TransectStyleComplexItem.Items, the simple items it produced.
      const kind = typeof raw.complexItemType === 'string' ? raw.complexItemType : 'pattern';
      const transect = isObj(raw.TransectStyleComplexItem) ? raw.TransectStyleComplexItem : null;
      const inner = transect && Array.isArray(transect.Items) ? transect.Items : null;
      if (Array.isArray(raw.polygon)) {
        const points = raw.polygon
          .filter((p): p is number[] => Array.isArray(p) && p.length >= 2)
          .map((p) => ({ lat: Number(p[0]), lng: Number(p[1]) }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
        if (points.length >= 3) mission.areas.push({ name: `${kind} area`, points, role: 'survey' });
      }
      if (inner && inner.length > 0) {
        const before = out.length;
        out.push(...readItems(inner, mission));
        mission.notes.push(
          `A ${kind} pattern was opened as the ${out.length - before} items QGroundControl had generated for it. Saved from here it is a list of waypoints, no longer a pattern QGroundControl can re-plan.`,
        );
      } else {
        mission.notes.push(
          `A ${kind} pattern in this file holds only its recipe, not the waypoints it produces. Its area was read; open the file in QGroundControl to generate the path.`,
        );
      }
      continue;
    }
    const row = rowOf(raw);
    if (row) out.push(itemFromRow(row));
  }
  return out;
}

function readFence(fence: unknown, mission: Mission): void {
  if (!isObj(fence)) return;
  const polygons: unknown[] = Array.isArray(fence.polygons) ? fence.polygons : [];
  // version 1 had a single `polygon`, a bare list of points
  if (Array.isArray(fence.polygon) && fence.polygon.length >= 3) {
    polygons.push({ inclusion: true, polygon: fence.polygon });
  }
  for (const p of polygons) {
    if (!isObj(p) || !Array.isArray(p.polygon)) continue;
    const points = p.polygon
      .filter((q): q is number[] => Array.isArray(q) && q.length >= 2)
      .map((q) => ({ lat: Number(q[0]), lng: Number(q[1]) }));
    if (points.length >= 3) {
      const area: MissionArea = {
        name: 'Geofence',
        points,
        role: p.inclusion === false ? 'keep-out' : 'keep-in',
      };
      mission.areas.push(area);
    }
  }
  for (const c of Array.isArray(fence.circles) ? fence.circles : []) {
    if (!isObj(c) || !isObj(c.circle)) continue;
    const center = c.circle.center;
    const radius = numOrNull(c.circle.radius);
    if (!Array.isArray(center) || radius === null) continue;
    const circle: MissionCircle = {
      center: { lat: Number(center[0]), lng: Number(center[1]) },
      radiusM: radius,
      role: c.inclusion === false ? 'keep-out' : 'keep-in',
    };
    mission.circles.push(circle);
  }
}

export function readQgcPlan(bytes: Uint8Array, fileName: string): Mission {
  let doc: unknown;
  try {
    doc = JSON.parse(decode(bytes));
  } catch {
    throw new MissionFormatError('The file is not valid JSON, so it is not a QGroundControl plan.');
  }
  if (!isObj(doc)) throw new MissionFormatError('The file holds no plan.');

  const mission = emptyMission(fileName.replace(/\.(plan|mission|json)$/i, ''));
  mission.source = 'qgc-plan';
  mission.sourceFile = fileName;

  // .plan nests the mission; the older .mission has the items at the top
  const body = isObj(doc.mission) ? doc.mission : doc;
  if (!Array.isArray(body.items)) {
    throw new MissionFormatError('The file has no list of mission items. It is not a QGroundControl plan.');
  }
  if (!isObj(doc.mission)) {
    mission.notes.push('This is the older QGroundControl ".mission" layout. It is saved in the current ".plan" layout.');
  }

  const firmware = numOrNull(body.firmwareType) ?? numOrNull(body.MAV_AUTOPILOT);
  mission.firmware = firmware === 12 ? 'px4' : firmware === 3 ? 'ardupilot' : null;
  const vehicleType = numOrNull(body.vehicleType);
  const types: Record<number, string> = { 1: 'Fixed wing', 2: 'Quadrotor', 10: 'Rover', 13: 'Hexarotor', 14: 'Octorotor', 20: 'VTOL' };
  mission.vehicle =
    [mission.firmware === 'px4' ? 'PX4' : mission.firmware === 'ardupilot' ? 'ArduPilot' : null, vehicleType !== null ? (types[vehicleType] ?? `vehicle type ${vehicleType}`) : null]
      .filter(Boolean)
      .join(', ') || null;

  const home = body.plannedHomePosition;
  if (Array.isArray(home) && home.length >= 2) {
    mission.home = { lat: Number(home[0]), lng: Number(home[1]), heightAmsl: numOrNull(home[2]) };
  } else if (isObj(home) && Array.isArray(home.coordinate)) {
    const c = home.coordinate;
    mission.home = { lat: Number(c[0]), lng: Number(c[1]), heightAmsl: numOrNull(c[2]) };
  }
  if (mission.home && mission.home.lat === 0 && mission.home.lng === 0) mission.home = null;

  mission.cruiseSpeed = numOrNull(body.hoverSpeed) ?? numOrNull(body.cruiseSpeed);
  mission.items = readItems(body.items, mission);
  readFence(doc.geoFence, mission);

  const rally = isObj(doc.rallyPoints) && Array.isArray(doc.rallyPoints.points) ? doc.rallyPoints.points : [];
  for (const r of rally) {
    if (Array.isArray(r) && r.length >= 3) {
      mission.rally.push({ lat: Number(r[0]), lng: Number(r[1]), height: Number(r[2]), heightRef: 'home' });
    }
  }

  mission.extras.qgc = {
    cruiseSpeed: numOrNull(body.cruiseSpeed),
    hoverSpeed: numOrNull(body.hoverSpeed),
    firmwareType: firmware,
    vehicleType,
    globalPlanAltitudeMode: numOrNull(body.globalPlanAltitudeMode),
  };
  return mission;
}

export function writeQgcPlan(mission: Mission): WrittenFile {
  const report = emptyReport('qgc-plan');
  const items: Json[] = [];
  const counts = { changed: new Map<string, number>(), refused: new Map<string, number>() };
  let actionsDropped = 0;

  const push = (row: MavRow) => {
    const positional = row.frame !== 2;
    items.push({
      AMSLAltAboveTerrain: null,
      Altitude: positional ? (row.params[6] ?? 0) : 0,
      // QGroundControl's AltitudeFrame enum (src/QmlControls/QGroundControlQmlGlobal.h):
      // 0 mixed, 1 relative to takeoff, 2 absolute, 3 calculated above terrain,
      // 4 terrain frame, 5 none. A MAVLink terrain frame is 4, not 3.
      AltitudeMode: row.frame === 0 || row.frame === 5 ? 2 : row.frame === 10 || row.frame === 11 ? 4 : 1,
      autoContinue: row.autoContinue,
      command: row.command,
      doJumpId: items.length + 1,
      frame: row.frame,
      params: row.params,
      type: 'SimpleItem',
    });
  };

  for (const item of mission.items) {
    const withHold =
      item.kind === 'waypoint' && hoverSeconds(item) > 0
        ? { ...item, holdS: (item.holdS ?? 0) + hoverSeconds(item) }
        : item;
    const r = rowFromItem(withHold, mission);
    if (!r.row) {
      counts.refused.set(r.refused ?? 'could not be written', (counts.refused.get(r.refused ?? '') ?? 0) + 1);
      continue;
    }
    if (r.changed) counts.changed.set(r.changed, (counts.changed.get(r.changed) ?? 0) + 1);
    push(r.row);
    const extra = rowsFromActions(item);
    extra.rows.forEach(push);
    actionsDropped += extra.dropped;
    if (item.kind === 'waypoint' && item.speed && item.speed > 0) {
      push({ command: 178, frame: 2, params: [1, item.speed, -1, 0, 0, 0, 0], autoContinue: true });
    }
  }

  for (const [why, count] of counts.refused) report.dropped.push({ what: 'Items', count, why });
  for (const [what, count] of counts.changed) report.changed.push(`${count} item${count > 1 ? 's' : ''}: ${what}.`);
  if (actionsDropped > 0) {
    report.dropped.push({
      what: 'Waypoint actions',
      count: actionsDropped,
      why: 'gimbal moves and actions without a name have no agreed MAVLink mission command here',
    });
  }
  const named = mission.items.filter((i) => i.kind === 'waypoint' && i.name).length;
  if (named > 0) {
    report.dropped.push({ what: 'Waypoint names', count: named, why: 'a plan item has a number, not a name' });
  }
  const surveys = mission.areas.filter((a) => a.role === 'survey').length;
  if (surveys > 0) {
    report.dropped.push({
      what: 'Survey areas',
      count: surveys,
      why: 'the waypoints are written; the area they were planned from is not',
    });
  }

  const extra = isObj(mission.extras.qgc) ? mission.extras.qgc : {};
  const firmwareType = mission.firmware === 'ardupilot' ? 3 : mission.firmware === 'px4' ? 12 : (numOrNull(extra.firmwareType) ?? 12);
  if (mission.firmware === null || mission.firmware === 'dji' || mission.firmware === 'garmin') {
    report.warnings.push(
      `The plan is marked for ${firmwareType === 3 ? 'ArduPilot' : 'PX4'} because the mission does not say which autopilot it is for. QGroundControl asks again when it opens a plan made for a different one.`,
    );
  }
  const speed = mission.cruiseSpeed ?? numOrNull(extra.hoverSpeed) ?? 5;
  if (mission.cruiseSpeed === null) {
    report.warnings.push(`The mission states no speed. ${speed} m/s was written as the plan's default.`);
  }

  const fence = {
    circles: mission.circles.map((c) => ({
      circle: { center: [c.center.lat, c.center.lng], radius: c.radiusM },
      inclusion: c.role === 'keep-in',
      version: 1,
    })),
    polygons: mission.areas
      .filter((a) => a.role !== 'survey')
      .map((a) => ({ inclusion: a.role === 'keep-in', polygon: a.points.map((p) => [p.lat, p.lng]), version: 1 })),
    version: 2,
  };

  const rallyKept = mission.rally.filter((r) => r.heightRef === 'home');
  if (rallyKept.length < mission.rally.length) {
    report.dropped.push({
      what: 'Rally points',
      count: mission.rally.length - rallyKept.length,
      why: 'their height is not stated above takeoff, which is what a plan expects',
    });
  }

  const plan = {
    fileType: 'Plan',
    geoFence: fence,
    groundStation: 'QGroundControl',
    mission: {
      cruiseSpeed: numOrNull(extra.cruiseSpeed) ?? 15,
      firmwareType,
      globalPlanAltitudeMode: numOrNull(extra.globalPlanAltitudeMode) ?? 1,
      hoverSpeed: speed,
      items,
      plannedHomePosition: mission.home
        ? [mission.home.lat, mission.home.lng, mission.home.heightAmsl ?? 0]
        : [0, 0, 0],
      vehicleType: numOrNull(extra.vehicleType) ?? 2,
      version: 2,
    },
    rallyPoints: { points: rallyKept.map((r) => [r.lat, r.lng, r.height]), version: 2 },
    version: 1,
  };

  if (!mission.home) {
    report.warnings.push(
      'The mission has no takeoff point. The plan is written with a planned home of 0, 0; the ground station replaces it with the real one when the aircraft connects.',
    );
  }
  report.kept.push(`${items.length} mission item${items.length === 1 ? '' : 's'}, with every command number and parameter.`);
  if (fence.polygons.length + fence.circles.length > 0) {
    report.kept.push(`${fence.polygons.length + fence.circles.length} geofence shape(s).`);
  }
  if (rallyKept.length > 0) report.kept.push(`${rallyKept.length} rally point(s).`);
  const raws = mission.items.filter((i) => i.kind === 'raw');
  if (raws.length > 0) {
    report.kept.push(
      `${raws.length} command(s) the app has no word for, written back exactly as read: ${[...new Set(raws.map((r) => (r.kind === 'raw' ? commandLabel(r.command) : '')))].slice(0, 4).join(', ')}.`,
    );
  }

  return {
    name: `${safeName(mission.name)}.plan`,
    mime: 'application/json',
    data: encode(JSON.stringify(plan, null, 4) + '\n'),
    report,
  };
}

export function safeName(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 80) || 'mission'
  );
}
