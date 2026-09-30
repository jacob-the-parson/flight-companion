// The observer: what has been heard from the aircraft, and the answers made
// from it. QGroundControl can forward a copy of everything the aircraft tells
// it; this file keeps the newest of each kind of message and answers questions
// from what it holds.
//
// Nothing here opens a socket, reads a file or makes a packet. Packets come in
// through handle(), already read by lib/mavlink/decode.ts; the answers are
// plain objects. The socket is in mcp/observer/listener.ts.
//
// It is the Python observer (mcp/observer/server.py) written again, tool for
// tool, and checked against it (scripts/verify-observer-js.mjs). Where the two
// differ on purpose, the comment says so.
import { offsetOf, type MavPacket, type MavValue } from '../mavlink/decode.ts';
import { MAV_ENUMS, MAV_MESSAGES } from '../mavlink/messages.ts';
import { sameValue } from '../params/model.ts';

export interface ObserverSettings {
  host: string;
  port: number;
  /** Whether answers may say where the aircraft is. */
  showPlace: boolean;
}

export const DEFAULT_SETTINGS: ObserverSettings = { host: '127.0.0.1', port: 14445, showPlace: false };

export const PLACE_LEFT_OUT = 'left out; set FC_OBSERVER_PLACE=1 to include';

interface Seen {
  t: number;
  id: number;
  fields: Record<string, MavValue>;
}

export interface HeldParam {
  value: number;
  type: number;
  type_name: string;
  index: number;
}

interface HeardText {
  t: number;
  severity: number;
  severity_name: string;
  text: string;
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Answer = Record<string, Json>;

const MAX_TEXTS = 500;
const MAX_ERRORS = 50;

// ---------------------------------------------------------------- small things

const round = (v: number, places: number): number => {
  const k = 10 ** places;
  return Math.round(v * k) / k;
};

function enumName(name: string, value: number, fallback = '?'): string {
  return MAV_ENUMS[name]?.values[value] ?? fallback;
}

/** The names in a list of flags that are wholly set in a value. */
function flagsSet(name: string, value: number | bigint): string[] {
  const e = MAV_ENUMS[name];
  if (!e) return [];
  const v = BigInt(value);
  const out: string[] = [];
  for (const [k, label] of Object.entries(e.values)) {
    const bit = BigInt(k);
    if (bit === BigInt(0) || label.endsWith('_ENUM_END')) continue;
    if ((v & bit) === bit) out.push(label);
  }
  return out;
}

/** A value as JSON can hold it. A number too large for JavaScript to hold exactly is given as text. */
function plain(v: MavValue | undefined): Json {
  if (v === undefined) return null;
  if (typeof v === 'bigint') return v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER) ? v.toString() : Number(v);
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v);
  if (Array.isArray(v)) return (v as (number | bigint)[]).map((x) => plain(x));
  return v;
}

const num = (v: MavValue | undefined): number => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : 0);
const hex = (v: MavValue | undefined): string | null => (Array.isArray(v) && v.length > 0 ? (v as number[]).map((b) => Number(b).toString(16).padStart(2, '0')).join('') : null);

// Messages that carry a position in fields with no unit of their own: a mission
// item's x and y are a latitude and a longitude in most frames.
const PLACE_BY_MESSAGE: Record<string, string[]> = {
  MISSION_ITEM: ['x', 'y'],
  MISSION_ITEM_INT: ['x', 'y'],
  COMMAND_INT: ['x', 'y'],
  COMMAND_LONG: ['param5', 'param6'],
  ORBIT_EXECUTION_STATUS: ['x', 'y'],
  FIGURE_EIGHT_EXECUTION_STATUS: ['x', 'y'],
};
const PLACE_NAME = /(^|_)(lat|lon|latitude|longitude)(_|$)/i;

/** The fields of a message that say where something is. Height is not among them. */
export function placeFields(id: number): string[] {
  const m = MAV_MESSAGES[id];
  if (!m) return [];
  const named = m.fields.filter((f) => f.units === 'degE7' || PLACE_NAME.test(f.name)).map((f) => f.name);
  return [...named, ...(PLACE_BY_MESSAGE[m.name] ?? [])];
}

