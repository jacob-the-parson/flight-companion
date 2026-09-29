// From a parsed PX4 log to something a person can read: what the flight was, the
// series worth plotting, and FINDINGS — observations the log supports, each with
// the numbers behind it.
//
// A finding is an observation, not a verdict. Where a threshold is this app's own
// rule of thumb rather than a published limit, the text says what was measured and
// leaves the judgement to the reader.
//
// Runs in a Web Worker in the app and under plain Node in the verification script,
// so: no DOM, no React, imports carry the .ts extension.
import { ULog } from './parser.ts';

export type FindingLevel = 'critical' | 'warning' | 'info' | 'good';

export interface Finding {
  id: string;
  level: FindingLevel;
  title: string;
  detail: string;
  /** Seconds into the log, when the finding points at a moment. */
  at?: number;
  /** Small label and value pairs: the evidence. */
  facts?: [label: string, value: string][];
  /** A value another part of the app can take from this finding. */
  offer?: { kind: 'hoverCurrent'; value: number };
}

export interface SeriesData {
  label: string;
  t: Float64Array;
  v: Float64Array;
}

export type ChartGroup = 'Flight' | 'Attitude' | 'Motors and control' | 'Power' | 'Sensors' | 'Custom';

export interface ChartData {
  id: string;
  group: ChartGroup;
  title: string;
  unit: string;
  /** One line under the title: what to look for. */
  note?: string;
  series: SeriesData[];
}

export interface Span {
  start: number;
  end: number;
}

export interface ModeSpan extends Span {
  navState: number;
  name: string;
}

export interface LogEvent {
  t: number;
  kind: 'message' | 'mode' | 'arm' | 'air' | 'param';
  /** syslog level for messages: 0 emergency .. 7 debug. */
  level: number;
  text: string;
}

export interface ParamRow {
  name: string;
  value: number;
  type: 'int32' | 'float';
  airframeDefault: number | null;
  firmwareDefault: number | null;
  /** Differs from the airframe default (or the firmware default when there is none). */
  changed: boolean;
}

export interface TopicInfo {
  key: string;
  count: number;
  fields: string[];
}

export interface FlightStats {
  airborneS: number;
  maxAltM: number | null;
  maxSpeedMs: number | null;
  distanceM: number | null;
  maxRollDeg: number | null;
  maxPitchDeg: number | null;
  cells: number | null;
  battStartV: number | null;
  battMinV: number | null;
  battEndV: number | null;
  battStartPct: number | null;
  battMinPct: number | null;
  maxCurrentA: number | null;
  meanAirCurrentA: number | null;
  usedMah: number | null;
  satsMin: number | null;
  satsMax: number | null;
  vibrationMax: number | null;
  motorMeansUs: number[] | null;
}

export interface FlightSummary {
  duration: number;
  /** UTC time logging started, epoch ms, when the log carries a clock. */
  startUtcMs: number | null;
  system: {
    firmware: string;
    release: string;
    hardware: string;
    os: string;
    airframeId: number | null;
    rotorCount: number | null;
  };
  log: {
    bytes: number;
    topics: number;
    dataMessages: number;
    dropouts: number;
    dropoutMs: number;
    truncated: boolean;
    corruptBytes: number;
  };
  armed: Span[];
  airborne: Span[];
  modes: ModeSpan[];
  stats: FlightStats;
  track: { t: Float64Array; lat: Float64Array; lng: Float64Array } | null;
  home: { lat: number; lng: number } | null;
  events: LogEvent[];
  findings: Finding[];
  charts: ChartData[];
  topics: TopicInfo[];
  params: ParamRow[];
  paramChanges: { t: number; name: string; value: number }[];
}

// PX4 navigation states (vehicle_status.nav_state), v1.14 to v1.16.
const NAV_STATE: Record<number, string> = {
  0: 'Manual',
  1: 'Altitude',
  2: 'Position',
  3: 'Mission',
  4: 'Hold',
  5: 'Return',
  6: 'Position slow',
  10: 'Acro',
  12: 'Descend',
  13: 'Termination',
  14: 'Offboard',
  15: 'Stabilized',
  17: 'Takeoff',
  18: 'Land',
  19: 'Follow',
  20: 'Precision land',
  21: 'Orbit',
  22: 'VTOL takeoff',
};

export function navStateName(n: number): string {
  return NAV_STATE[n] ?? `Mode ${n}`;
}

const DEG = 180 / Math.PI;

// ------------------------------------------------------------------ helpers

function has(u: ULog, key: string, ...fields: string[]): boolean {
  const t = u.topicByKey(key);
  if (!t || t.count === 0) return false;
  return fields.every((f) => t.fields.some((x) => x.name === f));
}

/** Keep only the samples inside the log's own time range and with finite values. */
function clean(t: Float64Array, v: Float64Array, duration: number): SeriesData['t' | 'v'][] {
  let n = 0;
  for (let i = 0; i < t.length; i++) if (t[i] >= 0 && t[i] <= duration + 1 && Number.isFinite(v[i])) n++;
  if (n === t.length) return [t, v];
  const tt = new Float64Array(n);
  const vv = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i] >= 0 && t[i] <= duration + 1 && Number.isFinite(v[i])) {
      tt[k] = t[i];
      vv[k] = v[i];
      k++;
    }
  }
  return [tt, vv];
}

function series(
  u: ULog,
  label: string,
  key: string,
  field: string,
  map?: (v: number) => number,
): SeriesData | null {
  if (!has(u, key, field)) return null;
  const v = u.column(key, field);
  if (map) for (let i = 0; i < v.length; i++) v[i] = map(v[i]);
  const [t, vv] = clean(u.time(key), v, u.duration);
  return t.length > 0 ? { label, t, v: vv } : null;
}

