// Checks for the MAVLink reader, against pymavlink, the MAVLink project's own
// library. scripts/fixtures/mavlink-reference.json holds what pymavlink knows of
// every message's layout, and packets it built with what it read back from them.
// This script needs no Python; scripts/mavlink_reference.py writes the reference.
//
//   node scripts/verify-mavlink.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { crcOf, enumName, flagNames, MavlinkReader } from '../lib/mavlink/decode.ts';
import { MAV_ENUMS, MAV_MESSAGE_ID, MAV_MESSAGES, MAVLINK_REVISION } from '../lib/mavlink/messages.ts';

const ref = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/mavlink-reference.json', import.meta.url)), 'utf8'));

let passed = 0;
let failed = 0;
const shown = new Map();
const ok = (name, cond, detail = '') => {
  if (cond) passed++;
  else {
    failed++;
    // a fault in one message is a fault in many packets: show each kind a few times
    const kind = name.replace(/^[A-Z0-9_]+ /, '');
    shown.set(kind, (shown.get(kind) ?? 0) + 1);
    if (shown.get(kind) <= 4) console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`);
  }
};
const eq = (name, got, want) => ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/** A value the reader gave, as the reference writes values. */
function plain(v) {
  if (typeof v === 'bigint') return v > 2n ** 53n || v < -(2n ** 53n) ? v.toString() : Number(v);
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : v === Infinity ? 'Infinity' : v === -Infinity ? '-Infinity' : v;
  if (Array.isArray(v)) return v.map(plain);
  return v;
}
const plainAll = (fields) => Object.fromEntries(Object.entries(fields ?? {}).map(([k, v]) => [k, plain(v)]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------ the table against pymavlink's
console.log(`  the table is from MAVLink revision ${MAVLINK_REVISION}; the reference from pymavlink ${ref.pymavlink}`);
const mine = new Set(Object.keys(MAV_MESSAGES).map(Number));
const theirs = new Set(ref.layouts.map((l) => l.id));
const onlyTheirs = ref.layouts.filter((l) => !mine.has(l.id)).map((l) => l.name);
const onlyMine = [...mine].filter((id) => !theirs.has(id)).map((id) => MAV_MESSAGES[id].name);
ok('every message pymavlink has is in the table', onlyTheirs.length === 0, onlyTheirs.join());
if (onlyMine.length > 0) console.log(`  note: ${onlyMine.length} messages are in MAVLink's definitions and not in pymavlink ${ref.pymavlink}, which is older: ${onlyMine.slice(0, 6).join(', ')}${onlyMine.length > 6 ? ', ...' : ''}. They are not checked.`);

let newer = 0;
for (const l of ref.layouts) {
  const m = MAV_MESSAGES[l.id];
  if (!m) continue;
  eq(`${l.name} name`, m.name, l.name);
  eq(`${l.name} CRC_EXTRA`, m.crcExtra, l.crc_extra);
  // MAVLink adds extension fields to a message over time; a newer definition has all the older one's and more
  const shared = m.fields.filter((f) => l.declared.includes(f.name));
  const added = m.fields.filter((f) => !l.declared.includes(f.name));
  if (added.length > 0) newer += 1;
  ok(`${l.name} what was added since is extension fields, at the end`, added.every((f) => f.ext) && m.fields.slice(0, shared.length).every((f) => l.declared.includes(f.name)), added.map((f) => f.name).join());
  eq(`${l.name} order on the wire`, shared.map((f) => f.name).join(), l.wire.join());
  eq(`${l.name} order as written`, m.declared.filter((n) => l.declared.includes(n)).join(), l.declared.join());
  eq(`${l.name} types`, shared.map((f) => `${f.type}${f.length ? `[${f.length}]` : ''}`).join(), l.wire.map((n) => `${l.types[n]}${l.lengths[n] ? `[${l.lengths[n]}]` : ''}`).join());
  if (added.length === 0) eq(`${l.name} payload length`, m.length, l.payload_bytes);
}
console.log(`  note: ${newer} messages have extension fields that pymavlink ${ref.pymavlink} does not know. For those, what pymavlink reads is compared, and what it cannot read must be zero.`);

// ------------------------------------------------------------ every packet, every field
let fields = 0;
const kinds = new Set();
for (const p of ref.packets) {
  const reader = new MavlinkReader();
  const got = reader.push(bytes(p.hex));
  const tag = `${p.name} v${p.version} ${p.how}`;
  if (got.length !== 1) {
    ok(`${tag} is read as one packet`, false, `${got.length} packets, ${JSON.stringify(reader.stats)}`);
    continue;
  }
  const g = got[0];
  ok(`${tag} header`, g.name === p.name && g.id === p.id && g.version === p.version && g.system === p.system && g.component === p.component && g.seq === p.seq, JSON.stringify({ ...g, fields: undefined }));
  for (const [name, want] of Object.entries(p.fields)) {
    fields += 1;
    const have = plain(g.fields[name]);
    ok(`${p.name} ${name} (v${p.version}, ${p.how})`, same(have, want), `got ${JSON.stringify(have)}, want ${JSON.stringify(want)}`);
  }
  // fields pymavlink does not know: nothing was sent for them, so they are zero
  for (const [name, v] of Object.entries(g.fields)) {
    if (name in p.fields) continue;
    const zero = Array.isArray(v) ? v.every((x) => Number(x) === 0) : v === '' || Number(v) === 0;
    ok(`${p.name} ${name}, which was not sent, is zero`, zero, JSON.stringify(plain(v)));
  }
  kinds.add(p.name);
}
eq('every message pymavlink has was read at least once', kinds.size, ref.layouts.length);
console.log(`  ${ref.packets.length} packets of ${kinds.size} messages, ${fields} fields compared`);

// ------------------------------------------------------------ signed, damaged, and a stream
for (const p of ref.signed) {
  const got = new MavlinkReader().push(bytes(p.hex));
  ok(`${p.name} signed: read, and marked as signed`, got.length === 1 && got[0].signed && Object.entries(p.fields).every(([k, v]) => same(plain(got[0].fields[k]), v)), JSON.stringify(plainAll(got[0]?.fields)).slice(0, 200));
}
for (const p of ref.damaged) {
  const reader = new MavlinkReader();
  const got = reader.push(bytes(p.hex));
  ok(`${p.name} with one bit changed is not read as that message`, !got.some((g) => g.name === p.name), JSON.stringify(got.map((g) => g.name)));
}
ok('damaged packets were tried', ref.damaged.length >= 40, String(ref.damaged.length));
{
  const whole = bytes(ref.stream.hex);
  const all = new MavlinkReader();
  const names = all.push(whole).map((g) => g.name);
  // bytes that are no packet may, by chance, look like the start of one; the checksum settles it
  eq('a stream: every packet found, in order, none made up', names.join(), ref.stream.names.join());
  // the same stream a few bytes at a time, as a network gives it
  for (const step of [1, 7, 64, 1500]) {
    const r = new MavlinkReader();
    const got = [];
    for (let i = 0; i < whole.length; i += step) got.push(...r.push(whole.subarray(i, i + step)));
    eq(`a stream ${step} byte(s) at a time`, got.map((g) => g.name).join(), ref.stream.names.join());
  }
}
{
  const r = new MavlinkReader();
  eq('bytes that are no packet give none', r.push(new Uint8Array(5000).fill(0x55)).length, 0);
  ok('and are not kept for ever', r.push(new Uint8Array(10)).length === 0);
  const half = bytes(ref.packets.find((p) => p.name === 'HEARTBEAT' && p.version === 2 && p.how === 'any').hex);
  const r2 = new MavlinkReader();
  ok('half a packet is waited for', r2.push(half.subarray(0, 8)).length === 0 && r2.push(half.subarray(8)).length === 1);
}

// ------------------------------------------------------------ names and flags
eq('enum: a vehicle type', enumName('MAV_TYPE', 2), 'MAV_TYPE_QUADROTOR');
eq('enum: an autopilot', enumName('MAV_AUTOPILOT', 12), 'MAV_AUTOPILOT_PX4');
eq('enum: a value that is not there', enumName('MAV_TYPE', 9999, 'none'), 'none');
eq('flags: armed', flagNames('MAV_MODE_FLAG', 128 + 64).sort().join(), 'MAV_MODE_FLAG_MANUAL_INPUT_ENABLED,MAV_MODE_FLAG_SAFETY_ARMED');
eq('flags: none', flagNames('MAV_MODE_FLAG', 0).length, 0);
ok('the commands are not in this table; they have their own', !('MAV_CMD' in MAV_ENUMS));
eq('a message by name', MAV_MESSAGE_ID.HEARTBEAT, 0);
{
  // the published check value of CRC-16/MCRF4XX: the text "123456789" gives 0x6F91
  const text = new TextEncoder().encode('123456789');
  eq('the checksum is CRC-16/MCRF4XX', crcOf(text, 0, 8, text[8]), 0x6f91);
}

// ------------------------------------------------------------ it reads, and cannot write
{
  const source = readFileSync(fileURLToPath(new URL('../lib/mavlink/decode.ts', import.meta.url)), 'utf8');
  ok('the reader has no function that makes a packet', !/export (function|class) \w*(encode|pack|serialize|write|send)\w*/i.test(source) && !/setUint8|setUint16|setUint32|setFloat32|setBig/.test(source));
  ok('and opens nothing', !/node:(dgram|net|http)|WebSocket|fetch\(/.test(source));
}

const left = [...shown].filter(([, n]) => n > 4);
for (const [kind, n] of left) console.log(`  ... and ${n - 4} more of: ${kind}`);
console.log(`\nMAVLink reader: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