// PX4 sends a whole-number parameter as its own bytes in the place of the
// number with a fraction. They are read from the bytes as they were sent: a
// number with a fraction cannot be trusted to carry them (-1 as bytes is "not
// a number" when read as one).
const WHOLE: Record<number, (v: DataView, at: number) => number> = {
  1: (v, at) => v.getUint8(at),
  2: (v, at) => v.getInt8(at),
  3: (v, at) => v.getUint16(at, true),
  4: (v, at) => v.getInt16(at, true),
  5: (v, at) => v.getUint32(at, true),
  6: (v, at) => v.getInt32(at, true),
};
const PARAM_VALUE_ID = 22;
const VALUE_AT = offsetOf(MAV_MESSAGES[PARAM_VALUE_ID], 'param_value');

function paramValue(p: MavPacket): number {
  const type = num(p.fields.param_type);
  const read = WHOLE[type];
  if (!read) return num(p.fields.param_value);
  return read(new DataView(p.payload.buffer, p.payload.byteOffset, p.payload.byteLength), VALUE_AT);
}

/** PX4's flight mode from a heartbeat's custom_mode. */
export function px4Mode(custom: number): Answer {
  const main = (custom >>> 16) & 0xff;
  const sub = (custom >>> 24) & 0xff;
  const mains: Record<number, string> = { 1: 'MANUAL', 2: 'ALTCTL', 3: 'POSCTL', 4: 'AUTO', 5: 'ACRO', 6: 'OFFBOARD', 7: 'STABILIZED', 8: 'RATTITUDE' };
  const autos: Record<number, string> = { 1: 'READY', 2: 'TAKEOFF', 3: 'LOITER', 4: 'MISSION', 5: 'RTL', 6: 'LAND', 7: 'RTGS', 8: 'FOLLOW_TARGET', 9: 'PRECLAND' };
  let name = mains[main] ?? `main=${main}`;
  if (main === 4) name += `:${autos[sub] ?? `sub=${sub}`}`;
  else if (main === 3 && sub === 2) name += ':ORBIT';
  return { main_mode: main, sub_mode: sub, name, note: 'PX4 custom_mode decode; verify against PX4 docs if it matters' };
}

/** A QGroundControl .params file: comment lines, then system, component, name, value, type. */
export function readParamsText(text: string): Map<string, { value: string; type: string | null }> {
  const out = new Map<string, { value: string; type: string | null }>();
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.startsWith('#')) continue;
    let parts = raw.split('\t');
    if (parts.length < 4) parts = raw.trim().split(/\s+/);
    if (parts.length >= 4) out.set(parts[2], { value: parts[3], type: parts.length > 4 ? parts[4] : null });
  }
  return out;
}

// ---------------------------------------------------------------- what has been heard

export class ObserverState {
  started: number;
  bytesSeen = 0;
  lastRx: number | null = null;
  latest = new Map<string, Seen>();
  counts = new Map<string, number>();
  firstSeen = new Map<string, number>();
  params = new Map<string, HeldParam>();
  paramCount: number | null = null;
  texts: HeardText[] = [];
  chunks = new Map<number, string>();
  errors: { t: number; error: string }[] = [];
  /** Messages that were QGroundControl's own and not the aircraft's. */
  fromGroundStation = 0;

  constructor(now: number) {
    this.started = now;
  }

  noteBytes(n: number): void {
    this.bytesSeen += n;
  }

  noteError(error: string, now: number): void {
    this.errors.push({ t: now, error });
    if (this.errors.length > MAX_ERRORS) this.errors.shift();
  }