function present<T>(list: (T | null)[]): T[] {
  return list.filter((x): x is T => x !== null);
}

/** Spans during which a 0/1 signal is 1. */
function spansWhere(t: Float64Array, v: Float64Array, on: (x: number) => boolean, end: number): Span[] {
  const out: Span[] = [];
  let start: number | null = null;
  for (let i = 0; i < t.length; i++) {
    const active = on(v[i]);
    if (active && start === null) start = Math.max(0, t[i]);
    if (!active && start !== null) {
      out.push({ start, end: Math.max(start, t[i]) });
      start = null;
    }
  }
  if (start !== null) out.push({ start, end: Math.max(start, end) });
  return out.filter((s) => s.end > s.start);
}

function inSpans(spans: Span[], t: number): boolean {
  for (const s of spans) if (t >= s.start && t <= s.end) return true;
  return false;
}

function total(spans: Span[]): number {
  return spans.reduce((a, s) => a + (s.end - s.start), 0);
}

interface Agg {
  n: number;
  min: number;
  max: number;
  mean: number;
  first: number;
  last: number;
}

function aggregate(t: Float64Array, v: Float64Array, within?: Span[]): Agg | null {
  let n = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let sum = 0;
  let first = Number.NaN;
  let last = Number.NaN;
  for (let i = 0; i < t.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x) || t[i] < 0) continue;
    if (within && !inSpans(within, t[i])) continue;
    if (n === 0) first = x;
    last = x;
    n++;
    sum += x;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return n === 0 ? null : { n, min, max, mean: sum / n, first, last };
}

/** Linear interpolation of a series at time x. */
function sampleAt(t: Float64Array, v: Float64Array, x: number): number {
  const n = t.length;
  if (n === 0) return Number.NaN;
  if (x <= t[0]) return v[0];
  if (x >= t[n - 1]) return v[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - t[lo]) / (t[hi] - t[lo] || 1);
  return v[lo] + f * (v[hi] - v[lo]);
}

function eulerSeries(
  u: ULog,
  key: string,
  q: [string, string, string, string],
): { t: Float64Array; roll: Float64Array; pitch: Float64Array; yaw: Float64Array } | null {
  if (!has(u, key, ...q)) return null;
  const q0 = u.column(key, q[0]);
  const q1 = u.column(key, q[1]);
  const q2 = u.column(key, q[2]);
  const q3 = u.column(key, q[3]);
  const t = u.time(key);
  const n = t.length;
  const roll = new Float64Array(n);
  const pitch = new Float64Array(n);
  const yaw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = q0[i];
    const x = q1[i];
    const y = q2[i];
    const z = q3[i];
    roll[i] = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * DEG;
    pitch[i] = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))) * DEG;
    yaw[i] = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * DEG;
  }
  return { t, roll, pitch, yaw };
}

function fix(v: number, d = 1): string {
  return Number.isFinite(v) ? v.toFixed(d) : 'n/a';
}

