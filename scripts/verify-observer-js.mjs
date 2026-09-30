// Checks for the observer written in JavaScript (lib/observer/), against the
// Python one it was written from. scripts/fixtures/observer-reference.json
// holds a made-up session and what the Python observer answered at several
// points in it; the same packets are played here and the answers compared.
// This script needs no Python; scripts/observer_reference.py writes the reference.
//
//   node scripts/verify-observer-js.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MavlinkReader } from '../lib/mavlink/decode.ts';
import * as observer from '../lib/observer/state.ts';
import { OBSERVER_SERVER } from '../lib/assistant/servers.ts';

const refText = readFileSync(fileURLToPath(new URL('./fixtures/observer-reference.json', import.meta.url)), 'utf8');
const ref = JSON.parse(refText);

let passed = 0;
let failed = 0;
const ok = (name, cond, detail = '') => {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/** Where two answers differ, as a list of paths. The order of an object's keys is not a difference. */
function differences(a, b, path = '') {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ? [] : [`${path}: ${a} against ${b}`];
  // Python writes "not a number" as nan, JavaScript as NaN
  if (typeof a === 'string' && typeof b === 'string' && a.toLowerCase().replace('infinity', 'inf') === b.toLowerCase().replace('infinity', 'inf')) return [];
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b ? [] : [`${path}: ${JSON.stringify(a)} against ${JSON.stringify(b)}`];
  if (Array.isArray(a) !== Array.isArray(b)) return [`${path}: one is a list`];
  if (Array.isArray(a)) {
    if (a.length !== b.length) return [`${path}: ${a.length} items against ${b.length}: ${JSON.stringify(a).slice(0, 200)} against ${JSON.stringify(b).slice(0, 200)}`];
    return a.flatMap((x, i) => differences(x, b[i], `${path}[${i}]`));
  }
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.flatMap((k) => (k in a && k in b ? differences(a[k], b[k], `${path}.${k}`) : [`${path}.${k}: only in ${k in a ? 'the JavaScript answer' : 'the Python answer'}`]));
}

ok('the reference names no folder of anybody\'s computer', !/Users|\/home\/|[A-Za-z]:[\\/]/.test(refText));

// ------------------------------------------------------------ the same session, the same answers
const state = new observer.ObserverState(ref.started);
const reader = new MavlinkReader();
let played = 0;
let compared = 0;
// Where the two differ on purpose. Each is named here and nowhere else, and each must be seen.
const onPurpose = new Map([
  [
    '.changed.EKF2_TINY: only in the JavaScript answer',
    'the file says 0.0000001 and the aircraft holds 0.0000005. The Python observer calls values within a millionth the same; this one does not.',
  ],
]);
const seenOnPurpose = new Set();

for (const point of ref.points) {
  while (played < point.after) {
    const p = ref.packets[played++];
    const raw = bytes(p.hex);
    state.noteBytes(raw.length);
    for (const packet of reader.push(raw)) state.handle(packet, p.t);
  }
  const settings = { host: '127.0.0.1', port: 14445, showPlace: point.place };
  const now = point.now;
  const mine = {
    status: observer.status(state, now, settings),
    autopilot_version: observer.autopilotVersion(state, now),
    params: observer.params(state),
    'params BAT': observer.params(state, 'bat'),
    'params limit 2': observer.params(state, '', 2),
    'param SYS_AUTOSTART': observer.param(state, 'SYS_AUTOSTART'),
    'param lower case': observer.param(state, 'cbrk_io_safety'),
    'param NOT_THERE': observer.param(state, 'NOT_THERE'),
    messages: observer.messages(state, now),
    'messages warnings': observer.messages(state, now, 10, 4),
    'messages last 2': observer.messages(state, now, 2),
    sensors: observer.sensors(state, now, settings),
    traffic: observer.traffic(state, now),
    diff_live_against_file: observer.diffLive(state, ref.params_text, ref.params_file),
  };
  for (const name of Object.keys(point.answers)) {
    if (name.startsWith('latest ')) mine[name] = observer.latest(state, now, settings, name === 'latest lower case' ? 'attitude' : name.slice(7));
  }
  for (const [name, want] of Object.entries(point.answers)) {
    // through JSON, as an assistant is given it
    const got = JSON.parse(JSON.stringify(mine[name] ?? null));
    const diffs = differences(got, want).filter((d) => {
      if (!onPurpose.has(d)) return true;
      seenOnPurpose.add(d);
      return false;
    });
    compared += 1;
    ok(`${point.name}: ${name}`, diffs.length === 0, diffs.slice(0, 6).join('\n         '));
  }
}
eq('every packet of the session was played', played, ref.packets.length);
eq('and every one was read', reader.stats.packets, ref.packets.length);
eq('with none damaged', reader.stats.badChecksum + reader.stats.unknown, 0);
ok('answers were compared', compared > 150, String(compared));
for (const [d, why] of onPurpose) ok(`differs on purpose, and was seen to: ${d}`, seenOnPurpose.has(d), why);
console.log(`  ${ref.packets.length} packets played, ${compared} answers compared at ${ref.points.length} points`);
for (const [d, why] of onPurpose) console.log(`  differs on purpose: ${d}\n    ${why}`);

// ------------------------------------------------------------ what the session must have shown
{
  const at = (name) => ref.points.find((p) => p.name === name);
  const settings = { host: '127.0.0.1', port: 14445, showPlace: false };
  const now = ref.points.at(-1).now;
  // these are of the JavaScript observer's own state at the end of the session
  eq('the ground station\'s messages were counted, and kept out', state.fromGroundStation, 2);
  ok('a ground station is never the vehicle', at('only the ground station has spoken').answers.status.vehicle === null);
  eq('after a restart only the new parameters are held', [...state.params.keys()].sort().join(), 'MADE_UP_I16,MADE_UP_U8,SYS_AUTOSTART');
  eq('a whole number of one byte', state.params.get('MADE_UP_U8').value, 200);
  eq('a negative whole number of two bytes', state.params.get('MADE_UP_I16').value, -300);
  eq('silence is reported as silence', observer.status(state, now, settings).receiving, false);
  const armed = at('parameters held, a long message, armed').answers;
  eq('reference: -1 survives', armed.params.params.BAT1_R_INTERNAL_.value, -1);
  eq('reference: the lowest whole number survives', armed.params.params.MADE_UP_NEG.value, -2147483648);
  eq('reference: a long message is one message', armed.messages.messages.filter((m) => m.text.startsWith('Preflight Fail: a made-up message')).length, 1);
  ok('reference: and is whole', armed.messages.messages.some((m) => m.text.endsWith('and then some more.') && m.text.length > 100));
  eq('reference: armed', armed.status.vehicle.armed, true);
  eq('reference: mode', armed.status.vehicle.mode.name, 'POSCTL');
}

// ------------------------------------------------------------ where the aircraft is
{
  const s = new observer.ObserverState(0);
  const r = new MavlinkReader();
  for (const p of ref.packets) for (const packet of r.push(bytes(p.hex))) s.handle(packet, p.t);
  const hidden = { host: '127.0.0.1', port: 14445, showPlace: false };
  const everything = [
    observer.status(s, 2000, hidden),
    observer.sensors(s, 2000, hidden),
    observer.traffic(s, 2000),
    observer.messages(s, 2000),
    observer.autopilotVersion(s, 2000),
    ...[...s.counts.keys()].map((k) => observer.latest(s, 2000, hidden, k)),
  ];
  const text = JSON.stringify(everything);
  ok('no answer holds the position\'s digits, in any message heard', !/47397|85455|47\.39|8\.545/.test(text), text.match(/.{40}(47397|85455).{20}/)?.[0]);
  ok('a mission item\'s x and y are left out', /left out/.test(String(observer.latest(s, 2000, hidden, 'MISSION_ITEM_INT').fields.x)));
  eq('and its height is given', observer.latest(s, 2000, hidden, 'MISSION_ITEM_INT').fields.z, 20);
  const shown = { ...hidden, showPlace: true };
  eq('allowed: the position is given', observer.latest(s, 2000, shown, 'GLOBAL_POSITION_INT').fields.lat, 473977420);
  // every field MAVLink gives in degrees is on the list, whatever it is called
  const { MAV_MESSAGES } = await import('../lib/mavlink/messages.ts');
  const missed = [];
  for (const m of Object.values(MAV_MESSAGES)) {
    const place = observer.placeFields(m.id);
    for (const f of m.fields) if ((f.units === 'degE7' || /(^|_)(lat|lon|latitude|longitude)(_|$)/i.test(f.name)) && !place.includes(f.name)) missed.push(`${m.name}.${f.name}`);
  }
  eq('every field in degrees of every message is left out', missed.join(), '');
  eq('a message with no position has nothing left out', observer.placeFields(30).length, 0);
}

// ------------------------------------------------------------ kept between two programs
{
  const s = new observer.ObserverState(ref.started);
  const r = new MavlinkReader();
  for (const p of ref.packets) for (const packet of r.push(bytes(p.hex))) s.handle(packet, p.t);
  const back = observer.ObserverState.fromSnapshot(s.toSnapshot(3000));
  const settings = { host: '127.0.0.1', port: 14445, showPlace: true };
  const all = (x) =>
    JSON.stringify([
      observer.status(x, 3000, settings),
      observer.autopilotVersion(x, 3000),
      observer.params(x),
      observer.messages(x, 3000),
      observer.sensors(x, 3000, settings),
      observer.traffic(x, 3000),
      ...[...x.counts.keys()].map((k) => observer.latest(x, 3000, settings, k)),
    ]);
  eq('a snapshot read back answers the same, to the letter', all(back), all(s));
  ok('a number too large for JavaScript is kept whole', observer.autopilotVersion(back, 3000).uid_hex === '0xa1b2c3d4e5f60718');
  ok('"not a number" is kept', String(observer.latest(back, 3000, settings, 'VFR_HUD').fields.climb) === 'NaN');
  let refused = false;
  try {
    observer.ObserverState.fromSnapshot('{"schema":"something else"}');
  } catch {
    refused = true;
  }
  ok('a file that is not a snapshot is refused', refused);
}

// ------------------------------------------------------------ it holds, and cannot send
{
  const source = readFileSync(fileURLToPath(new URL('../lib/observer/state.ts', import.meta.url)), 'utf8');
  ok('the observer\'s state opens nothing and reads no file', !/node:|require\(|fetch\(|WebSocket/.test(source));
  eq('nine tools, the ones the app describes', observer.OBSERVER_TOOL_NAMES.join(), OBSERVER_SERVER.tools.map((t) => t.name).join());
}

console.log(`\nobserver in JavaScript: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