  /** Takes one packet. `now` is the time in seconds. */
  handle(p: MavPacket, now: number): void {
    // QGroundControl forwards its own messages too (its heartbeat, its requests).
    // Only the aircraft's belong here: a ground station's heartbeat would show as
    // a vehicle that is not there.
    if (p.system === 255 || (p.name === 'HEARTBEAT' && num(p.fields.type) === 6)) {
      this.fromGroundStation += 1;
      return;
    }
    this.lastRx = now;
    this.latest.set(p.name, { t: now, id: p.id, fields: p.fields });
    this.counts.set(p.name, (this.counts.get(p.name) ?? 0) + 1);
    if (!this.firstSeen.has(p.name)) this.firstSeen.set(p.name, now);

    if (p.name === 'PARAM_VALUE') {
      const count = num(p.fields.param_count);
      // a restart can change which parameters there are; what is held is of the old set
      if (this.paramCount !== null && this.paramCount !== count) this.params.clear();
      const type = num(p.fields.param_type);
      this.params.set(String(p.fields.param_id), {
        value: paramValue(p),
        type,
        type_name: enumName('MAV_PARAM_TYPE', type),
        index: num(p.fields.param_index),
      });
      this.paramCount = count;
    } else if (p.name === 'STATUSTEXT') {
      let text = String(p.fields.text);
      const id = num(p.fields.id);
      if (id) {
        const whole = (this.chunks.get(id) ?? '') + text;
        // a long message comes in pieces; the last piece is shorter than the field
        if (text.length < 50) {
          this.chunks.delete(id);
          text = whole;
        } else {
          this.chunks.set(id, whole);
          return;
        }
      }
      const severity = num(p.fields.severity);
      this.texts.push({ t: now, severity, severity_name: enumName('MAV_SEVERITY', severity), text });
      if (this.texts.length > MAX_TEXTS) this.texts.shift();
    }
  }

  // ------------------------------------------------------------ kept between two programs

  /** Everything held, as text, for another program on this computer to read. */
  toSnapshot(now: number): string {
    const big = (_k: string, v: unknown) => (typeof v === 'bigint' ? { $big: v.toString() } : typeof v === 'number' && !Number.isFinite(v) ? { $num: String(v) } : v);
    return JSON.stringify(
      {
        schema: 'flight-companion/observer-snapshot@1',
        written: now,
        started: this.started,
        bytesSeen: this.bytesSeen,
        lastRx: this.lastRx,
        latest: [...this.latest],
        counts: [...this.counts],
        firstSeen: [...this.firstSeen],
        params: [...this.params],
        paramCount: this.paramCount,
        texts: this.texts,
        errors: this.errors,
        fromGroundStation: this.fromGroundStation,
      },
      big,
    );
  }

  static fromSnapshot(text: string): ObserverState {
    const back = (_k: string, v: unknown) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        if (typeof o.$big === 'string' && Object.keys(o).length === 1) return BigInt(o.$big);
        if (typeof o.$num === 'string' && Object.keys(o).length === 1) return Number(o.$num);
      }
      return v;
    };
    const o = JSON.parse(text, back) as Record<string, unknown>;
    if (o.schema !== 'flight-companion/observer-snapshot@1') throw new Error('This is not an observer snapshot.');
    const s = new ObserverState(Number(o.started));
    s.bytesSeen = Number(o.bytesSeen);
    s.lastRx = o.lastRx === null ? null : Number(o.lastRx);
    s.latest = new Map(o.latest as [string, Seen][]);
    s.counts = new Map(o.counts as [string, number][]);
    s.firstSeen = new Map(o.firstSeen as [string, number][]);
    s.params = new Map(o.params as [string, HeldParam][]);
    s.paramCount = o.paramCount === null ? null : Number(o.paramCount);
    s.texts = o.texts as HeardText[];
    s.errors = o.errors as { t: number; error: string }[];
    s.fromGroundStation = Number(o.fromGroundStation);
    return s;
  }
}

// ---------------------------------------------------------------- the answers

const age = (t: number | null | undefined, now: number): number | null => (t === null || t === undefined ? null : round(now - t, 1));

export function status(s: ObserverState, now: number, settings: ObserverSettings): Answer {
  const out: Answer = {
    listening_on: `${settings.host}:${settings.port}`,
    server_uptime_s: round(now - s.started, 1),
    receiving: s.lastRx !== null && now - s.lastRx < 5,
    last_packet_age_s: age(s.lastRx, now),
    bytes_seen: s.bytesSeen,
    message_types_seen: s.counts.size,
    params_received: s.params.size,
    params_expected: s.paramCount,
    recent_errors: s.errors.slice(-3),
  };
  const hb = s.latest.get('HEARTBEAT');
  if (!hb) {
    out.vehicle = null;
    out.hint = `No HEARTBEAT yet. In QGC: Application Settings -> MAVLink -> Enable MAVLink forwarding, host 'localhost:${settings.port}'.`;
    return out;
  }
  const h = hb.fields;
  const base = num(h.base_mode);
  out.vehicle = {
    heartbeat_age_s: age(hb.t, now),
    type: enumName('MAV_TYPE', num(h.type)),
    autopilot: enumName('MAV_AUTOPILOT', num(h.autopilot)),
    system_status: enumName('MAV_STATE', num(h.system_status)),
    armed: (base & 128) !== 0,
    base_mode_flags: flagsSet('MAV_MODE_FLAG', base),
    mode: px4Mode(num(h.custom_mode)),
    mavlink_version: plain(h.mavlink_version),
  };
  return out;
}