function clock(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

/** A message without the name of the module that wrote it: "[commander] Armed" becomes "Armed". */
export function plain(text: string): string {
  return text.replace(/^\[[a-z0-9_]+\]\s*/i, '').replace(/\s+/g, ' ').trim();
}

const LEVEL_NAME = ['Emergency', 'Alert', 'Critical', 'Error', 'Warning', 'Notice', 'Info', 'Debug'];
export function levelName(level: number): string {
  return LEVEL_NAME[level] ?? 'Info';
}

// ------------------------------------------------------------------ summary

export function summarize(u: ULog): FlightSummary {
  const duration = u.duration;
  const P = u.params;

  // --- spans
  let armed: Span[] = [];
  let modes: ModeSpan[] = [];
  if (has(u, 'vehicle_status', 'nav_state', 'arming_state')) {
    const t = u.time('vehicle_status');
    armed = spansWhere(t, u.column('vehicle_status', 'arming_state'), (x) => x === 2, duration);
    const nav = u.column('vehicle_status', 'nav_state');
    // the mode in force when logging began runs from zero
    let start = 0;
    for (let i = 1; i <= nav.length; i++) {
      if (i === nav.length || nav[i] !== nav[i - 1]) {
        const end = i === nav.length ? duration : Math.max(0, t[i]);
        if (end > start) {
          modes.push({ start, end, navState: nav[i - 1], name: navStateName(nav[i - 1]) });
        }
        start = Math.max(start, end);
      }
    }
  }
  let airborne: Span[] = [];
  if (has(u, 'vehicle_land_detected', 'landed')) {
    airborne = spansWhere(
      u.time('vehicle_land_detected'),
      u.column('vehicle_land_detected', 'landed'),
      (x) => x === 0,
      duration,
    );
  }
  // a log that starts in the air has no "landed" sample before it: keep as is
  modes = modes.filter((m) => m.end - m.start > 0);

  // --- attitude
  const att = eulerSeries(u, 'vehicle_attitude', ['q[0]', 'q[1]', 'q[2]', 'q[3]']);
  const attSp = eulerSeries(u, 'vehicle_attitude_setpoint', ['q_d[0]', 'q_d[1]', 'q_d[2]', 'q_d[3]']);

  // --- position
  let altSeries: SeriesData | null = null;
  let altSpSeries: SeriesData | null = null;
  let speedH: SeriesData | null = null;
  let speedV: SeriesData | null = null;
  let distanceM: number | null = null;
  let z0 = 0;
  if (has(u, 'vehicle_local_position', 'x', 'y', 'z', 'vx', 'vy', 'vz')) {
    const key = 'vehicle_local_position';
    const t = u.time(key);
    const z = u.column(key, 'z');
    // Height is measured from the moment the aircraft left the ground: the
    // estimate drifts while it sits armed, and that drift is not height. A log
    // with no takeoff in it is measured from where it began.
    z0 = Number.NaN;
    if (airborne.length > 0) z0 = sampleAt(t, z, airborne[0].start);
    if (!Number.isFinite(z0)) {
      for (let i = 0; i < z.length; i++) {
        if (t[i] >= 0 && Number.isFinite(z[i])) {
          z0 = z[i];
          break;
        }
      }
    }
    if (!Number.isFinite(z0)) z0 = 0;
    const alt = new Float64Array(z.length);
    for (let i = 0; i < z.length; i++) alt[i] = -(z[i] - z0);
    const [ta, va] = clean(t, alt, duration);
    altSeries = { label: 'Estimated', t: ta, v: va };

    const vx = u.column(key, 'vx');
    const vy = u.column(key, 'vy');
    const vz = u.column(key, 'vz');
    const h = new Float64Array(vx.length);
    const up = new Float64Array(vx.length);
    for (let i = 0; i < vx.length; i++) {
      h[i] = Math.hypot(vx[i], vy[i]);
      up[i] = -vz[i];
    }
    const [th, vh] = clean(t, h, duration);
    const [tv, vv] = clean(t, up, duration);
    speedH = { label: 'Over the ground', t: th, v: vh };
    speedV = { label: 'Climb (up is positive)', t: tv, v: vv };

    const x = u.column(key, 'x');
    const y = u.column(key, 'y');
    let d = 0;
    let px = Number.NaN;
    let py = Number.NaN;
    for (let i = 0; i < x.length; i++) {
      if (!inSpans(airborne, t[i]) || !Number.isFinite(x[i]) || !Number.isFinite(y[i])) continue;
      if (Number.isFinite(px)) d += Math.hypot(x[i] - px, y[i] - py);
      px = x[i];
      py = y[i];
    }
    distanceM = d;
  }
  if (has(u, 'vehicle_local_position_setpoint', 'z')) {
    altSpSeries = series(u, 'Setpoint', 'vehicle_local_position_setpoint', 'z', (z) => -(z - z0));
  }

  // --- track
  let track: FlightSummary['track'] = null;
  let home: FlightSummary['home'] = null;
  if (has(u, 'vehicle_global_position', 'lat', 'lon')) {
    const key = 'vehicle_global_position';
    const t = u.time(key);
    const lat = u.column(key, 'lat');
    const lon = u.column(key, 'lon');
    const keep: number[] = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] < 0 || !Number.isFinite(lat[i]) || !Number.isFinite(lon[i])) continue;
      if (lat[i] === 0 && lon[i] === 0) continue;
      keep.push(i);
    }
    // a map line does not need every sample: at most 5000 points
    const stride = Math.max(1, Math.ceil(keep.length / 5000));
    const n = Math.ceil(keep.length / stride);
    const tt = new Float64Array(n);
    const la = new Float64Array(n);
    const lo = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const i = keep[Math.min(keep.length - 1, k * stride)];
      tt[k] = t[i];
      la[k] = lat[i];
      lo[k] = lon[i];
    }
    if (n > 0) track = { t: tt, lat: la, lng: lo };
  }
  if (has(u, 'home_position', 'lat', 'lon')) {
    const lat = u.column('home_position', 'lat');
    const lon = u.column('home_position', 'lon');
    for (let i = lat.length - 1; i >= 0; i--) {
      if (Number.isFinite(lat[i]) && Number.isFinite(lon[i]) && (lat[i] !== 0 || lon[i] !== 0)) {
        home = { lat: lat[i], lng: lon[i] };
        break;
      }
    }
  }
  if (!home && track && track.lat.length > 0) home = { lat: track.lat[0], lng: track.lng[0] };

  // --- battery
  const cells = Number.isFinite(P.BAT1_N_CELLS) && P.BAT1_N_CELLS > 0 ? P.BAT1_N_CELLS : null;
  const capacity = Number.isFinite(P.BAT1_CAPACITY) && P.BAT1_CAPACITY > 0 ? P.BAT1_CAPACITY : null;
  const volt = series(u, 'Pack voltage', 'battery_status', 'voltage_v');
  const curr = series(u, 'Current', 'battery_status', 'current_a');
  const rem = series(u, 'Remaining', 'battery_status', 'remaining', (x) => x * 100);
  const mah = series(u, 'Used', 'battery_status', 'discharged_mah');

  // --- motors
  const rotorCount = Number.isFinite(P.CA_ROTOR_COUNT) ? P.CA_ROTOR_COUNT : null;
  const motorCount = Math.max(0, Math.min(8, rotorCount ?? 4));
  // which output channel carries which motor: PWM_MAIN_FUNCn = 100 + motor number
  const motorChannel: number[] = [];
  for (let m = 1; m <= motorCount; m++) {
    let ch = -1;
    for (let c = 1; c <= 8; c++) if (P[`PWM_MAIN_FUNC${c}`] === 100 + m) ch = c - 1;
    motorChannel.push(ch >= 0 ? ch : m - 1);
  }
  const motors = present(
    motorChannel.slice(0, 4).map((ch, m) => series(u, `Motor ${m + 1}`, 'actuator_outputs', `output[${ch}]`)),
  );

  // --- stats
  const air = airborne.length > 0 ? airborne : undefined;
  const vAgg = volt ? aggregate(volt.t, volt.v) : null;
  const iAgg = curr ? aggregate(curr.t, curr.v) : null;
  const iAir = curr && air ? aggregate(curr.t, curr.v, air) : null;
  const remAgg = rem ? aggregate(rem.t, rem.v) : null;
  const mahAgg = mah ? aggregate(mah.t, mah.v) : null;
  const altAgg = altSeries ? aggregate(altSeries.t, altSeries.v, air) : null;
  const spdAgg = speedH ? aggregate(speedH.t, speedH.v, air) : null;
  const rollAgg = att ? aggregate(att.t, att.roll.map(Math.abs), air) : null;
  const pitchAgg = att ? aggregate(att.t, att.pitch.map(Math.abs), air) : null;

  let sats: SeriesData | null = null;
  let eph: SeriesData | null = null;
  for (const key of ['vehicle_gps_position', 'sensor_gps']) {
    if (!sats) sats = series(u, 'Satellites used', key, 'satellites_used');
    if (!eph) eph = series(u, 'Horizontal accuracy', key, 'eph');
  }
  const satAgg = sats ? aggregate(sats.t, sats.v, air) : null;

  const vib = present([
    series(u, 'IMU 1', 'vehicle_imu_status', 'accel_vibration_metric'),
    series(u, 'IMU 2', 'vehicle_imu_status#1', 'accel_vibration_metric'),
  ]);
  let vibrationMax: number | null = null;
  for (const s of vib) {
    const a = aggregate(s.t, s.v, air);
    if (a) vibrationMax = Math.max(vibrationMax ?? 0, a.max);
  }

  const motorAgg = air ? motors.map((m) => aggregate(m.t, m.v, air)) : [];
  const motorMeansUs = motorAgg.length > 0 && motorAgg.every((a) => a) ? motorAgg.map((a) => a!.mean) : null;

  const stats: FlightStats = {
    airborneS: total(airborne),
    maxAltM: altAgg?.max ?? null,
    maxSpeedMs: spdAgg?.max ?? null,
    distanceM: air ? distanceM : null,
    maxRollDeg: rollAgg?.max ?? null,
    maxPitchDeg: pitchAgg?.max ?? null,
    cells,
    battStartV: vAgg?.first ?? null,
    battMinV: vAgg?.min ?? null,
    battEndV: vAgg?.last ?? null,
    battStartPct: remAgg?.first ?? null,
    battMinPct: remAgg?.min ?? null,
    maxCurrentA: iAgg?.max ?? null,
    meanAirCurrentA: iAir?.mean ?? null,
    // the aircraft counts charge since it was powered on; this log's share is the difference
    usedMah: mahAgg ? Math.max(0, mahAgg.last - mahAgg.first) : null,
    satsMin: satAgg?.min ?? null,
    satsMax: satAgg?.max ?? null,
    vibrationMax,
    motorMeansUs,
  };

  // --- events
  const events: LogEvent[] = [];
  for (const m of u.messages) {
    events.push({
      t: (m.timestamp - u.startTimestamp) / 1e6,
      kind: 'message',
      level: m.level >= 0 && m.level <= 7 ? m.level : 6,
      text: m.text.replace(/\s+$/, ''),
    });
  }
  modes.forEach((m, i) => {
    if (i > 0) events.push({ t: m.start, kind: 'mode', level: 6, text: `Mode: ${modes[i - 1].name} to ${m.name}` });
  });
  for (const s of airborne) {
    events.push({ t: s.start, kind: 'air', level: 6, text: 'Left the ground' });
    if (s.end < duration) events.push({ t: s.end, kind: 'air', level: 6, text: 'Back on the ground' });
  }
  const paramChanges = u.paramChanges.map((c) => ({
    t: Math.max(0, (c.timestamp - u.startTimestamp) / 1e6),
    name: c.name,
    value: c.value,
  }));
  for (const c of paramChanges) {
    events.push({ t: c.t, kind: 'param', level: 5, text: `Parameter ${c.name} set to ${c.value}` });
  }
  events.sort((a, b) => a.t - b.t);

  // --- charts
  const charts: ChartData[] = [];
  const add = (c: Omit<ChartData, 'series'> & { series: (SeriesData | null)[] }) => {
    const s = present(c.series);
    if (s.length > 0) charts.push({ ...c, series: s });
  };
  const sd = (label: string, t: Float64Array, v: Float64Array): SeriesData | null => {
    const [tt, vv] = clean(t, v, duration);
    return tt.length > 0 ? { label, t: tt, v: vv } : null;
  };

  add({
    id: 'altitude',
    group: 'Flight',
    title: 'Height above takeoff',
    unit: 'm',
    note: 'Estimated height against what the controller was asking for.',
    series: [altSeries, altSpSeries],
  });
  add({ id: 'speed', group: 'Flight', title: 'Speed', unit: 'm/s', series: [speedH, speedV] });

  for (const [axis, title] of [
    ['roll', 'Roll'],
    ['pitch', 'Pitch'],
    ['yaw', 'Heading'],
  ] as const) {
    add({
      id: `att-${axis}`,
      group: 'Attitude',
      title,
      unit: '°',
      note:
        axis === 'yaw'
          ? 'Heading wraps at plus and minus 180 degrees.'
          : 'The two lines should lie on top of each other. A gap is the aircraft not doing what it was told.',
      series: [
        att ? sd('Estimated', att.t, att[axis]) : null,
        attSp ? sd('Setpoint', attSp.t, attSp[axis]) : null,
      ],
    });
  }
  add({
    id: 'rates',
    group: 'Attitude',
    title: 'Rotation rate',
    unit: '°/s',
    series: [
      series(u, 'Roll rate', 'vehicle_angular_velocity', 'xyz[0]', (x) => x * DEG),
      series(u, 'Pitch rate', 'vehicle_angular_velocity', 'xyz[1]', (x) => x * DEG),
      series(u, 'Yaw rate', 'vehicle_angular_velocity', 'xyz[2]', (x) => x * DEG),
    ],
  });

  add({
    id: 'motors',
    group: 'Motors and control',
    title: 'Motor outputs',
    unit: 'µs',
    note: 'In a steady hover the four lines should run close together. A pair sitting apart means the controller is holding against something.',
    series: motors,
  });
  add({
    id: 'torque',
    group: 'Motors and control',
    title: 'Controller torque demand',
    unit: 'of full',
    note: 'What the controller is asking the motors for. A demand that sits away from zero is a steady imbalance.',
    series: [
      series(u, 'Roll', 'vehicle_torque_setpoint', 'xyz[0]'),
      series(u, 'Pitch', 'vehicle_torque_setpoint', 'xyz[1]'),
      series(u, 'Yaw', 'vehicle_torque_setpoint', 'xyz[2]'),
    ],
  });
  add({
    id: 'sticks',
    group: 'Motors and control',
    title: 'Stick inputs',
    unit: '−1 to 1',
    series: [
      series(u, 'Roll', 'manual_control_setpoint', 'roll'),
      series(u, 'Pitch', 'manual_control_setpoint', 'pitch'),
      series(u, 'Yaw', 'manual_control_setpoint', 'yaw'),
      series(u, 'Throttle', 'manual_control_setpoint', 'throttle'),
    ],
  });

  add({
    id: 'voltage',
    group: 'Power',
    title: 'Battery voltage',
    unit: 'V',
    note: 'Voltage drops under load and recovers on the ground. How far it drops is the health of the pack and its wiring.',
    series: [volt],
  });
  add({ id: 'current', group: 'Power', title: 'Battery current', unit: 'A', series: [curr] });
  add({
    id: 'remaining',
    group: 'Power',
    title: 'Battery remaining, as the aircraft sees it',
    unit: '%',
    note: 'This is the number the battery failsafe acts on.',
    series: [rem],
  });

  add({ id: 'sats', group: 'Sensors', title: 'GPS satellites used', unit: 'count', series: [sats] });
  add({ id: 'eph', group: 'Sensors', title: 'GPS horizontal accuracy', unit: 'm', series: [eph] });
  add({ id: 'vibration', group: 'Sensors', title: 'Accelerometer vibration', unit: 'm/s²', series: vib });

  // --- findings
  const findings = findIn(u, {
    duration,
    airborne,
    events,
    stats,
    volt,
    curr,
    rem,
    mah,
    motors,
    capacity,
    sats,
  });

  // --- parameters
  const params: ParamRow[] = Object.keys(P)
    .sort()
    .map((name) => {
      const airframeDefault = name in u.airframeDefaults ? u.airframeDefaults[name] : null;
      const firmwareDefault = name in u.systemDefaults ? u.systemDefaults[name] : null;
      const base = airframeDefault ?? firmwareDefault;
      const value = P[name];
      return {
        name,
        value,
        type: u.paramTypes[name] ?? 'float',
        airframeDefault,
        firmwareDefault,
        changed: base !== null && Math.abs(base - value) > 1e-6 * Math.max(1, Math.abs(base)),
      };
    });

  const str = (k: string) => (typeof u.info[k] === 'string' ? (u.info[k] as string) : '');
  // ver_sw_release packs the version as four bytes: major, minor, patch, type.
  // Type 255 is a release; below that, in bands of 64: development, alpha, beta,
  // release candidate (PX4 ULog documentation, "ver_sw_release").
  const release = (k: string): string => {
    const v = u.info[k];
    if (typeof v !== 'number' || v <= 0) return '';
    const type = v & 0xff;
    const kind = type === 255 ? '' : type >= 192 ? ' rc' : type >= 128 ? ' beta' : type >= 64 ? ' alpha' : ' dev';
    return `${(v >>> 24) & 0xff}.${(v >>> 16) & 0xff}.${(v >>> 8) & 0xff}${kind}`;
  };
  const sysName = str('sys_name') || 'PX4';
  const version = release('ver_sw_release');
  let startUtcMs: number | null = null;
  for (const key of ['vehicle_gps_position', 'sensor_gps']) {
    if (startUtcMs === null && has(u, key, 'time_utc_usec')) {
      const utc = u.column(key, 'time_utc_usec');
      const t = u.time(key);
      for (let i = 0; i < utc.length; i++) {
        if (utc[i] > 1e15) {
          startUtcMs = utc[i] / 1000 - t[i] * 1000;
          break;
        }
      }
    }
  }

  let dataMessages = 0;
  for (const t of u.topics) dataMessages += t.count;

  return {
    duration,
    startUtcMs,
    system: {
      firmware: version ? `${sysName} ${version}` : sysName,
      release: str('ver_sw'),
      hardware: [str('ver_hw'), str('ver_hw_subtype')].filter(Boolean).join(' ') || 'unknown',
      os: [str('sys_os_name'), release('sys_os_ver_release')].filter(Boolean).join(' '),
      airframeId: Number.isFinite(P.SYS_AUTOSTART) ? P.SYS_AUTOSTART : null,
      rotorCount,
    },
    log: {
      bytes: u.byteLength,
      topics: u.topics.filter((t) => t.count > 0).length,
      dataMessages,
      dropouts: u.dropouts.length,
      dropoutMs: u.dropouts.reduce((a, d) => a + d.durationMs, 0),
      truncated: u.truncated,
      corruptBytes: u.corruptBytes,
    },
    armed,
    airborne,
    modes,
    stats,
    track,
    home,
    events,
    findings,
    charts,
    topics: u.topics
      .filter((t) => t.count > 0)
      .map((t) => ({ key: t.key, count: t.count, fields: t.fields.filter((f) => f.name !== 'timestamp').map((f) => f.name) })),
    params,
    paramChanges,
  };
}

