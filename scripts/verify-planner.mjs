// Known-answer checks for the survey planner and the mission export.
// Usage: node scripts/verify-planner.mjs
import { haversine, toLatLng, toLocal, polygonArea, scanline, offsetPolyline } from '../lib/planner/geo.ts';
import { DEFAULT_PARAMS, footprintFor, planSurvey } from '../lib/planner/survey.ts';
import { CAMERA_PRESETS } from '../lib/planner/cameras.ts';
import { missionItems, toQgcPlan, toWpl } from '../lib/planner/export.ts';

let failed = 0;
let passed = 0;
function check(name, got, want, tol = 1e-6) {
  const ok = typeof want === 'number' ? Math.abs(got - want) <= tol : got === want;
  if (ok) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${got}, want ${want}`);
  }
}

const cam = CAMERA_PRESETS.find((c) => c.id === 'pi-cam3');
const ref = { lat: 40, lng: -100 };

// --- geometry
{
  const p = toLatLng({ x: 250, y: -130 }, ref);
  const back = toLocal(p, ref);
  check('round trip x', back.x, 250, 1e-6);
  check('round trip y', back.y, -130, 1e-6);
  check('haversine vs plane', haversine(ref, p), Math.hypot(250, 130), 0.05);
  check('area of 100 x 60', polygonArea([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }]), 6000);
  // a line through a corner of a diamond must give 0 or 2 crossings, never 1
  const diamond = [{ x: 0, y: -10 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: -10, y: 0 }];
  check('scanline through a corner is even', scanline(diamond, 0).length % 2, 0);
  check('scanline through the top corner is even', scanline(diamond, 10).length % 2, 0);
  const off = offsetPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10);
  check('offset left of an eastward line is north', off[0].y, 10);
}

// --- footprint (Camera Module 3 at 40 m, by hand)
const params = { ...DEFAULT_PARAMS, altitude: 40, sideOverlap: 0.65, frontOverlap: 0.75, speed: 5, turnaround: 5 };
{
  const fp = footprintFor(cam, params);
  check('across', fp.across, (6.45 * 40) / 4.74, 1e-9);
  check('along', fp.along, (3.63 * 40) / 4.74, 1e-9);
  check('gsd cm/px', fp.gsdCm, ((6.45 / 4608) * 40 * 100) / 4.74, 1e-9);
  check('line spacing', fp.lineSpacing, ((6.45 * 40) / 4.74) * 0.35, 1e-9);
  check('photo spacing', fp.photoSpacing, ((3.63 * 40) / 4.74) * 0.25, 1e-9);
  const portrait = footprintFor(cam, { ...params, orientation: 'portrait' });
  check('portrait swaps across and along', portrait.across, fp.along, 1e-9);
}

// --- grid over a 100 m (east-west) by 60 m (north-south) rectangle
const rect = [
  { x: -50, y: -30 },
  { x: 50, y: -30 },
  { x: 50, y: 30 },
  { x: -50, y: 30 },
].map((p) => toLatLng(p, ref));
const home = toLatLng({ x: -80, y: -40 }, ref);
const spacing = ((6.45 * 40) / 4.74) * 0.35;

for (const [angle, across, along] of [
  [90, 60, 100], // lines run east-west, stacked north-south
  [0, 100, 60], // lines run north-south, stacked east-west
]) {
  const r = planSurvey({ type: 'grid', vertices: rect, home, camera: cam, params: { ...params, angle }, enduranceMin: 14 });
  check(`grid ${angle}: ok`, r.ok, true);
  check(`grid ${angle}: lines`, r.lines, Math.ceil(across / spacing));
  check(`grid ${angle}: waypoints`, r.waypoints.length, 2 * Math.ceil(across / spacing));
  check(`grid ${angle}: area`, r.areaM2, 6000, 0.5);
  const local = r.waypoints.map((w) => toLocal(w, ref));
  // every line is the rectangle's length plus the overshoot at both ends
  for (let i = 0; i + 1 < local.length; i += 2) {
    check(`grid ${angle}: line ${i / 2} length`, Math.hypot(local[i + 1].x - local[i].x, local[i + 1].y - local[i].y), along + 10, 0.01);
    const dx = Math.abs(local[i + 1].x - local[i].x);
    const dy = Math.abs(local[i + 1].y - local[i].y);
    check(`grid ${angle}: line ${i / 2} direction`, angle === 90 ? dy : dx, 0, 0.01);
  }
  // neighbouring lines are one spacing apart, and the turn joins near ends
  for (let i = 2; i + 1 < local.length; i += 2) {
    const gap = angle === 90 ? Math.abs(local[i].y - local[i - 1].y) : Math.abs(local[i].x - local[i - 1].x);
    check(`grid ${angle}: spacing to line ${i / 2}`, gap, spacing, 0.01);
    const turn = Math.hypot(local[i].x - local[i - 1].x, local[i].y - local[i - 1].y);
    check(`grid ${angle}: turn ${i / 2} is short`, turn, spacing, 0.01);
  }
  // the first point is the corner nearest home
  const d0 = Math.hypot(local[0].x + 80, local[0].y + 40);
  for (const pt of local) if (Math.hypot(pt.x + 80, pt.y + 40) < d0 - 0.01) check(`grid ${angle}: starts nearest home`, false, true);
  check(`grid ${angle}: time is positive`, r.flightTime > 0, true);
  check(`grid ${angle}: total = survey + transit`, r.totalLength, r.surveyLength + r.transitLength, 1e-6);
}

// --- crosshatch is both grids
{
  const a = planSurvey({ type: 'grid', vertices: rect, home, camera: cam, params: { ...params, angle: 0 }, enduranceMin: 14 });
  const b = planSurvey({ type: 'grid', vertices: rect, home, camera: cam, params: { ...params, angle: 90 }, enduranceMin: 14 });
  const c = planSurvey({ type: 'crosshatch', vertices: rect, home, camera: cam, params: { ...params, angle: 0 }, enduranceMin: 14 });
  check('crosshatch lines', c.lines, a.lines + b.lines);
  check('crosshatch waypoints', c.waypoints.length, a.waypoints.length + b.waypoints.length);
}

// --- a concave (L-shaped) area: lines are split, none crosses the notch
{
  const L = [
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 },
  ].map((p) => toLatLng(p, ref));
  const r = planSurvey({ type: 'grid', vertices: L, home: null, camera: cam, params: { ...params, angle: 90, turnaround: 0 }, enduranceMin: 0 });
  check('L: ok', r.ok, true);
  check('L: area', r.areaM2, 100 * 40 + 40 * 60, 0.5);
  const local = r.waypoints.map((w) => toLocal(w, ref));
  for (let i = 0; i + 1 < local.length; i += 2) {
    const y = local[i].y;
    const maxX = Math.max(local[i].x, local[i + 1].x);
    check(`L: line at y=${y.toFixed(0)} stays inside`, maxX <= (y > 40 ? 40 : 100) + 0.01, true);
  }
  check('L: warns about no takeoff point', r.checks.some((c) => c.title === 'No takeoff point set'), true);
}

// --- corridor
{
  const line = [{ x: 0, y: 0 }, { x: 200, y: 0 }].map((p) => toLatLng(p, ref));
  const r = planSurvey({ type: 'corridor', vertices: line, home, camera: cam, params: { ...params, corridorWidth: 40 }, enduranceMin: 14 });
  check('corridor passes', r.lines, Math.ceil(40 / spacing));
  check('corridor area', r.areaM2, 200 * 40, 0.5);
  const local = r.waypoints.map((w) => toLocal(w, ref));
  const ys = [...new Set(local.map((p) => p.y.toFixed(3)))].map(Number).sort((a, b) => a - b);
  check('corridor passes are centred', ys[0] + ys[ys.length - 1], 0, 0.01);
  check('corridor pass spacing', ys[1] - ys[0], spacing, 0.01);
}

// --- orbit
{
  const r = planSurvey({ type: 'orbit', vertices: [ref], home, camera: cam, params: { ...params, orbitRadius: 25, orbitPoints: 12 }, enduranceMin: 14 });
  check('orbit waypoints close the circle', r.waypoints.length, 13);
  const local = r.waypoints.map((w) => toLocal(w, ref));
  for (const p of local) check('orbit radius', Math.hypot(p.x, p.y), 25, 0.01);
  // heading at each point looks at the centre
  const p0 = local[3];
  const want = (Math.atan2(-p0.x, -p0.y) * 180) / Math.PI;
  check('orbit faces the centre', ((r.waypoints[3].heading - want + 540) % 360) - 180, 0, 0.01);
  check('orbit length', r.surveyLength, 12 * 2 * 25 * Math.sin(Math.PI / 12), 0.01);
}

// --- checks
{
  const high = planSurvey({ type: 'grid', vertices: rect, home, camera: cam, params: { ...params, altitude: 130 }, enduranceMin: 14 });
  check('above 120 m is critical', high.checks.some((c) => c.level === 'critical' && c.title.startsWith('Above 120')), true);
  const long = planSurvey({ type: 'grid', vertices: rect, home, camera: cam, params: { ...params, altitude: 10 }, enduranceMin: 3 });
  check('over endurance is critical', long.checks.some((c) => c.title === 'Longer than one battery'), true);
  const none = planSurvey({ type: 'grid', vertices: rect.slice(0, 2), home, camera: cam, params, enduranceMin: 14 });
  check('two corners is not a plan', none.ok, false);
}

// --- limits: a stray click on a zoomed-out map must not ask for a million lines
{
  const huge = [{ lat: 57.7, lng: -84.7 }, { lat: 63.8, lng: 84.3 }, { lat: -28.3, lng: 105.8 }];
  const t0 = performance.now();
  const r = planSurvey({ type: 'grid', vertices: huge, home: null, camera: cam, params, enduranceMin: 14 });
  check('continent-sized area is refused', r.ok, false);
  check('refusal says how big it is', /km across/.test(r.reason), true);
  check('refusal is instant', performance.now() - t0 < 50, true);
  check('refused plan has no waypoints', r.waypoints.length, 0);
  // 5 km square at 10 m: inside the size limit, far too many lines
  const big = [{ x: -2500, y: -2500 }, { x: 2500, y: -2500 }, { x: 2500, y: 2500 }, { x: -2500, y: 2500 }].map((q) => toLatLng(q, ref));
  const many = planSurvey({ type: 'grid', vertices: big, home: null, camera: cam, params: { ...params, altitude: 10 }, enduranceMin: 14 });
  check('too many lines is refused', many.ok, false);
  check('refusal names the line limit', /stops at 400/.test(many.reason), true);
  const wide = planSurvey({ type: 'corridor', vertices: big.slice(0, 2), home: null, camera: cam, params: { ...params, altitude: 10, corridorWidth: 2000 }, enduranceMin: 14 });
  check('too many corridor passes is refused', wide.ok, false);
  // the largest sensible job still plans, and quickly
  const field = [{ x: -400, y: -300 }, { x: 400, y: -300 }, { x: 400, y: 300 }, { x: -400, y: 300 }].map((q) => toLatLng(q, ref));
  const t1 = performance.now();
  const ok = planSurvey({ type: 'crosshatch', vertices: field, home, camera: cam, params, enduranceMin: 14 });
  check('a 48 hectare field plans', ok.ok, true);
  check('and does so in under 50 ms', performance.now() - t1 < 50, true);
}

// --- export
{
  const r = planSurvey({ type: 'grid', vertices: rect, home, camera: cam, params: { ...params, angle: 90, cameraTrigger: true }, enduranceMin: 14 });
  const input = { type: 'grid', waypoints: r.waypoints, home, params: { ...params, cameraTrigger: true }, photoSpacing: r.footprint.photoSpacing, firmware: 'px4' };
  const items = missionItems(input);
  check('first item is takeoff', items[0].command, 22);
  check('last item is return', items[items.length - 1].command, 20);
  check('waypoint count', items.filter((i) => i.command === 16).length, r.waypoints.length);
  check('camera trigger on and off', items.filter((i) => i.command === 206).length, 2);
  const plan = JSON.parse(toQgcPlan(input));
  check('plan fileType', plan.fileType, 'Plan');
  check('plan firmware is PX4', plan.mission.firmwareType, 12);
  check('plan items', plan.mission.items.length, items.length);
  check('plan item params length', plan.mission.items.every((i) => i.params.length === 7), true);
  check('plan doJumpId runs from 1', plan.mission.items.map((i) => i.doJumpId).join(), items.map((_, i) => i + 1).join());
  check('plan takeoff altitude', plan.mission.items[0].params[6], 40);
  check('plan takeoff latitude', plan.mission.items[0].params[4], Math.round(home.lat * 1e7) / 1e7);
  const ardu = JSON.parse(toQgcPlan({ ...input, firmware: 'ardupilot' }));
  check('plan firmware is ArduPilot', ardu.mission.firmwareType, 3);
  const wpl = toWpl(input).trimEnd().split('\n');
  check('wpl header', wpl[0], 'QGC WPL 110');
  check('wpl rows', wpl.length, items.length + 2);
  check('wpl columns', wpl.slice(1).every((row) => row.split('\t').length === 12), true);
  check('wpl row 0 is home and current', wpl[1].split('\t').slice(0, 4).join(), '0,1,0,16');
  check('wpl latitude column', Number(wpl[1].split('\t')[8]), Math.round(home.lat * 1e7) / 1e7);
  check('wpl longitude column', Number(wpl[1].split('\t')[9]), Math.round(home.lng * 1e7) / 1e7);
  const orbit = planSurvey({ type: 'orbit', vertices: [ref], home, camera: cam, params, enduranceMin: 14 });
  const oi = missionItems({ type: 'orbit', waypoints: orbit.waypoints, home, params, photoSpacing: 0, firmware: 'px4', roi: ref });
  check('orbit sets a region of interest', oi.some((i) => i.command === 195), true);
  check('orbit clears the region of interest', oi.some((i) => i.command === 197), true);
}

console.log(`\nplanner: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