export function autopilotVersion(s: ObserverState, now: number): Answer {
  const item = s.latest.get('AUTOPILOT_VERSION');
  if (!item) {
    return { error: 'AUTOPILOT_VERSION not seen yet. Reconnect the vehicle in QGC or open Analyze Tools -> MAVLink Inspector to trigger a request.' };
  }
  const v = item.fields;
  const ver = (raw: MavValue): Answer => {
    const u = num(raw);
    const major = (u >>> 24) & 0xff;
    const minor = (u >>> 16) & 0xff;
    const patch = (u >>> 8) & 0xff;
    return { major, minor, patch, type: enumName('FIRMWARE_VERSION_TYPE', u & 0xff, String(u & 0xff)), string: `${major}.${minor}.${patch}` };
  };
  const hexOf = (raw: MavValue, digits: number) => `0x${BigInt(raw as number | bigint).toString(16).padStart(digits, '0')}`;
  return {
    age_s: age(item.t, now),
    flight_sw_version: ver(v.flight_sw_version),
    flight_custom_version_hex: hex(v.flight_custom_version),
    middleware_sw_version: ver(v.middleware_sw_version),
    middleware_custom_version_hex: hex(v.middleware_custom_version),
    os_sw_version: ver(v.os_sw_version),
    os_custom_version_hex: hex(v.os_custom_version),
    board_version: plain(v.board_version),
    board_version_hex: hexOf(v.board_version, 8),
    vendor_id: plain(v.vendor_id),
    vendor_id_hex: hexOf(v.vendor_id, 4),
    product_id: plain(v.product_id),
    product_id_hex: hexOf(v.product_id, 4),
    uid: plain(v.uid),
    uid_hex: hexOf(v.uid, 16),
    uid2_hex: hex(v.uid2),
    capabilities: flagsSet('MAV_PROTOCOL_CAPABILITY', v.capabilities as bigint),
  };
}

export function params(s: ObserverState, prefix = '', limit = 300): Answer {
  const want = prefix.toUpperCase();
  const names = [...s.params.keys()].filter((k) => k.toUpperCase().startsWith(want)).sort();
  const held: Answer = {};
  for (const n of names.slice(0, Math.max(0, limit))) held[n] = { ...s.params.get(n)! };
  return { matched: names.length, returned: Math.min(names.length, Math.max(0, limit)), cached_total: s.params.size, vehicle_total: s.paramCount, params: held };
}

export function param(s: ObserverState, name: string): Answer {
  const v = s.params.get(name) ?? s.params.get(name.toUpperCase());
  if (!v) return { error: `${name} not in cache`, cached_total: s.params.size };
  return { name: name.toUpperCase(), ...v };
}

export function messages(s: ObserverState, now: number, n = 50, minSeverity = 7): Answer {
  const items = s.texts.filter((m) => m.severity <= minSeverity).slice(-Math.max(1, n));
  return { count: items.length, messages: items.map((m) => ({ age_s: age(m.t, now), severity: m.severity_name, text: m.text })) };
}