// ------------------------------------------------------------------ findings

interface FindInput {
  duration: number;
  airborne: Span[];
  events: LogEvent[];
  stats: FlightStats;
  volt: SeriesData | null;
  curr: SeriesData | null;
  rem: SeriesData | null;
  mah: SeriesData | null;
  motors: SeriesData[];
  capacity: number | null;
  sats: SeriesData | null;
}

function findIn(u: ULog, x: FindInput): Finding[] {
  const out: Finding[] = [];
  const P = u.params;
  const { stats, airborne } = x;
  const flew = stats.airborneS > 1;

  // 1. loss of attitude control
  const attFail = x.events.find((e) => e.kind === 'message' && /attitude failure/i.test(e.text));
  if (attFail) {
    const takeoff = airborne.find((s) => s.start <= attFail.t);
    const after = takeoff ? attFail.t - takeoff.start : null;
    out.push({
      id: 'attitude-failure',
      level: 'critical',
      title: 'The aircraft lost control of its attitude',
      at: attFail.t,
      detail:
        after !== null && after < 5
          ? `The flight controller reported "${plain(attFail.text)}" ${fix(after, 1)} s after leaving the ground. A roll-over that soon after takeoff is nearly always the airframe, not the tune: a motor on the wrong output, a motor spinning the wrong way, or a prop of the wrong hand. Check every motor against the layout the ground station draws, props off, before anything else.`
          : `The flight controller reported "${plain(attFail.text)}". Look at the roll and pitch charts at that moment, and at what the motors were doing just before it.`,
      facts: [
        ['At', clock(attFail.t)],
        ['Most roll', `${fix(stats.maxRollDeg ?? Number.NaN, 0)}°`],
        ['Most pitch', `${fix(stats.maxPitchDeg ?? Number.NaN, 0)}°`],
      ],
    });
  }

  // 2. failsafes
  const failsafes = x.events.filter(
    (e) => e.kind === 'message' && /failsafe activated|critical battery|low battery|emergency battery/i.test(e.text),
  );
  const batteryFailsafe = failsafes.some((e) => /battery/i.test(e.text));
  if (failsafes.length > 0 && !attFail) {
    const acted = failsafes.filter((e) => /failsafe activated/i.test(e.text)).length;
    out.push({
      id: 'failsafe',
      level: 'warning',
      title: batteryFailsafe ? 'A battery failsafe acted during the flight' : 'A failsafe acted during the flight',
      at: failsafes[0].t,
      detail:
        acted > 0
          ? `The flight controller stepped in ${acted === 1 ? 'once' : `${acted} times`}. The Events view has every message in order.`
          : 'The flight controller raised a battery warning. The Events view has every message in order.',
      facts: failsafes.slice(0, 5).map((e) => [clock(e.t), plain(e.text)] as [string, string]),
    });
  }

  // 3. pack not full at the start
  if (stats.battStartV !== null && stats.cells) {
    const perCell = stats.battStartV / stats.cells;
    if (perCell < 4.1 && perCell > 2.5) {
      out.push({
        id: 'pack-not-full',
        level: perCell < 4.0 ? 'warning' : 'info',
        title:
          perCell < 4.0
            ? 'The pack was not full when the log began'
            : 'The pack was a little short of full when the log began',
        detail: `It rested at ${fix(perCell, 2)} V per cell. A full lithium-polymer cell rests at 4.20 V. Charge the pack and confirm ${fix(4.2 * stats.cells, 1)} V with a meter before flying; a charger's display is not the check.`,
        facts: [
          ['Pack', `${fix(stats.battStartV, 2)} V`],
          ['Per cell', `${fix(perCell, 2)} V`],
          ['Cells', String(stats.cells)],
        ],
      });
    }
  }

  // After a loss of control the numbers below describe a crash, not the aircraft:
  // the current spike of stalled motors, outputs slammed to their limits. They
  // are left out so the one finding that matters is not buried.
  const steady = !attFail;

  // 4. voltage sag. Preferred: the pack's own resting voltage, read before the
  // motors drew anything, against its average in the air. That is the sag a
  // person would measure. Where the log has no quiet moment before takeoff, fall
  // back to fitting a straight line V = V0 - R * I through every sample.
  if (steady && x.volt && x.curr && x.volt.t.length > 20 && flew) {
    const firstUp = airborne[0].start;
    let restSum = 0;
    let restN = 0;
    for (let k = 0; k < x.volt.t.length; k++) {
      const t = x.volt.t[k];
      if (t >= firstUp - 0.5) break;
      const i = sampleAt(x.curr.t, x.curr.v, t);
      if (Number.isFinite(i) && i < 1) {
        restSum += x.volt.v[k];
        restN++;
      }
    }
    const vAir = aggregate(x.volt.t, x.volt.v, airborne);
    const iAir = stats.meanAirCurrentA;
    let r = Number.NaN;
    let v0 = Number.NaN;
    let method = '';
    if (restN >= 5 && vAir && iAir !== null && iAir > 3) {
      v0 = restSum / restN;
      r = (v0 - vAir.mean) / iAir;
      method = 'Resting voltage before takeoff against the average in the air';
    } else {
      let n = 0;
      let si = 0;
      let sv = 0;
      let sii = 0;
      let siv = 0;
      for (let k = 0; k < x.volt.t.length; k++) {
        const i = sampleAt(x.curr.t, x.curr.v, x.volt.t[k]);
        const v = x.volt.v[k];
        if (!Number.isFinite(i) || !Number.isFinite(v) || i < 0) continue;
        n++;
        si += i;
        sv += v;
        sii += i * i;
        siv += i * v;
      }
      const den = n * sii - si * si;
      if (n > 20 && Math.abs(den) > 1e-9) {
        const slope = (n * siv - si * sv) / den;
        r = -slope;
        v0 = (sv - slope * si) / n;
        method = 'Straight-line fit through voltage against current';
      }
    }
    if (Number.isFinite(r) && r > 0.005 && r < 1 && iAir !== null && iAir > 3) {
      const sag = r * iAir;
      const cells = stats.cells ?? 1;
      const minCell = stats.battMinV !== null ? stats.battMinV / cells : Number.NaN;
      const heavy = sag / cells > 0.2 || (Number.isFinite(minCell) && minCell < 3.6);
      out.push({
        id: 'voltage-sag',
        level: heavy ? 'warning' : 'info',
        title: heavy ? 'The pack voltage sags a lot under load' : 'Pack voltage under load',
        detail: heavy
          ? `In the air, at ${fix(iAir, 0)} A, the voltage sat ${fix(sag, 1)} V below its resting value. That is ${fix((sag / cells) * 1000, 0)} mV per cell. It is the resistance of the pack plus everything between it and the sensor: connectors, the power module, solder joints. After a flight, feel each connector; a warm one is the place to look. If everything is cool the pack itself is tired.`
          : `In the air, at ${fix(iAir, 0)} A, the voltage sat ${fix(sag, 1)} V below its resting value.`,
        facts: [
          ['Resistance, pack and wiring', `${fix(r * 1000, 0)} mΩ`],
          ['Resting voltage', `${fix(v0, 2)} V`],
          ['Average in the air', vAir ? `${fix(vAir.mean, 2)} V` : 'n/a'],
          ['Lowest under load', stats.battMinV !== null ? `${fix(stats.battMinV, 2)} V` : 'n/a'],
          ['Measured by', method],
        ],
      });
    }
  }

  // 5. percentage falling faster than charge was used
  if (steady && x.rem && x.mah && x.capacity && stats.battStartPct !== null && stats.battMinPct !== null && stats.usedMah !== null) {
    const fell = stats.battStartPct - stats.battMinPct;
    const used = (stats.usedMah / x.capacity) * 100;
    if (fell > 15 && fell > used * 3) {
      const rInt = P.BAT1_R_INTERNAL;
      out.push({
        id: 'percent-follows-sag',
        level: 'warning',
        title: 'The battery percentage followed the voltage, not the charge used',
        detail: `The aircraft's own estimate fell by ${fix(fell, 0)} points while ${fix(stats.usedMah, 0)} mAh was drawn, which is ${fix(used, 0)} % of a ${fix(x.capacity, 0)} mAh pack. The estimate is reading the sag under load as an empty pack, and the battery failsafe acts on that number.${
          Number.isFinite(rInt) && rInt < 0
            ? ' This aircraft has no load compensation configured (BAT1_R_INTERNAL is −1). Setting a measured internal resistance is a parameter change: look it up in the PX4 documentation and log the decision before making it.'
            : ''
        }`,
        facts: [
          ['Estimate at start', `${fix(stats.battStartPct, 0)} %`],
          ['Estimate at lowest', `${fix(stats.battMinPct, 0)} %`],
          ['Charge used', `${fix(stats.usedMah, 0)} mAh`],
        ],
      });
    }
  }

  // 6. motor balance, from the airframe geometry in the log's own parameters
  if (steady && flew && stats.motorMeansUs && stats.motorMeansUs.length === 4) {
    const m = stats.motorMeansUs;
    const geo = [0, 1, 2, 3].map((i) => ({
      px: P[`CA_ROTOR${i}_PX`],
      py: P[`CA_ROTOR${i}_PY`],
      km: P[`CA_ROTOR${i}_KM`],
    }));
    if (geo.every((g) => Number.isFinite(g.px) && Number.isFinite(g.py) && Number.isFinite(g.km))) {
      const mean = (idx: number[]) => (idx.length ? idx.reduce((a, i) => a + m[i], 0) / idx.length : Number.NaN);
      const pick = (f: (g: (typeof geo)[number]) => boolean) => geo.map((g, i) => (f(g) ? i : -1)).filter((i) => i >= 0);
      const names = (idx: number[]) => idx.map((i) => i + 1).join(' and ');
      const pairs: { what: string; a: number[]; b: number[]; aName: string; bName: string; cause: string }[] = [
        {
          what: 'yaw',
          a: pick((g) => g.km > 0),
          b: pick((g) => g.km < 0),
          aName: 'anticlockwise',
          bName: 'clockwise',
          cause:
            'The controller is holding the nose against a steady twist. Usual causes: props that are not all the same model, a bent prop, a motor no longer square on its arm, or two speed controllers set up differently from the other two.',
        },
        {
          what: 'roll',
          a: pick((g) => g.py > 0),
          b: pick((g) => g.py < 0),
          aName: 'right-hand',
          bName: 'left-hand',
          cause: 'The aircraft is heavier on the side working harder, or a motor or prop on that side is weak.',
        },
        {
          what: 'pitch',
          a: pick((g) => g.px > 0),
          b: pick((g) => g.px < 0),
          aName: 'front',
          bName: 'back',
          cause: 'The centre of gravity sits toward the end working harder. Moving the battery usually fixes it.',
        },
      ];
      let any = false;
      for (const p of pairs) {
        const diff = mean(p.a) - mean(p.b);
        if (!Number.isFinite(diff) || Math.abs(diff) < 100) continue;
        any = true;
        const hard = diff > 0 ? p.a : p.b;
        const easy = diff > 0 ? p.b : p.a;
        out.push({
          id: `motor-balance-${p.what}`,
          level: Math.abs(diff) > 200 ? 'warning' : 'info',
          title: `Motors ${names(hard)} worked harder than ${names(easy)}`,
          detail: `While in the air the ${diff > 0 ? p.aName : p.bName} motors averaged ${fix(Math.abs(diff), 0)} µs above the ${diff > 0 ? p.bName : p.aName} ones. ${p.cause} The pair doing less work also reaches its minimum first when the throttle comes down, which feels like motors cutting out on the descent.`,
          facts: m.map((v, i) => [`Motor ${i + 1}`, `${fix(v, 0)} µs`] as [string, string]),
        });
      }
      if (!any) {
        out.push({
          id: 'motor-balance-ok',
          level: 'good',
          title: 'The four motors shared the work evenly',
          detail: 'Front against back, left against right and clockwise against anticlockwise were all within 100 µs of each other in the air.',
          facts: m.map((v, i) => [`Motor ${i + 1}`, `${fix(v, 0)} µs`] as [string, string]),
        });
      }
    }
  }

  // 7. motors at their limits
  if (steady && flew && x.motors.length > 0) {
    let atMin = 0;
    let atMax = 0;
    let n = 0;
    const lo = x.motors.map((_, i) => (Number.isFinite(P[`PWM_MAIN_MIN${i + 1}`]) ? P[`PWM_MAIN_MIN${i + 1}`] : 1100));
    const hi = x.motors.map((_, i) => (Number.isFinite(P[`PWM_MAIN_MAX${i + 1}`]) ? P[`PWM_MAIN_MAX${i + 1}`] : 1900));
    const ref = x.motors[0];
    for (let k = 0; k < ref.t.length; k++) {
      if (!inSpans(airborne, ref.t[k])) continue;
      n++;
      let mn = false;
      let mx = false;
      x.motors.forEach((s, i) => {
        const v = k < s.v.length ? s.v[k] : Number.NaN;
        if (v <= lo[i] + 2) mn = true;
        if (v >= hi[i] - 2) mx = true;
      });
      if (mn) atMin++;
      if (mx) atMax++;
    }
    if (n > 10 && (atMax / n > 0.02 || atMin / n > 0.1)) {
      out.push({
        id: 'motor-limits',
        level: atMax / n > 0.05 ? 'warning' : 'info',
        title: 'Motors spent time at their limits',
        detail:
          'A motor at its maximum has nothing left to correct with, and one at its minimum has stopped helping. Short spells during a landing are normal. In a hover it means the aircraft is too heavy, out of balance, or fighting something.',
        facts: [
          ['At maximum', `${fix((atMax / n) * 100, 0)} % of the time in the air`],
          ['At minimum', `${fix((atMin / n) * 100, 0)} % of the time in the air`],
        ],
      });
    }
  }

  // 8. satellites
  if (flew && stats.satsMin !== null && stats.satsMin < 8) {
    out.push({
      id: 'gps-low',
      level: 'warning',
      title: 'Few GPS satellites during the flight',
      detail: `The count fell to ${fix(stats.satsMin, 0)} while in the air. Position hold and return both depend on it. Look for buildings, trees or a hillside close to the flying area.`,
      facts: [
        ['Fewest', fix(stats.satsMin, 0)],
        ['Most', fix(stats.satsMax ?? Number.NaN, 0)],
      ],
    });
  }

  // 9. the log itself
  if (u.truncated || u.corruptBytes > 0) {
    out.push({
      id: 'log-damaged',
      level: 'warning',
      title: u.truncated ? 'The log ends in the middle of a record' : 'Part of the log could not be read',
      detail:
        'That happens when power is cut or the card is pulled while the aircraft is still writing. Everything before the break is shown. Remove the battery only after the aircraft has disarmed.',
      facts: [['Unreadable', `${u.corruptBytes} bytes`]],
    });
  }
  if (u.dropouts.length > 0) {
    const ms = u.dropouts.reduce((a, d) => a + d.durationMs, 0);
    if (ms > 500) {
      out.push({
        id: 'log-dropouts',
        level: 'info',
        title: 'The logger fell behind at times',
        detail: 'Gaps in the charts at these moments are missing records, not something the aircraft did. A faster SD card usually cures it.',
        facts: [
          ['Gaps', String(u.dropouts.length)],
          ['Total', `${fix(ms / 1000, 1)} s`],
        ],
      });
    }
  }

  // 10. hover current, offered to the aircraft profile
  if (flew && stats.meanAirCurrentA !== null && stats.meanAirCurrentA > 1 && stats.airborneS > 8) {
    out.push({
      id: 'hover-current',
      level: 'info',
      title: `Average current in the air: ${fix(stats.meanAirCurrentA, 1)} A`,
      detail:
        'This is a measured figure for this aircraft at this weight. The flight planner estimates endurance from the hover current in the aircraft profile.',
      facts: [
        ['Time in the air', `${fix(stats.airborneS, 0)} s`],
        ['Highest current', `${fix(stats.maxCurrentA ?? Number.NaN, 1)} A`],
      ],
      offer: { kind: 'hoverCurrent', value: Math.round(stats.meanAirCurrentA * 10) / 10 },
    });
  }

  if (!flew) {
    out.push({
      id: 'did-not-fly',
      level: 'info',
      title: 'The aircraft did not leave the ground in this log',
      detail:
        'PX4 starts a log every time it is armed. An arm that is not followed by a takeoff within the pre-flight timeout disarms again and leaves a short log like this one.',
    });
  }

  const order: FindingLevel[] = ['critical', 'warning', 'info', 'good'];
  return out.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
}

/** One topic's fields as series, for the custom plot builder. */
export function customSeries(u: ULog, key: string, fields: string[]): SeriesData[] {
  const out: SeriesData[] = [];
  for (const f of fields.slice(0, 4)) {
    const s = series(u, f, key, f);
    if (s) out.push(s);
  }
  return out;
}
