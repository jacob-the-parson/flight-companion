// Survey planning: from an area, a camera and a height to a flight path and the
// numbers that describe it.
//
// The photogrammetry is the standard pinhole model:
//   ground sample distance = pixel size × height / focal length
//   footprint              = sensor size × height / focal length
//   spacing                = footprint × (1 − overlap)
// Imports are type-only or carry the .ts extension so this file also runs under
// plain Node for the verification script.
import {
  bearing,
  centroid,
  dist,
  offsetPolyline,
  pathLength,
  polygonArea,
  rotate,
  scanline,
  toLatLng,
  toLocal,
  type LatLng,
  type XY,
} from './geo.ts';
import type { Camera } from './cameras.ts';

export type SurveyType = 'grid' | 'crosshatch' | 'corridor' | 'orbit' | 'perimeter';

export const SURVEY_TYPES: { id: SurveyType; label: string; short: string; shape: string; use: string }[] = [
  {
    id: 'grid',
    label: 'Area grid',
    short: 'Grid',
    shape: 'polygon',
    use: 'Parallel lines over an area. Maps and orthomosaics.',
  },
  {
    id: 'crosshatch',
    label: 'Crosshatch',
    short: 'Cross',
    shape: 'polygon',
    use: 'Two grids at right angles. 3D models and buildings, at twice the flight time.',
  },
  {
    id: 'corridor',
    label: 'Corridor',
    short: 'Corridor',
    shape: 'line',
    use: 'Parallel passes along a line. Roads, fences, rivers, pipelines.',
  },
  {
    id: 'orbit',
    label: 'Orbit',
    short: 'Orbit',
    shape: 'point',
    use: 'A circle around one point, camera facing in. Towers, trees, single structures.',
  },
  {
    id: 'perimeter',
    label: 'Perimeter',
    short: 'Edge',
    shape: 'polygon',
    use: 'Once around the boundary. Fence lines and site edges.',
  },
];

export interface SurveyParams {
  /** Height above the takeoff point, metres. */
  altitude: number;
  /** Overlap between one photo and the next along a line, 0..0.95. */
  frontOverlap: number;
  /** Overlap between one line and the next, 0..0.95. */
  sideOverlap: number;
  /** Direction the grid lines run, degrees from north, clockwise. */
  angle: number;
  /** Ground speed on the lines, m/s. */
  speed: number;
  /** Distance flown past each end of a line before turning, metres. */
  turnaround: number;
  /** Long side of the photo across the line of flight (the usual way) or along it. */
  orientation: 'landscape' | 'portrait';
  corridorWidth: number;
  orbitRadius: number;
  /** Photos (waypoints) around one orbit. */
  orbitPoints: number;
  /** Add a camera-trigger-by-distance command to the exported mission. */
  cameraTrigger: boolean;
}

export const DEFAULT_PARAMS: SurveyParams = {
  altitude: 40,
  frontOverlap: 0.75,
  sideOverlap: 0.65,
  angle: 0,
  speed: 5,
  turnaround: 5,
  orientation: 'landscape',
  corridorWidth: 40,
  orbitRadius: 20,
  orbitPoints: 24,
  cameraTrigger: false,
};

export type WaypointKind = 'line-start' | 'line-end' | 'turn' | 'point';

export interface Waypoint extends LatLng {
  alt: number;
  kind: WaypointKind;
  /** Compass heading to hold at this point, when the pattern cares (orbit). */
  heading?: number;
}

export type CheckLevel = 'good' | 'warning' | 'critical';

export interface PlanCheck {
  level: CheckLevel;
  title: string;
  detail: string;
}

/** The largest job the planner will take on. */
export const LIMITS = {
  /** Greatest distance between any two drawn points, metres. */
  extentM: 20000,
  /** Most lines in one grid or passes in one corridor. */
  lines: 400,
};

/** Zoom level of the map below which a click is more likely a slip than a corner. */
export const MIN_DRAW_ZOOM = 13;

/** Rates used for the time estimate. Shown in the app wherever a time is shown. */
export const ASSUMPTIONS = {
  climbMs: 1.5,
  descentMs: 0.7,
  secondsPerTurn: 3,
};

export interface Footprint {
  /** Ground sample distance, centimetres per pixel. */
  gsdCm: number;
  /** Ground covered by one photo across the line of flight, metres. */
  across: number;
  /** Ground covered by one photo along the line of flight, metres. */
  along: number;
  lineSpacing: number;
  photoSpacing: number;
  /** Seconds between photos at the planned speed. */
  triggerInterval: number;
}