export function sensors(s: ObserverState, now: number, settings: ObserverSettings): Answer {
  const out: Answer = {};
  const ss = s.latest.get('SYS_STATUS');
  const gps = s.latest.get('GPS_RAW_INT');
  const bat = s.latest.get('BATTERY_STATUS');
  const ekf = s.latest.get('ESTIMATOR_STATUS');
  if (ss) {
    const f = ss.fields;
    const present = BigInt(num(f.onboard_control_sensors_present));
    const enabled = BigInt(num(f.onboard_control_sensors_enabled));
    const health = BigInt(num(f.onboard_control_sensors_health));
    const table: Record<string, { enabled: boolean; healthy: boolean }> = {};
    for (const [k, label] of Object.entries(MAV_ENUMS.MAV_SYS_STATUS_SENSOR.values)) {
      const bit = BigInt(k);
      if (bit === BigInt(0) || label.endsWith('_ENUM_END')) continue;
      if ((present & bit) !== BigInt(0)) table[label] = { enabled: (enabled & bit) !== BigInt(0), healthy: (health & bit) !== BigInt(0) };
    }
    const volts = num(f.voltage_battery);
    const amps = num(f.current_battery);
    const left = num(f.battery_remaining);
    out.sys_status = {
      age_s: age(ss.t, now),
      unhealthy: Object.entries(table)
        .filter(([, r]) => r.enabled && !r.healthy)
        .map(([name]) => name),
      sensors: table,
      voltage_battery_V: volts === 65535 ? null : volts / 1000,
      current_battery_A: amps === -1 ? null : amps / 100,
      battery_remaining_pct: left === -1 ? null : left,
      load_pct: num(f.load) / 10,
    };
  }
  if (gps) {
    const g = gps.fields;
    const eph = num(g.eph);
    const about: Answer = {
      age_s: age(gps.t, now),
      fix_type: enumName('GPS_FIX_TYPE', num(g.fix_type)),
      satellites_visible: num(g.satellites_visible),
      hdop: eph === 65535 ? null : eph / 100,
      alt_m: num(g.alt) / 1000,
    };
    if (settings.showPlace) {
      about.lat = num(g.lat) / 1e7;
      about.lon = num(g.lon) / 1e7;
    } else {
      about.place = PLACE_LEFT_OUT;
    }
    out.gps = about;
  }
  if (bat) {
    const b = bat.fields;
    out.battery_status = {
      age_s: age(bat.t, now),
      id: num(b.id),
      cells_mV: (b.voltages as number[]).filter((c) => c !== 65535),
      remaining_pct: num(b.battery_remaining),
    };
  }
  if (ekf) out.estimator = { age_s: age(ekf.t, now), flags: flagsSet('ESTIMATOR_STATUS_FLAGS', num(ekf.fields.flags)) };
  if (Object.keys(out).length === 0) out.error = 'No SYS_STATUS seen yet.';
  return out;
}

export function traffic(s: ObserverState, now: number): Answer {
  const rows = [...s.counts]
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      const first = s.firstSeen.get(type) ?? now;
      const last = s.latest.get(type)?.t ?? now;
      const span = Math.max(last - first, 1e-6);
      return { type, count, rate_hz: count > 1 ? round((count - 1) / span, 2) : null, age_s: round(now - last, 1) };
    });
  return { types: rows.length, messages: rows };
}

export function latest(s: ObserverState, now: number, settings: ObserverSettings, type: string): Answer {
  const name = type.toUpperCase();
  const item = s.latest.get(name);
  if (!item) return { error: `${name} not seen yet`, seen_types: [...s.counts.keys()].sort() };
  const hidden = settings.showPlace ? [] : placeFields(item.id);
  const fields: Answer = {};
  for (const [k, v] of Object.entries(item.fields)) fields[k] = hidden.includes(k) ? PLACE_LEFT_OUT : plain(v);
  return { type: name, age_s: age(item.t, now), fields };
}

/**
 * What differs between the aircraft now and a saved .params file, given as the
 * file's text. Two values are the same if the aircraft would store the same
 * number (lib/params/model.ts). The Python observer calls two values the same
 * when they are within a millionth of each other, which hides a change to a
 * very small value; this one does not.
 */
export function diffLive(s: ObserverState, fileText: string, fileName: string): Answer {
  const saved = readParamsText(fileText);
  const changed: Answer = {};
  const names = [...saved.keys()].filter((k) => s.params.has(k)).sort();
  for (const k of names) {
    const live = s.params.get(k)!;
    const was = saved.get(k)!.value;
    const n = Number(was);
    const same = was.trim() !== '' && Number.isFinite(n) ? sameValue(n, live.value, live.type) : was === String(live.value);
    if (!same) changed[k] = { file: was, live: live.value };
  }
  return {
    file: fileName,
    live_cached: s.params.size,
    file_count: saved.size,
    changed,
    only_in_file: [...saved.keys()].filter((k) => !s.params.has(k)).sort(),
    only_live: [...s.params.keys()].filter((k) => !saved.has(k)).sort(),
  };
}

/** The nine tools by the names an assistant calls them by. */
export const OBSERVER_TOOL_NAMES = ['status', 'autopilot_version', 'params', 'param', 'messages', 'sensors', 'traffic', 'latest', 'diff_live_against_file'] as const;
