// Checks for the mission formats.
//
//   node scripts/verify-mission.mjs [--upstream <dir>] [--out <dir>]
//
// --upstream  a folder of real files from other projects, read as an independent
//             test. They are not part of this repository (their licences differ);
//             docs/VERIFICATION.md says where each comes from. Without the folder
//             those checks are skipped and the script says so.
// --out       where to leave the files this app writes, so that
//             scripts/validate-xml.py can check them against the publishers' schemas.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { detectFormat, FORMATS, readMission, writeMission } from '../lib/mission/formats.ts';
import { checkMission } from '../lib/mission/checks.ts';
import { emptyMission, missionStats, newId } from '../lib/mission/model.ts';
import { MAV_CMD } from '../lib/mission/mavlinkCommands.ts';
import { planSurvey, DEFAULT_PARAMS } from '../lib/planner/survey.ts';
import { toQgcPlan, toWpl } from '../lib/planner/export.ts';
import { CAMERA_PRESETS } from '../lib/planner/cameras.ts';
import { toLatLng } from '../lib/planner/geo.ts';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const upstream = arg('--upstream');
const out = arg('--out');
if (out) mkdirSync(out, { recursive: true });

let passed = 0;
let failed = 0;
let skipped = 0;
const ok = (name, cond, detail = '') => {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const near = (name, got, want, tol = 1e-7) =>
  ok(name, typeof got === 'number' && Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const save = (file) => {
  if (out) writeFileSync(join(out, file.name), file.data);
  return file;
};
const kinds = (m) => m.items.map((i) => i.kind).join(' ');

// ------------------------------------------------------------ a mission with everything in it
const HOME = { lat: 47.397742, lng: 8.545594, heightAmsl: 488 }; // the PX4 documentation's own example
const at = (x, y) => toLatLng({ x, y }, { lat: HOME.lat, lng: HOME.lng });
function rich() {
  const m = emptyMission('Sample inspection');
  m.home = { ...HOME };
  m.firmware = 'px4';
  m.cruiseSpeed = 5;
  const wp = (x, y, height, more = {}) => ({ id: newId(), kind: 'waypoint', ...at(x, y), height, heightRef: 'home', ...more });
  m.items = [
    { id: newId(), kind: 'takeoff', lat: null, lng: null, height: 20, heightRef: 'home' },
    { id: newId(), kind: 'speed', speed: 4 },
    wp(40, 30, 30, { name: 'Gate', holdS: 5 }),
    wp(120, 60, 35, { name: 'Tower north', headingDeg: 180, actions: [{ kind: 'gimbal', pitchDeg: -45, yawDeg: null }, { kind: 'photo' }] }),
    { id: newId(), kind: 'roi', ...at(100, 40), height: 10 },
    wp(140, -20, 35, { speed: 3, actions: [{ kind: 'hover', seconds: 4 }, { kind: 'video-start' }] }),
    { id: newId(), kind: 'camera-distance', distanceM: 12.5 },
    wp(60, -60, 30, { actions: [{ kind: 'video-stop' }] }),
    { id: newId(), kind: 'raw', command: 115, frame: 2, params: [90, 0, 1, 0, 0, 0, 0], label: 'Condition yaw (CONDITION_YAW)' },
    { id: newId(), kind: 'return' },
  ];
  m.areas = [{ name: 'Keep in', role: 'keep-in', points: [at(-50, -100), at(200, -100), at(200, 120), at(-50, 120)] }];
  m.circles = [{ center: at(100, 40), radiusM: 15, role: 'keep-out' }];
  m.rally = [{ ...at(-20, -20), height: 25, heightRef: 'home' }];
  return m;
}
const waypointsOf = (m) => m.items.filter((i) => i.kind === 'waypoint');
const samePlaces = (name, a, b, tol = 1e-7) => {
  const x = waypointsOf(a);
  const y = waypointsOf(b);
  eq(`${name}: waypoint count`, y.length, x.length);
  x.forEach((w, i) => {
    if (!y[i]) return;
    near(`${name}: waypoint ${i + 1} latitude`, y[i].lat, w.lat, tol);
    near(`${name}: waypoint ${i + 1} longitude`, y[i].lng, w.lng, tol);
  });
};

// ------------------------------------------------------------ the MAVLink table
{
  eq('table: 16 is NAV_WAYPOINT', MAV_CMD[16]?.name, 'NAV_WAYPOINT');
  eq('table: 20 is NAV_RETURN_TO_LAUNCH', MAV_CMD[20]?.name, 'NAV_RETURN_TO_LAUNCH');
  eq('table: 22 is NAV_TAKEOFF', MAV_CMD[22]?.name, 'NAV_TAKEOFF');
  eq('table: 178 is DO_CHANGE_SPEED', MAV_CMD[178]?.name, 'DO_CHANGE_SPEED');
  eq('table: 206 is DO_SET_CAM_TRIGG_DIST', MAV_CMD[206]?.name, 'DO_SET_CAM_TRIGG_DIST');
}

// ------------------------------------------------------------ QGroundControl plan
{
  const m = rich();
  const file = save(writeMission(m, 'qgc-plan'));
  const doc = JSON.parse(dec(file.data));
  eq('plan: fileType', doc.fileType, 'Plan');
  eq('plan: version', doc.version, 1);
  eq('plan: mission version', doc.mission.version, 2);
  eq('plan: firmware is PX4', doc.mission.firmwareType, 12);
  ok('plan: every item has seven params', doc.mission.items.every((i) => i.params.length === 7));
  eq('plan: doJumpId counts from 1', doc.mission.items.map((i) => i.doJumpId).join(), doc.mission.items.map((_, i) => i + 1).join());
  ok('plan: a relative waypoint has AltitudeMode 1', doc.mission.items.filter((i) => i.command === 16).every((i) => i.AltitudeMode === 1 && i.frame === 3));
  eq('plan: home', doc.mission.plannedHomePosition.join(), [HOME.lat, HOME.lng, HOME.heightAmsl].join());
  eq('plan: geofence polygon', doc.geoFence.polygons.length, 1);
  eq('plan: geofence polygon is keep-in', doc.geoFence.polygons[0].inclusion, true);
  eq('plan: geofence circle', doc.geoFence.circles.length, 1);
  eq('plan: geofence circle is keep-out', doc.geoFence.circles[0].inclusion, false);
  eq('plan: rally point', doc.rallyPoints.points.length, 1);
  // a wait becomes the waypoint's hold; a hover action adds to it
  const gate = doc.mission.items.find((i) => i.command === 16);
  eq('plan: hold time is param1', gate.params[0], 5);
  const third = doc.mission.items.filter((i) => i.command === 16)[2];
  eq('plan: a hover action becomes hold time', third.params[0], 4);
  eq('plan: heading is param4', doc.mission.items.filter((i) => i.command === 16)[1].params[3], 180);
  ok('plan: photo becomes IMAGE_START_CAPTURE', doc.mission.items.some((i) => i.command === 2000));
  ok('plan: video becomes VIDEO_START and VIDEO_STOP', doc.mission.items.some((i) => i.command === 2500) && doc.mission.items.some((i) => i.command === 2501));
  ok('plan: a raw command is written as read', doc.mission.items.some((i) => i.command === 115 && i.params[0] === 90 && i.params[2] === 1));
  ok('plan: report names the gimbal action as dropped', file.report.dropped.some((d) => d.what === 'Waypoint actions' && d.count === 1));
  ok('plan: report names the lost names', file.report.dropped.some((d) => d.what === 'Waypoint names' && d.count === 2));

  const back = readMission(file.data, file.name);
  eq('plan: detected', detectFormat(file.data, file.name), 'qgc-plan');
  samePlaces('plan round trip', m, back);
  eq('plan round trip: home', JSON.stringify(back.home), JSON.stringify(HOME));
  eq('plan round trip: areas', back.areas.length, 1);
  eq('plan round trip: circles', back.circles.length, 1);
  eq('plan round trip: rally', back.rally.length, 1);
  ok('plan round trip: ends with return', back.items[back.items.length - 1].kind === 'return');
  ok('plan round trip: point of interest', back.items.some((i) => i.kind === 'roi' && i.lat !== null));
  ok('plan round trip: camera distance', back.items.some((i) => i.kind === 'camera-distance' && i.distanceM === 12.5));
  // writing what was read changes nothing
  const again = writeMission(back, 'qgc-plan');
  eq('plan: read then write is stable', dec(again.data), dec(writeMission(readMission(again.data, 'x.plan'), 'qgc-plan').data));
}

// ------------------------------------------------------------ the planner's own export is a plan this reads
{
  const cam = CAMERA_PRESETS[0];
  const ref = { lat: HOME.lat, lng: HOME.lng };
  const rect = [{ x: -50, y: -30 }, { x: 50, y: -30 }, { x: 50, y: 30 }, { x: -50, y: 30 }].map((p) => toLatLng(p, ref));
  const r = planSurvey({ type: 'grid', vertices: rect, home: ref, camera: cam, params: { ...DEFAULT_PARAMS, angle: 90, cameraTrigger: true }, enduranceMin: 14 });
  const input = { type: 'grid', waypoints: r.waypoints, home: ref, params: { ...DEFAULT_PARAMS, angle: 90, cameraTrigger: true }, photoSpacing: r.footprint.photoSpacing, firmware: 'px4' };
  const plan = readMission(enc(toQgcPlan(input)), 'survey.plan');
  eq('planner plan: waypoints', waypointsOf(plan).length, r.waypoints.length);
  eq('planner plan: begins with takeoff', plan.items[0].kind, 'takeoff');
  eq('planner plan: ends with return', plan.items[plan.items.length - 1].kind, 'return');
  eq('planner plan: camera trigger on and off', plan.items.filter((i) => i.kind === 'camera-distance').length, 2);
  eq('planner plan: no command left unnamed', plan.items.filter((i) => i.kind === 'raw').length, 0);
  ok('planner plan: no stop in its checks', !checkMission(plan).some((c) => c.level === 'critical'));
  const wpl = readMission(enc(toWpl(input)), 'survey.waypoints');
  eq('planner waypoints: same items as the plan', kinds(wpl), kinds(plan));
  samePlaces('planner plan against planner waypoints', plan, wpl);
}

// ------------------------------------------------------------ waypoint list
{
  const m = rich();
  const file = save(writeMission(m, 'qgc-wpl'));
  const lines = dec(file.data).trimEnd().split('\n');
  eq('wpl: header', lines[0], 'QGC WPL 110');
  ok('wpl: twelve tab-separated fields on every row', lines.slice(1).every((l) => l.split('\t').length === 12));
  eq('wpl: row 0 is home, marked current, frame 0', lines[1].split('\t').slice(0, 4).join(), '0,1,0,16');
  near('wpl: home latitude', Number(lines[1].split('\t')[8]), HOME.lat);
  near('wpl: home longitude', Number(lines[1].split('\t')[9]), HOME.lng);
  eq('wpl: indices count up', lines.slice(1).map((l) => l.split('\t')[0]).join(), lines.slice(1).map((_, i) => i).join());
  ok('wpl: no exponent notation', !/\de[+-]?\d/i.test(lines.join('\n')));
  ok('wpl: report says the geofence is left out', file.report.dropped.some((d) => d.what === 'Geofences and areas'));
  const back = readMission(file.data, file.name);
  eq('wpl: detected', detectFormat(file.data, 'anything.txt'), 'qgc-wpl');
  samePlaces('wpl round trip', m, back);
  eq('wpl round trip: home', JSON.stringify(back.home), JSON.stringify(HOME));
  eq('wpl round trip: areas are gone', back.areas.length, 0);
  // a file written with spaces instead of tabs is read too
  const spaced = readMission(enc(dec(file.data).replace(/\t/g, ' ')), 'hand.waypoints');
  eq('wpl: spaces instead of tabs', kinds(spaced), kinds(back));
}

// ------------------------------------------------------------ Garmin
{
  const m = rich();
  const file = save(writeMission(m, 'garmin-fpl'));
  const xml = dec(file.data);
  ok('fpl: namespace', xml.includes('xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1"'));
  const ids = [...xml.matchAll(/<identifier>([^<]*)<\/identifier>/g)].map((x) => x[1]);
  eq('fpl: four waypoints in the table', ids.length, 4);
  ok('fpl: identifiers fit [A-Z0-9]{1,12}', ids.every((i) => /^[A-Z0-9]{1,12}$/.test(i)), ids.join());
  eq('fpl: identifiers are unique', new Set(ids).size, ids.length);
  eq('fpl: a name that fits is kept', ids[0], 'GATE');
  eq('fpl: a name with a space is squeezed', ids[1], 'TOWERNORTH');
  ok('fpl: unnamed waypoints are numbered', ids[2] === 'WP003' && ids[3] === 'WP004', ids.join());
  ok('fpl: route name fits [A-Z0-9 /]{1,25}', /<route-name>[A-Z0-9 /]{1,25}<\/route-name>/.test(xml));
  ok('fpl: elevation is height above takeoff plus the takeoff point', xml.includes('<elevation>518</elevation>'));
  const order = [...xml.matchAll(/<(identifier|type|country-code|lat|lon|comment|elevation)[ >/]/g)].map((x) => x[1]).slice(0, 7);
  eq('fpl: elements in the order the schema gives', order.join(), 'identifier,type,country-code,lat,lon,comment,elevation');
  for (const what of ['Take-off, landing and return', 'Speed changes', 'Waits at a waypoint', 'Camera and gimbal actions', 'Other commands', 'Geofences, areas and rally points']) {
    ok(`fpl: report names "${what}" as dropped`, file.report.dropped.some((d) => d.what === what));
  }
  ok('fpl: report says names were changed', file.report.changed.some((c) => c.includes('TOWERNORTH')));
  const back = readMission(file.data, file.name);
  eq('fpl: detected', detectFormat(file.data, file.name), 'garmin-fpl');
  samePlaces('fpl round trip', m, back);
  eq('fpl round trip: only waypoints', kinds(back), 'waypoint waypoint waypoint waypoint');
  eq('fpl round trip: names', waypointsOf(back).map((w) => w.name).join(), ids.join());
  ok('fpl round trip: heights are elevations above sea level', waypointsOf(back).every((w) => w.heightRef === 'amsl'));
  ok('fpl round trip: the reader warns there is no flying height', back.notes.some((n) => n.includes('no flying height')));

  // without the takeoff point's height above sea level no elevation can be written
  const blind = rich();
  blind.home = { lat: HOME.lat, lng: HOME.lng, heightAmsl: null };
  const f2 = writeMission(blind, 'garmin-fpl');
  ok('fpl: no elevation without the takeoff height', !dec(f2.data).includes('<elevation>'));
  ok('fpl: and the report says so', f2.report.dropped.some((d) => d.what === 'Flying heights' && d.count === 4));

  // 300 route points is the limit
  const big = emptyMission('Long');
  for (let i = 0; i < 320; i++) big.items.push({ id: newId(), kind: 'waypoint', ...at(i * 5, 0), height: 30, heightRef: 'home' });
  const f3 = writeMission(big, 'garmin-fpl');
  eq('fpl: stops at 300 route points', [...dec(f3.data).matchAll(/<route-point>/g)].length, 300);
  ok('fpl: and the report says 20 were dropped', f3.report.dropped.some((d) => d.count === 20));

  // a hand-written plan as a Garmin unit would hold it: airports, no route
  const hand = `<?xml version="1.0" encoding="utf-8"?>
<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1">
  <created>2026-01-05T10:00:00Z</created>
  <waypoint-table>
    <waypoint><identifier>KAAA</identifier><type>AIRPORT</type><country-code>K1</country-code><lat>40.158611</lat><lon>-89.335</lon><comment>LOGAN CO</comment></waypoint>
    <waypoint><identifier>DEC</identifier><type>VOR</type><country-code>K3</country-code><lat>39.737433</lat><lon>-88.856456</lon><comment></comment></waypoint>
    <waypoint><identifier>KAAA</identifier><type>USER WAYPOINT</type><country-code></country-code><lat>1</lat><lon>2</lon><comment></comment></waypoint>
  </waypoint-table>
  <route>
    <route-name>KAAA/DEC</route-name>
    <flight-plan-index>1</flight-plan-index>
    <route-point><waypoint-identifier>KAAA</waypoint-identifier><waypoint-type>AIRPORT</waypoint-type><waypoint-country-code>K1</waypoint-country-code></route-point>
    <route-point><waypoint-identifier>DEC</waypoint-identifier><waypoint-type>VOR</waypoint-type><waypoint-country-code>K3</waypoint-country-code></route-point>
  </route>
</flight-plan>`;
  const h = readMission(enc(hand), 'hand.fpl');
  eq('fpl by hand: route name', h.name, 'KAAA/DEC');
  eq('fpl by hand: two route points', h.items.length, 2);
  near('fpl by hand: the AIRPORT KAAA, not the user waypoint of the same name', h.items[0].lat, 40.158611);
  eq('fpl by hand: type is kept as a note', h.items[1].note, 'VOR');
  ok('fpl by hand: no height', h.items.every((i) => i.height === null && i.heightRef === 'unknown'));
  ok('fpl by hand: says one waypoint is off the route', h.notes.some((n) => n.startsWith('1 waypoint(s) are in the table')));
  ok('fpl by hand: its checks stop on missing heights', checkMission(h).some((c) => c.id === 'no-height' && c.level === 'critical'));
}

// ------------------------------------------------------------ DJI
{
  const m = rich();
  let refused = '';
  try {
    writeMission(m, 'dji-wpml');
  } catch (e) {
    refused = e.message;
  }
  ok('dji: refuses to write without an aircraft', refused.includes('Choose the DJI aircraft'));
  const file = save(writeMission(m, 'dji-wpml', { djiAircraft: 'm3e' }));
  eq('dji: is a zip', file.data[0] === 0x50 && file.data[1] === 0x4b, true);
  eq('dji: detected', detectFormat(file.data, 'route.kmz'), 'dji-wpml');
  const { unzipSync } = await import('fflate');
  const files = unzipSync(file.data);
  eq('dji: the two files, at the paths DJI names', Object.keys(files).sort().join(), 'wpmz/template.kml,wpmz/waylines.wpml');
  const tpl = dec(files['wpmz/template.kml']);
  const exe = dec(files['wpmz/waylines.wpml']);
  if (out) {
    writeFileSync(join(out, 'dji-template.kml'), tpl);
    writeFileSync(join(out, 'dji-waylines.wpml'), exe);
  }
  for (const [name, xml] of [['template', tpl], ['waylines', exe]]) {
    ok(`dji ${name}: namespaces`, xml.includes('xmlns="http://www.opengis.net/kml/2.2"') && xml.includes('xmlns:wpml="http://www.dji.com/wpmz/1.0.2"'));
    ok(`dji ${name}: aircraft 77/0, camera 66`, xml.includes('<wpml:droneEnumValue>77</wpml:droneEnumValue>') && xml.includes('<wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>') && xml.includes('<wpml:payloadEnumValue>66</wpml:payloadEnumValue>'));
    ok(`dji ${name}: ends with a return`, xml.includes('<wpml:finishAction>goHome</wpml:finishAction>'));
    eq(`dji ${name}: four placemarks`, [...xml.matchAll(/<Placemark>/g)].length, 4);
    eq(`dji ${name}: indices from 0`, [...xml.matchAll(/<wpml:index>(\d+)</g)].map((x) => x[1]).join(), '0,1,2,3');
    ok(`dji ${name}: coordinates are longitude first`, new RegExp(`<coordinates>8\\.54\\d+,47\\.39\\d+</coordinates>`).test(xml));
  }
  ok('dji template: says it is a waypoint template, relative to takeoff', tpl.includes('<wpml:templateType>waypoint</wpml:templateType>') && tpl.includes('<wpml:heightMode>relativeToStartPoint</wpml:heightMode>'));
  ok('dji waylines: relative to takeoff', exe.includes('<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>'));
  eq('dji waylines: heights', [...exe.matchAll(/<wpml:executeHeight>([\d.]+)</g)].map((x) => x[1]).join(), '30,35,35,30');
  ok('dji waylines: a wait is a hover action', exe.includes('<wpml:actionActuatorFunc>hover</wpml:actionActuatorFunc>') && exe.includes('<wpml:hoverTime>5</wpml:hoverTime>'));
  ok('dji waylines: gimbal pitch', exe.includes('<wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable>') && exe.includes('<wpml:gimbalPitchRotateAngle>-45</wpml:gimbalPitchRotateAngle>'));
  ok('dji waylines: a fixed heading of 180', exe.includes('<wpml:waypointHeadingMode>fixed</wpml:waypointHeadingMode>') && exe.includes('<wpml:waypointHeadingAngle>180</wpml:waypointHeadingAngle>'));
  ok('dji: report names MAVLink commands as dropped', file.report.dropped.some((d) => d.what === 'Other commands'));
  ok('dji: report says nobody has opened it in DJI Pilot 2', file.report.warnings.some((w) => w.includes('has not been opened in DJI Pilot 2')));

  const back = readMission(file.data, file.name);
  samePlaces('dji round trip', m, back, 1e-7);
  eq('dji round trip: heights', waypointsOf(back).map((w) => w.height).join(), '30,35,35,30');
  ok('dji round trip: heights are above takeoff', waypointsOf(back).every((w) => w.heightRef === 'home'));
  eq('dji round trip: aircraft', back.vehicle, 'DJI Mavic 3E');
  eq('dji round trip: shape', kinds(back), 'takeoff waypoint waypoint waypoint waypoint return');
  eq('dji round trip: actions on waypoint 1', waypointsOf(back)[0].actions.map((a) => a.kind).join(), 'hover');
  eq('dji round trip: actions on waypoint 2', waypointsOf(back)[1].actions.map((a) => a.kind).join(), 'gimbal,photo');
  eq('dji round trip: actions on waypoint 3', waypointsOf(back)[2].actions.map((a) => a.kind).join(), 'hover,video-start');
  eq('dji round trip: a slower waypoint', waypointsOf(back)[2].speed, 3);
  eq('dji round trip: default speed', back.cruiseSpeed, 5);

  // heights above sea level with no takeoff height cannot be restated: refuse, in words
  const amsl = rich();
  amsl.home = { lat: HOME.lat, lng: HOME.lng, heightAmsl: null };
  amsl.items.forEach((i) => { if (i.kind === 'waypoint') i.heightRef = 'amsl'; });
  let why = '';
  try {
    writeMission(amsl, 'dji-wpml', { djiAircraft: 'm30' });
  } catch (e) {
    why = e.message;
  }
  ok('dji: refuses heights it cannot restate', why.includes('above sea level'), why);

  // DJI's own samples, from its specification, with numbers in place of the word "longitude,latitude"
  if (upstream && existsSync(join(upstream, 'dji-template-sample.kml'))) {
    const fix = (s) => { let n = 0; return s.replace(/longitude,latitude/g, () => `116.${300 + n++},24.${500 + n}`); };
    const sTpl = fix(readFileSync(join(upstream, 'dji-template-sample.kml'), 'utf8'));
    const sExe = fix(readFileSync(join(upstream, 'dji-waylines-sample.wpml'), 'utf8'));
    const kmz = zipSync({ 'wpmz/template.kml': enc(sTpl), 'wpmz/waylines.wpml': enc(sExe) });
    const d = readMission(kmz, 'dji-sample.kmz');
    eq('dji sample: aircraft', d.vehicle, 'DJI Matrice 30');
    eq('dji sample: shape', kinds(d), 'takeoff waypoint waypoint return');
    eq('dji sample: takeoff height', d.items[0].height, 20);
    eq('dji sample: execution heights', waypointsOf(d).map((w) => w.height).join(), '116.57,116.57');
    ok('dji sample: heights are above the ellipsoid', waypointsOf(d).every((w) => w.heightRef === 'ellipsoid'));
    near('dji sample: longitude comes first in the file', waypointsOf(d)[0].lng, 116.3, 1e-9);
    eq('dji sample: speed of the second waypoint', waypointsOf(d)[1].speed, 7);
    eq('dji sample: actions', waypointsOf(d)[1].actions.map((a) => a.kind).join(), 'gimbal,photo');
    eq('dji sample: gimbal yaw 30, pitch off', JSON.stringify(waypointsOf(d)[1].actions[0]), JSON.stringify({ kind: 'gimbal', pitchDeg: null, yawDeg: 30 }));
    // the template alone, as a user might have it before DJI Pilot 2 generates the rest
    const t = readMission(zipSync({ 'wpmz/template.kml': enc(sTpl) }), 'dji-template-only.kmz');
    eq('dji template only: heights are the planned ones', waypointsOf(t).map((w) => w.height).join(), '100,100');
    ok('dji template only: EGM96 is above sea level', waypointsOf(t).every((w) => w.heightRef === 'amsl'));
    ok('dji template only: takeoff reference point is latitude first', t.home && Math.abs(t.home.lat - 23.98057) < 1e-9 && Math.abs(t.home.lng - 115.987663) < 1e-9);
    ok('dji template only: says there is no execution file', t.notes.some((n) => n.includes('no execution file')));

    // element order: whatever this app writes must come in the order DJI's sample uses
    const orderOf = (xml, parent) => {
      const body = new RegExp(`<${parent}>([\\s\\S]*?)</${parent}>`).exec(xml)?.[1] ?? '';
      const names = [];
      let depth = 0;
      for (const tag of body.matchAll(/<(\/?)([\w:-]+)[^>]*?(\/?)>/g)) {
        if (tag[1]) depth -= 1;
        else {
          if (depth === 0) names.push(tag[2]);
          if (!tag[3]) depth += 1;
        }
      }
      return names;
    };
    const inOrder = (ours, theirs) => {
      const shared = ours.filter((n) => theirs.includes(n));
      const want = theirs.filter((n) => shared.includes(n));
      return JSON.stringify([...new Set(shared)]) === JSON.stringify([...new Set(want)]);
    };
    for (const parent of ['wpml:missionConfig', 'Folder', 'Placemark', 'wpml:actionGroup', 'wpml:action']) {
      ok(`dji order: <${parent}> of waylines.wpml follows DJI's sample`, inOrder(orderOf(exe, parent), orderOf(sExe, parent)), `${orderOf(exe, parent)} against ${orderOf(sExe, parent)}`);
      ok(`dji order: <${parent}> of template.kml follows DJI's sample`, inOrder(orderOf(tpl, parent), orderOf(sTpl, parent)), `${orderOf(tpl, parent)} against ${orderOf(sTpl, parent)}`);
    }
  } else {
    skipped += 1;
    console.log('  skipped: DJI specification samples (no --upstream folder)');
  }
}

// ------------------------------------------------------------ KML, GPX, table, document
{
  const m = rich();
  const kml = save(writeMission(m, 'kml'));
  eq('kml: detected', detectFormat(kml.data, kml.name), 'kml');
  ok('kml: heights became absolute', dec(kml.data).includes('<altitudeMode>absolute</altitudeMode>') && kml.report.changed.length === 1);
  const k = readMission(kml.data, kml.name);
  samePlaces('kml round trip', m, k);
  eq('kml round trip: heights are above sea level', waypointsOf(k).map((w) => `${w.height}${w.heightRef}`).join(), '518amsl,523amsl,523amsl,518amsl');
  eq('kml round trip: the area', k.areas.length, 1);
  eq('kml round trip: the area has its four corners, not five', k.areas[0].points.length, 4);
  const kmz = zipSync({ 'doc.kml': kml.data });
  eq('kmz without a DJI route is read as KML', readMission(kmz, 'plain.kmz').source, 'kml');

  const gpx = save(writeMission(m, 'gpx'));
  eq('gpx: detected', detectFormat(gpx.data, gpx.name), 'gpx');
  const g = readMission(gpx.data, gpx.name);
  samePlaces('gpx round trip', m, g);
  eq('gpx round trip: names', waypointsOf(g).map((w) => w.name).join(), 'Gate,Tower north,3,4');
  eq('gpx round trip: elevations', waypointsOf(g).map((w) => w.height).join(), '518,523,523,518');

  const csv = save(writeMission(m, 'csv'));
  eq('csv: detected', detectFormat(csv.data, csv.name), 'csv');
  ok('csv: units are in the column names', dec(csv.data).split('\n')[0].includes('latitude_deg') && dec(csv.data).split('\n')[0].includes('height_m'));
  const c = readMission(csv.data, csv.name);
  samePlaces('csv round trip', m, c);
  eq('csv round trip: shape', kinds(c).replace(/ waypoint/g, ' w'), 'takeoff speed w w roi w w return');
  ok('csv round trip: says two rows hold words and no numbers', c.notes.some((n) => n.startsWith('2 row(s) name a command')));
  ok('csv: report names the camera distance as dropped', csv.report.dropped.some((d) => d.what === 'Camera trigger distances'));
  eq('csv round trip: a name with a space', waypointsOf(c)[1].name, 'Tower north');
  const loose = readMission(enc('Name;Lat;Lon;Alt\n"A, the first";47.1;8.5;30\nB;47.2;8.6;40\nbad;;;\n'), 'sheet.csv');
  eq('csv from a spreadsheet: two rows kept', loose.items.length, 2);
  eq('csv from a spreadsheet: a quoted name with a comma', loose.items[0].name, 'A, the first');
  ok('csv from a spreadsheet: heights with no reference are flagged', loose.items.every((i) => i.heightRef === 'unknown') && loose.notes.some((n) => n.includes('no height_reference')));

  const json = save(writeMission(m, 'fc-mission'));
  eq('document: detected', detectFormat(json.data, json.name), 'fc-mission');
  const doc = JSON.parse(dec(json.data));
  eq('document: schema', doc.schema, 'flight-companion/mission@1');
  ok('document: every key with a number says its unit', Object.keys(doc.summary).every((k) => !/length|height|time|leg|farthest/.test(k) || /_m$|_s$|_used$/.test(k)), Object.keys(doc.summary).join());
  ok('document: every item is also said in words', doc.items.every((i) => typeof i.in_words === 'string' && i.in_words.length > 3));
  const j = readMission(json.data, json.name);
  eq('document round trip: shape', kinds(j), kinds(m));
  eq('document round trip: nothing dropped', json.report.dropped.length, 0);
  // compared with keys in one order: the order of keys in an object says nothing
  const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
  const strip = (mm) => JSON.stringify(sorted({ ...mm, items: mm.items.map((i) => Object.fromEntries(Object.entries(i).filter(([k]) => k !== 'id'))), source: null, sourceFile: null }));
  eq('document round trip: identical', strip(j), strip(m));
  // and a mission read from a ground station's file keeps the rows it came from
  const viaPlan = readMission(writeMission(m, 'qgc-plan').data, 'a.plan');
  const viaDoc = readMission(writeMission(viaPlan, 'fc-mission').data, 'a.mission.json');
  eq('document: keeps the MAVLink rows a mission was read from', dec(writeMission(viaDoc, 'qgc-plan').data), dec(writeMission(viaPlan, 'qgc-plan').data));
}

// ------------------------------------------------------------ checks and refusals
{
  const m = rich();
  ok('checks: the sample has no stop', !checkMission(m).some((c) => c.level === 'critical'));
  const bad = rich();
  bad.items[2].lat = 0;
  bad.items[2].lng = 0;
  bad.items[3].height = 150;
  bad.items[5].height = null;
  const found = checkMission(bad).map((c) => c.id);
  for (const id of ['zero-zero', 'too-high', 'no-height', 'long-leg']) ok(`checks: finds ${id}`, found.includes(id), found.join());
  eq('checks: stops come first', checkMission(bad)[0].level, 'critical');
  const s = missionStats(m);
  // by hand, from the metres the sample is built with: 50 + 85.44 + 82.46 + 89.44, and 84.85 home
  near('stats: length counts the way home', s.lengthM, 392.2, 0.5);
  eq('stats: highest and lowest', `${s.lowest} ${s.highest}`, '20 35');
  ok('stats: a time, since the mission states a speed', s.timeS > 80 && s.timeS < 200, String(s.timeS));

  for (const [name, bytes, file, expect] of [
    ['an empty file', new Uint8Array(0), 'x.plan', 'empty'],
    ['a flight log', enc('ULog'), 'flight.ulg', 'flight log'],
    ['a parameter file', enc('1\t1\tA\t1\t6'), 'a.params', 'parameter file'],
    ['broken JSON', enc('{"mission": '), 'x.plan', 'not valid JSON'],
    ['JSON that is not a plan', enc('{"a": 1}'), 'x.json', 'no list of mission items'],
    ['XML of another kind', enc('<?xml version="1.0"?><html></html>'), 'x.xml', 'XML, but not'],
    ['a damaged archive', new Uint8Array([0x50, 0x4b, 3, 4, 9, 9, 9, 9, 9]), 'x.kmz', 'could not be unpacked'],
    ['a waypoint list with no rows', enc('QGC WPL 110\n'), 'x.waypoints', ''],
  ]) {
    let message = 'read without complaint';
    try {
      const r = readMission(bytes, file);
      message = `read ${r.items.length} items`;
    } catch (e) {
      message = e.message;
    }
    ok(`refusal: ${name}`, expect === '' ? message === 'read 0 items' : message.includes(expect), message);
  }
  eq('formats: eight', FORMATS.length, 8);
  ok('formats: every one names its source', FORMATS.every((f) => f.source.length > 3 && f.about.length > 20));
}

// ------------------------------------------------------------ real files from other projects
if (upstream && existsSync(join(upstream, 'qgc-SectionTest.plan'))) {
  const load = (f) => readMission(readFileSync(join(upstream, f)), f);

  const section = load('qgc-SectionTest.plan');
  eq('QGC SectionTest.plan: shape', kinds(section), 'takeoff waypoint waypoint raw waypoint');
  eq('QGC SectionTest.plan: the raw command is named', section.items[3].label, 'Mount control (DO_MOUNT_CONTROL)');
  near('QGC SectionTest.plan: takeoff latitude, from the older "coordinate" layout', section.items[0].lat, 47.63311996);
  near('QGC SectionTest.plan: first waypoint longitude', section.items[1].lng, -122.08925023);
  eq('QGC SectionTest.plan: heights', section.items.filter((i) => 'height' in i).map((i) => `${i.height}${i.heightRef}`).join(), '20home,20home,20home,20home');
  eq('QGC SectionTest.plan: firmware', section.firmware, 'px4');
  // written back in the current layout, it reads the same
  const rewritten = readMission(writeMission(section, 'qgc-plan').data, 'again.plan');
  eq('QGC SectionTest.plan: survives being saved in the current layout', kinds(rewritten), kinds(section));
  eq('QGC SectionTest.plan: the mount command keeps its numbers', JSON.stringify(rewritten.items[3].params), JSON.stringify(section.items[3].params));

  const old = load('qgc-100Waypoints.mission');
  // the name says 100; the file holds 99 items: a takeoff, a camera trigger and 97 waypoints
  eq('QGC 100Waypoints.mission: 99 items', old.items.length, 99);
  eq('QGC 100Waypoints.mission: 97 waypoints', waypointsOf(old).length, 97);
  eq('QGC 100Waypoints.mission: camera trigger distance', old.items.find((i) => i.kind === 'camera-distance')?.distanceM, 21.059999);
  eq('QGC 100Waypoints.mission: firmware', old.firmware, 'ardupilot');
  near('QGC 100Waypoints.mission: home', old.home.lat, 34.577822);
  ok('QGC 100Waypoints.mission: says it is the older layout', old.notes.some((n) => n.includes('older QGroundControl')));

  const mp = load('qgc-MissionPlanner.waypoints');
  eq('Mission Planner .waypoints: shape', kinds(mp), 'waypoint waypoint waypoint waypoint waypoint');
  eq('Mission Planner .waypoints: home, from row 0', JSON.stringify(mp.home), JSON.stringify({ lat: 47.660459, lng: -122.103167, heightAmsl: 5.21 }));
  eq('Mission Planner .waypoints: heights', waypointsOf(mp).map((w) => `${w.height}${w.heightRef}`).join(), '100home,100home,100home,100home,100home');
  near('Mission Planner .waypoints: last waypoint longitude', waypointsOf(mp)[4].lng, -122.105538);

  // ArduPilot's autotest missions: read, write, and compare every number of every row
  for (const f of [
    'ardupilot-ArduCopter_Tests-CopterMission-copter_mission.txt',
    'ardupilot-ArduCopter_Tests-DO_CHANGE_SPEED-mission.txt',
    'ardupilot-ArduCopter_Tests-SplineWaypoint-copter_spline_mission.txt',
    'ardupilot-ArduCopter_Tests-copter_terrain_mission.txt',
  ]) {
    const short = f.replace('ardupilot-ArduCopter_Tests-', '');
    const original = readFileSync(join(upstream, f), 'utf8');
    const a = readMission(enc(original), f);
    const written = dec(writeMission(a, 'qgc-wpl').data);
    const rows = (text) => text.trim().split(/\r?\n/).slice(1).filter((l) => l.trim()).map((l) => l.trim().split(/\s+/).map(Number));
    const want = rows(original);
    const got = rows(written);
    eq(`ArduPilot ${short}: same number of rows`, got.length, want.length);
    let differing = 0;
    want.forEach((row, i) => {
      // row 0's "current" flag and frame are the home convention; compare the rest exactly
      const same = row.every((v, k) => (k === 0 ? true : Math.abs(v - (got[i]?.[k] ?? NaN)) < 1e-9));
      if (!same) {
        differing += 1;
        if (differing <= 3) console.log(`     row ${i}: ${row.join(' ')}  ->  ${got[i]?.join(' ')}`);
      }
    });
    eq(`ArduPilot ${short}: every number of every row survives a read and a write`, differing, 0);
  }
  const speed = load('ardupilot-ArduCopter_Tests-DO_CHANGE_SPEED-mission.txt');
  eq('ArduPilot DO_CHANGE_SPEED: the four speeds', speed.items.filter((i) => i.kind === 'speed').map((i) => i.speed).join(), '4,15,10,16');
  eq('ArduPilot DO_CHANGE_SPEED: the first is stated as airspeed', speed.items.find((i) => i.kind === 'speed').note, 'Stated as airspeed');
  eq('ArduPilot DO_CHANGE_SPEED: ends with a return', speed.items[speed.items.length - 1].kind, 'return');
  // an edit goes into the slot it belongs to and leaves the rest of the row alone
  speed.items.find((i) => i.kind === 'speed').speed = 6;
  waypointsOf(speed)[0].height = 33;
  waypointsOf(speed)[1].heightRef = 'amsl';
  const edited = dec(writeMission(speed, 'qgc-wpl').data).trim().split('\n').map((l) => l.split('\t').map(Number));
  eq('edit: a new speed, the type of speed untouched', edited[3].slice(2, 6).join(), '3,178,0,6');
  eq('edit: a new height', edited[4][10], 33);
  eq('edit: a new height reference changes the frame', edited[6][2], 0);
  eq('edit: and only that', edited[8].slice(2, 4).join() + ' ' + edited[8][10], '3,16 18');
  const terrain = load('ardupilot-ArduCopter_Tests-copter_terrain_mission.txt');
  ok('ArduPilot terrain mission: heights are above the ground', waypointsOf(terrain).some((w) => w.heightRef === 'ground'), waypointsOf(terrain).map((w) => w.heightRef).join());
  const spline = load('ardupilot-ArduCopter_Tests-SplineWaypoint-copter_spline_mission.txt');
  ok('ArduPilot spline mission: spline waypoints are kept as commands, named', spline.items.some((i) => i.kind === 'raw' && i.command === 82 && i.label.includes('NAV_SPLINE_WAYPOINT')));

  const line = load('qgc-polyline.kml');
  eq('QGC polyline.kml: nine points', line.items.length, 9);
  near('QGC polyline.kml: first point latitude', line.items[0].lat, 46.47522);
  near('QGC polyline.kml: first point longitude', line.items[0].lng, 11.32613);
  ok('QGC polyline.kml: a line on the ground has no height', line.items.every((i) => i.height === null));
  eq('QGC polyline.kml: name', line.name, 'Circular Corridor Path');
  const poly = load('qgc-PolygonGood.kml');
  eq('QGC PolygonGood.kml: one area', poly.areas.length, 1);
  ok('QGC PolygonGood.kml: corners, without the closing repeat', poly.areas[0].points.length >= 3 && JSON.stringify(poly.areas[0].points[0]) !== JSON.stringify(poly.areas[0].points.at(-1)));
  eq('QGC polygon.kml: one area', load('qgc-polygon.kml').areas.length, 1);
} else {
  skipped += 1;
  console.log('  skipped: real files from QGroundControl and ArduPilot (no --upstream folder)');
}

console.log(`\nmission formats: ${passed} checks passed, ${failed} failed${skipped ? `, ${skipped} group(s) skipped` : ''}`);
process.exit(failed ? 1 : 0);