export interface PlanResult {
  ok: boolean;
  /** Why there is no path yet, in words for the user. */
  reason?: string;
  footprint: Footprint;
  waypoints: Waypoint[];
  lines: number;
  photos: number;
  /** Area of the drawn polygon or corridor, square metres. */
  areaM2: number;
  /** Length of the survey pattern itself, metres. */
  surveyLength: number;
  /** Home to the first point plus the last point back to home, metres. */
  transitLength: number;
  totalLength: number;
  /** Seconds, including climb, turns, transit and descent. */
  flightTime: number;
  /** Farthest waypoint from home, metres. */
  maxDistanceFromHome: number;
  checks: PlanCheck[];
}

export function footprintFor(camera: Camera, p: SurveyParams): Footprint {
  const h = Math.max(0, p.altitude);
  const f = Math.max(1e-6, camera.focalLengthMm);
  const groundW = (camera.sensorWidthMm * h) / f;
  const groundH = (camera.sensorHeightMm * h) / f;
  const across = p.orientation === 'landscape' ? groundW : groundH;
  const along = p.orientation === 'landscape' ? groundH : groundW;
  const gsdCm = ((camera.sensorWidthMm / Math.max(1, camera.imageWidthPx)) * h * 100) / f;
  const lineSpacing = across * (1 - clamp(p.sideOverlap, 0, 0.95));
  const photoSpacing = along * (1 - clamp(p.frontOverlap, 0, 0.95));
  return {
    gsdCm,
    across,
    along,
    lineSpacing,
    photoSpacing,
    triggerInterval: p.speed > 0 ? photoSpacing / p.speed : Number.POSITIVE_INFINITY,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

interface Line {
  a: XY;
  b: XY;
}

/** Parallel lines across a polygon, running in the compass direction `angleDeg`. */
function gridLines(poly: XY[], spacing: number, angleDeg: number, turnaround: number): Line[] {
  if (poly.length < 3 || spacing <= 0) return [];
  // Rotate the polygon so the wanted line direction lies along +x. A compass
  // bearing θ is the direction (sin θ, cos θ); that vector sits at the maths angle
  // 90° − θ, so rotating by −(90° − θ) lays it on the x axis.
  const rot = -((90 - angleDeg) * Math.PI) / 180;
  const turned = poly.map((p) => rotate(p, rot));
  let ymin = Number.POSITIVE_INFINITY;
  let ymax = Number.NEGATIVE_INFINITY;
  for (const p of turned) {
    ymin = Math.min(ymin, p.y);
    ymax = Math.max(ymax, p.y);
  }
  const height = ymax - ymin;
  const count = Math.max(1, Math.ceil(height / spacing));
  // centre the set of lines on the area so both edges get the same margin
  const first = ymin + (height - (count - 1) * spacing) / 2;
  const lines: Line[] = [];
  for (let i = 0; i < count; i++) {
    const y = first + i * spacing;
    const xs = scanline(turned, y);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      if (xs[k + 1] - xs[k] < 0.5) continue; // a sliver: not worth a pass
      lines.push({
        a: rotate({ x: xs[k] - turnaround, y }, -rot),
        b: rotate({ x: xs[k + 1] + turnaround, y }, -rot),
      });
    }
  }
  return lines;
}

/** Join lines end to end, back and forth, always starting the next one at its nearer end. */
function serpentine(input: Line[], start?: XY): XY[] {
  const path: XY[] = [];
  let here = start;
  let lines = input;
  // begin on whichever side of the area is nearer: a pattern that starts at the
  // far side flies the whole width of the area before taking its first photo
  if (start && lines.length > 1) {
    const near = (l: Line) => Math.min(dist(start, l.a), dist(start, l.b));
    if (near(lines[lines.length - 1]) < near(lines[0])) lines = lines.slice().reverse();
  }
  lines.forEach((line, i) => {
    let { a, b } = line;
    const flip = here ? dist(here, b) < dist(here, a) : i % 2 === 1;
    if (flip) [a, b] = [b, a];
    path.push(a, b);
    here = b;
  });
  return path;
}

function countPhotos(path: XY[], photoSpacing: number): number {
  if (photoSpacing <= 0) return 0;
  let n = 0;
  for (let i = 0; i + 1 < path.length; i += 2) {
    n += Math.floor(dist(path[i], path[i + 1]) / photoSpacing) + 1;
  }
  return n;
}

const EMPTY = (footprint: Footprint, reason: string): PlanResult => ({
  ok: false,
  reason,
  footprint,
  waypoints: [],
  lines: 0,
  photos: 0,
  areaM2: 0,
  surveyLength: 0,
  transitLength: 0,
  totalLength: 0,
  flightTime: 0,
  maxDistanceFromHome: 0,
  checks: [],
});

export interface PlanInput {
  type: SurveyType;
  vertices: LatLng[];
  home: LatLng | null;
  camera: Camera;
  params: SurveyParams;
  /** Minutes the aircraft can fly on its planning numbers; 0 = unknown. */
  enduranceMin: number;
}

export function planSurvey(input: PlanInput): PlanResult {
  const { type, vertices, home, camera, params: p, enduranceMin } = input;
  const fp = footprintFor(camera, p);

  if (p.altitude <= 0) return EMPTY(fp, 'Set a flight height above zero.');
  if (p.speed <= 0) return EMPTY(fp, 'Set a speed above zero.');
  if (camera.focalLengthMm <= 0 || camera.sensorWidthMm <= 0 || camera.imageWidthPx <= 0) {
    return EMPTY(fp, 'The camera needs a sensor size, a focal length and a pixel count.');
  }

  const need = type === 'orbit' ? 1 : type === 'corridor' ? 2 : 3;
  if (vertices.length < need) {
    const what =
      type === 'orbit'
        ? 'Click the map to place the centre of the orbit.'
        : type === 'corridor'
          ? 'Click the map to draw the line to follow. Two points or more.'
          : 'Click the map to draw the area. Three corners or more.';
    return EMPTY(fp, what);
  }

  const ref = centroid(vertices);
  const local = vertices.map((v) => toLocal(v, ref));
  const homeXY = home ? toLocal(home, ref) : null;

  // Refuse anything a small aircraft could not fly. It also keeps the flat-plane
  // geometry honest, and stops a stray click on a zoomed-out map from asking for
  // a million lines.
  let extent = 0;
  for (const a of local) for (const b of local) extent = Math.max(extent, dist(a, b));
  if (extent > LIMITS.extentM) {
    return EMPTY(
      fp,
      `This is ${(extent / 1000).toFixed(0)} km across. The planner works on areas up to ${LIMITS.extentM / 1000} km across. Zoom in to the flying site and draw it there.`,
    );
  }
  if (type === 'grid' || type === 'crosshatch' || type === 'corridor') {
    const across = type === 'corridor' ? Math.max(0, p.corridorWidth) : extent;
    const estimate = Math.ceil(across / Math.max(fp.lineSpacing, 1e-6));
    if (!Number.isFinite(estimate) || estimate > LIMITS.lines) {
      return EMPTY(
        fp,
        `At this height and overlap the area needs about ${Number.isFinite(estimate) ? estimate.toLocaleString('en-US') : 'too many'} lines. The planner stops at ${LIMITS.lines}. Fly higher, lower the side overlap, or draw a smaller area.`,
      );
    }
  }

  let path: XY[] = [];
  let kinds: WaypointKind[] = [];
  let headings: (number | undefined)[] = [];
  let lines = 0;
  let photos = 0;
  let areaM2 = 0;
  let closed = false;

  if (type === 'grid' || type === 'crosshatch') {
    areaM2 = polygonArea(local);
    const first = gridLines(local, fp.lineSpacing, p.angle, p.turnaround);
    path = serpentine(first, homeXY ?? undefined);
    lines = first.length;
    if (type === 'crosshatch') {
      const second = gridLines(local, fp.lineSpacing, p.angle + 90, p.turnaround);
      path = path.concat(serpentine(second, path[path.length - 1]));
      lines += second.length;
    }
    kinds = path.map((_, i) => (i % 2 === 0 ? 'line-start' : 'line-end'));
    photos = countPhotos(path, fp.photoSpacing);
    if (lines === 0) return EMPTY(fp, 'The area is too small for even one line at this height.');
  } else if (type === 'corridor') {
    const width = Math.max(0, p.corridorWidth);
    const passes = Math.max(1, Math.ceil(width / Math.max(fp.lineSpacing, 0.01)));
    const centreLength = pathLength(local);
    areaM2 = centreLength * width;
    const span = (passes - 1) * fp.lineSpacing;
    for (let i = 0; i < passes; i++) {
      const pass = offsetPolyline(local, -span / 2 + i * fp.lineSpacing);
      const ordered = i % 2 === 0 ? pass : pass.slice().reverse();
      ordered.forEach((pt, k) => {
        path.push(pt);
        kinds.push(k === 0 ? 'line-start' : k === ordered.length - 1 ? 'line-end' : 'turn');
      });
      photos += Math.floor(pathLength(pass) / Math.max(fp.photoSpacing, 0.01)) + 1;
    }
    lines = passes;
  } else if (type === 'orbit') {
    const r = Math.max(1, p.orbitRadius);
    const n = Math.max(4, Math.round(p.orbitPoints));
    const centre = local[0];
    areaM2 = Math.PI * r * r;
    // start at the point of the circle nearest home, so the transit is shortest
    const startAngle = homeXY ? Math.atan2(homeXY.x - centre.x, homeXY.y - centre.y) : 0;
    for (let i = 0; i <= n; i++) {
      const a = startAngle + (i / n) * 2 * Math.PI;
      const pt = { x: centre.x + r * Math.sin(a), y: centre.y + r * Math.cos(a) };
      path.push(pt);
      kinds.push('point');
      headings.push(bearing(pt, centre));
    }
    lines = 1;
    photos = n;
  } else {
    // perimeter
    areaM2 = polygonArea(local);
    path = local.slice();
    path.push(local[0]);
    kinds = path.map(() => 'turn');
    closed = true;
    lines = 1;
    photos = Math.floor(pathLength(path) / Math.max(fp.photoSpacing, 0.01)) + 1;
  }

  if (headings.length === 0) headings = path.map(() => undefined);

  const surveyLength = pathLength(path);
  const transitLength = homeXY
    ? dist(homeXY, path[0]) + dist(path[path.length - 1], homeXY)
    : 0;
  const totalLength = surveyLength + transitLength;
  const turns = Math.max(0, path.length - 1);
  const flightTime =
    p.altitude / ASSUMPTIONS.climbMs +
    totalLength / p.speed +
    turns * ASSUMPTIONS.secondsPerTurn +
    p.altitude / ASSUMPTIONS.descentMs;

  let maxDistanceFromHome = 0;
  if (homeXY) for (const pt of path) maxDistanceFromHome = Math.max(maxDistanceFromHome, dist(homeXY, pt));

  const waypoints: Waypoint[] = path.map((pt, i) => ({
    ...toLatLng(pt, ref),
    alt: p.altitude,
    kind: kinds[i] ?? 'point',
    ...(headings[i] !== undefined ? { heading: headings[i] } : null),
  }));

  const checks: PlanCheck[] = [];
  const minutes = flightTime / 60;

  if (!home) {
    checks.push({
      level: 'warning',
      title: 'No takeoff point set',
      detail: 'Set the takeoff point on the map. Without it the flight to and from the area is not counted.',
    });
  }
  if (enduranceMin > 0) {
    if (minutes > enduranceMin) {
      checks.push({
        level: 'critical',
        title: 'Longer than one battery',
        detail: `Estimated ${minutes.toFixed(1)} min against ${enduranceMin.toFixed(1)} min of planned endurance. Fly it in parts, raise the height, or lower the overlap.`,
      });
    } else if (minutes > enduranceMin * 0.8) {
      checks.push({
        level: 'warning',
        title: 'Close to one battery',
        detail: `Estimated ${minutes.toFixed(1)} min is over 80 % of the ${enduranceMin.toFixed(1)} min planned endurance. Wind will use the rest.`,
      });
    } else {
      checks.push({
        level: 'good',
        title: 'Fits in one battery',
        detail: `Estimated ${minutes.toFixed(1)} min against ${enduranceMin.toFixed(1)} min of planned endurance.`,
      });
    }
  }
  if (p.altitude > 120) {
    checks.push({
      level: 'critical',
      title: 'Above 120 m (400 ft)',
      detail: 'Recreational and Part 107 flights in the United States are limited to 400 ft above ground unless authorised. Check the rule that applies to you.',
    });
  }
  if (home && maxDistanceFromHome > 400) {
    checks.push({
      level: 'warning',
      title: 'A long way from the pilot',
      detail: `The farthest point is ${Math.round(maxDistanceFromHome)} m from takeoff. Confirm you can see the aircraft, and tell which way it points, at that distance.`,
    });
  }
  if (type !== 'orbit' && fp.triggerInterval < 1) {
    checks.push({
      level: 'warning',
      title: 'Photos less than a second apart',
      detail: `At ${p.speed} m/s the camera must fire every ${fp.triggerInterval.toFixed(2)} s. Fly slower or higher unless you know the camera keeps up.`,
    });
  }
  if (p.frontOverlap < 0.6 || p.sideOverlap < 0.5) {
    checks.push({
      level: 'warning',
      title: 'Low overlap',
      detail: 'Photogrammetry software generally wants 70 % or more front overlap and 60 % or more side overlap to stitch reliably.',
    });
  }
  if (waypoints.length > 500) {
    checks.push({
      level: 'warning',
      title: 'Many waypoints',
      detail: `${waypoints.length} waypoints. Uploads over a telemetry radio get slow; split the area or widen the spacing.`,
    });
  }

  return {
    ok: true,
    footprint: fp,
    waypoints,
    lines,
    photos,
    areaM2,
    surveyLength: closed ? surveyLength : surveyLength,
    transitLength,
    totalLength,
    flightTime,
    maxDistanceFromHome,
    checks,
  };
}
