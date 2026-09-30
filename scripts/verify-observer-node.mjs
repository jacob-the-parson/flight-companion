// Checks for the observer that needs no Python: mcp/observer/server.mjs and its
// listener. No aircraft and no ground station is involved.
//
//   node scripts/verify-observer-node.mjs
//
// The loopback: the server is started as an assistant would start it, this
// script sends it the made-up packets of scripts/fixtures/observer-reference.json
// ON THIS COMPUTER, and a real MCP client asks it what it heard.
//
// This script is the only thing here that sends, and it can only send to
// 127.0.0.1, to a port it asked the system for a moment before. It never uses
// 14445 or 14550: an observer or a ground station may be running on this computer.
import { spawn } from 'node:child_process';
import { createSocket } from 'node:dgram';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MavlinkReader } from '../lib/mavlink/decode.ts';
import { ObserverState } from '../lib/observer/state.ts';
import { OBSERVER_SERVER } from '../lib/assistant/servers.ts';
import { listen, listeningSocket, NEVER, SENDING, settingsFromEnv } from '../mcp/observer/listener.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER = join(ROOT, 'mcp', 'observer', 'server.mjs');
const ONLY_HERE = '127.0.0.1';
const NOT_THESE = [14445, 14550, 14540, 14556, 14557, 14580, 18570];
const ref = JSON.parse(readFileSync(join(ROOT, 'scripts', 'fixtures', 'observer-reference.json'), 'utf8'));

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const bytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/** A port nothing uses: asked of the system, then given back. */
async function freePort() {
  for (;;) {
    const p = await new Promise((resolve) => {
      const s = createSocket('udp4');
      s.bind(0, ONLY_HERE, () => {
        const port = s.address().port;
        s.close(() => resolve(port));
      });
    });
    if (!NOT_THESE.includes(p)) return p;
  }
}

/** The stand-in for QGroundControl's forwarding: the reference's packets, to this computer. */
async function play(port, packets) {
  if (NOT_THESE.includes(port) || port < 1024) throw new Error(`refused: ${port} is not a port for a test`);
  const s = createSocket('udp4');
  for (const p of packets) {
    await new Promise((resolve, reject) => s.send(bytes(p.hex), port, ONLY_HERE, (e) => (e ? reject(e) : resolve())));
  }
  await new Promise((resolve) => s.close(resolve));
}

/** True if this script can take the port for itself: nothing else holds it. */
const canTake = (port) =>
  new Promise((resolve) => {
    const s = createSocket({ type: 'udp4', reuseAddr: false });
    s.once('error', () => resolve(false));
    s.bind({ port, address: ONLY_HERE, exclusive: true }, () => s.close(() => resolve(true)));
  });

const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  try {
    return { isError: !!r.isError, json: JSON.parse(text), text };
  } catch {
    return { isError: !!r.isError, json: null, text };
  }
};
const start = (env) =>
  new StdioClientTransport({
    command: process.execPath,
    args: ['--no-warnings', SERVER],
    cwd: ROOT,
    env: { ...process.env, QGC_FWD_HOST: ONLY_HERE, FC_OBSERVER_PLACE: '', FC_OBSERVER_SNAPSHOT: '', ...env },
    stderr: 'pipe',
  });

// ------------------------------------------------------------ the guard
{
  const s = listeningSocket();
  for (const name of SENDING) {
    let said = '';
    try {
      s[name](new Uint8Array([1, 2, 3]), 9, ONLY_HERE);
    } catch (e) {
      said = e.message;
    }
    eq(`the socket refuses to ${name}`, said, NEVER);
  }
  let put = false;
  try {
    s.send = () => 'sent';
    put = s.send() === 'sent';
  } catch {
    // refused: a module is strict, and the property cannot be written
  }
  ok('sending cannot be put back by assigning it', !put);
  let redefined = false;
  try {
    Object.defineProperty(s, 'send', { value: () => 'sent' });
    redefined = true;
  } catch {
    // refused
  }
  ok('nor by defining it again', !redefined);
  s.close();
}
{
  // the source: only one place makes a socket, and nothing goes round the guard
  const sources = {
    'mcp/observer/listener.ts': readFileSync(join(ROOT, 'mcp', 'observer', 'listener.ts'), 'utf8'),
    'mcp/observer/server.mjs': readFileSync(SERVER, 'utf8'),
    'lib/observer/state.ts': readFileSync(join(ROOT, 'lib', 'observer', 'state.ts'), 'utf8'),
    'lib/mavlink/decode.ts': readFileSync(join(ROOT, 'lib', 'mavlink', 'decode.ts'), 'utf8'),
  };
  const code = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
  eq('source: one socket is made, in the listener', Object.values(sources).map((t) => code(t).split('createSocket(').length - 1).join(), '1,0,0,0');
  for (const [name, text] of Object.entries(sources)) {
    const c = code(text);
    ok(`source ${name}: calls nothing that sends`, !/\.(send|sendto|write|connect)\(/.test(c.replace(/\.connect\(new StdioServerTransport\(\)\)/, '')), c.match(/.{30}\.(send|sendto|write|connect)\(.{20}/)?.[0]);
    ok(`source ${name}: does not reach for the socket's own methods`, !/prototype|Reflect\.|node:net|node:http|node:tls|fetch\(|WebSocket|child_process/.test(c));
  }
  ok('source: the listener refuses before it binds', sources['mcp/observer/listener.ts'].indexOf('Object.defineProperty(socket, name') < sources['mcp/observer/listener.ts'].indexOf('s.bind('));
  ok('source: names nothing of the project it came from', !Object.values(sources).some((t) => /build-log|HANDOFF|notes\.txt|D-\d\d/.test(t)));
  eq('settings: this computer only, the usual port, no place', JSON.stringify(settingsFromEnv({})), JSON.stringify({ host: '127.0.0.1', port: 14445, showPlace: false }));
  eq('settings: place needs exactly 1', settingsFromEnv({ FC_OBSERVER_PLACE: 'yes' }).showPlace, false);
  eq('settings: a port that is not one falls back', settingsFromEnv({ QGC_FWD_PORT: 'abc' }).port, 14445);
  for (const f of ['mcp.example.windows.json', 'mcp.example.mac.json', 'mcp.example.node.json']) {
    let cfg = null;
    try {
      cfg = JSON.parse(readFileSync(join(ROOT, 'mcp', 'observer', f), 'utf8'));
    } catch {
      /* reported below */
    }
    ok(`${f}: parses, under the name the app gives the server`, Object.keys(cfg?.mcpServers ?? {}).join() === OBSERVER_SERVER.name);
    ok(`${f}: holds no path of anybody's computer`, !/Users|home\/|[A-Z]:\\/.test(JSON.stringify(cfg)));
  }
  const node = JSON.parse(readFileSync(join(ROOT, 'mcp', 'observer', 'mcp.example.node.json'), 'utf8')).mcpServers[OBSERVER_SERVER.name];
  ok('mcp.example.node.json: starts the server with Node', node.command === 'node' && node.args.at(-1) === 'mcp/observer/server.mjs', JSON.stringify(node));
}

// ------------------------------------------------------------ the listener, in this program
{
  const port = await freePort();
  const a = listen({ host: ONLY_HERE, port, showPlace: false }, { retryMs: 150 });
  await wait(150);
  ok('listener: holds the port', a.bound() && !(await canTake(port)));
  await play(port, ref.packets);
  await wait(300);
  eq('listener: every packet of the session arrived', [...a.state.counts.values()].reduce((x, y) => x + y, 0) + a.state.fromGroundStation, ref.packets.length);
  eq('listener: the bytes were counted', a.state.bytesSeen, ref.packets.reduce((n, p) => n + p.hex.length / 2, 0));
  eq('listener: no error', a.state.errors.length, 0);

  // bytes that are no packet, and a packet cut short: no harm, and the next packet is still read
  const s = createSocket('udp4');
  const send = (b) => new Promise((resolve) => s.send(b, port, ONLY_HERE, resolve));
  const before = a.state.counts.get('HEARTBEAT');
  await send(new Uint8Array(300).fill(0xfd));
  await send(bytes(ref.packets[2].hex).subarray(0, 9));
  await send(bytes(ref.packets[2].hex));
  await wait(200);
  eq('listener: after rubbish and half a packet, the next packet is read', a.state.counts.get('HEARTBEAT'), before + 1);
  await new Promise((resolve) => s.close(resolve));

  // a second listener on the same port is told, and takes over when the first stops
  const b = listen({ host: ONLY_HERE, port, showPlace: false }, { retryMs: 150 });
  await wait(300);
  ok('a second listener does not get the port', !b.bound());
  ok('and says why', /already held by another program/.test(b.state.errors.at(-1)?.error ?? ''), JSON.stringify(b.state.errors.at(-1)));
  await a.stop();
  await wait(500);
  ok('and gets it once the first has stopped', b.bound());
  await b.stop();
  await wait(100);
  ok('stopped: the port is free again', await canTake(port));
}

// ------------------------------------------------------------ the server, as an assistant starts it
for (const place of [false, true]) {
  const port = await freePort();
  const transport = start({ QGC_FWD_PORT: String(port), FC_OBSERVER_PLACE: place ? '1' : '' });
  const client = new Client({ name: 'verify-observer-node', version: '1.0.0' });
  const tag = place ? 'server, place allowed' : 'server';
  try {
    await client.connect(transport);
    if (!place) {
      eq(`${tag}: its name`, client.getServerVersion()?.name, 'flight-companion-observer');
      const { tools } = await client.listTools();
      eq(`${tag}: nine tools, the ones the Python observer has`, tools.map((t) => t.name).sort().join(), 'autopilot_version,diff_live_against_file,latest,messages,param,params,sensors,status,traffic');
      eq(`${tag}: the app describes the same ones`, OBSERVER_SERVER.tools.map((t) => t.name).sort().join(), tools.map((t) => t.name).sort().join());
      ok(`${tag}: every tool says what it is for`, tools.every((t) => (t.description ?? '').length > 60));
      ok(`${tag}: every tool is marked as reading only`, tools.every((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === false));
      ok(`${tag}: none sends, sets, arms or uploads`, !tools.some((t) => /(^|_)(send|upload|arm|disarm|set|write|command|reboot)(_|$)/.test(t.name)));
      const quiet = await call(client, 'status');
      ok(`${tag}: before anything is sent, it says it hears nothing and how to switch forwarding on`, quiet.json?.vehicle === null && /Enable MAVLink forwarding/.test(quiet.json?.hint ?? ''), quiet.text.slice(0, 200));
      eq(`${tag}: listening on this computer`, quiet.json?.listening_on, `127.0.0.1:${port}`);
      eq(`${tag}: heard by its own port`, quiet.json?.heard_by, 'its own port');
    }
    await wait(300);
    // all but the last three packets: the restart that empties the parameters comes after
    await play(port, ref.packets.slice(0, -3));
    await wait(400);
    const s = await call(client, 'status');
    eq(`${tag}: a vehicle is heard`, s.json?.vehicle?.type, 'MAV_TYPE_QUADROTOR');
    eq(`${tag}: PX4`, s.json?.vehicle?.autopilot, 'MAV_AUTOPILOT_PX4');
    eq(`${tag}: its mode`, s.json?.vehicle?.mode?.name, 'POSCTL');
    eq(`${tag}: armed`, s.json?.vehicle?.armed, true);
    eq(`${tag}: parameters held`, `${s.json?.params_received}/${s.json?.params_expected}`, '9/9');
    ok(`${tag}: no error`, (s.json?.recent_errors ?? []).length === 0, JSON.stringify(s.json?.recent_errors));
    eq(`${tag}: a whole-number parameter`, (await call(client, 'param', { name: 'SYS_AUTOSTART' })).json?.value, 4019);
    eq(`${tag}: one that is -1`, (await call(client, 'param', { name: 'BAT1_R_INTERNAL_' })).json?.value, -1);
    eq(`${tag}: parameters by prefix`, Object.keys((await call(client, 'params', { prefix: 'bat' })).json?.params ?? {}).join(), 'BAT1_N_CELLS,BAT1_R_INTERNAL_,BAT_LOW_THR');
    ok(`${tag}: a parameter that is not held is said not to be`, /not in cache/.test((await call(client, 'param', { name: 'NOT_THERE' })).json?.error ?? ''));
    const m = (await call(client, 'messages', { n: 10, min_severity: 4 })).json;
    ok(`${tag}: a long message from the board, whole`, m?.messages?.some((x) => x.text.endsWith('and then some more.')), JSON.stringify(m).slice(0, 300));
    ok(`${tag}: warnings and worse only`, m?.messages?.every((x) => !/INFO|DEBUG|NOTICE/.test(x.severity)));
    eq(`${tag}: firmware`, (await call(client, 'autopilot_version')).json?.flight_sw_version?.string, '1.16.0');
    ok(`${tag}: traffic`, (await call(client, 'traffic')).json?.messages?.some((x) => x.type === 'ATTITUDE' && x.count === 5));
    const g = (await call(client, 'sensors')).json;
    eq(`${tag}: satellites`, g?.gps?.satellites_visible, 14);
    eq(`${tag}: a sensor that is not healthy`, g?.sys_status?.unhealthy?.join(), 'MAV_SYS_STATUS_SENSOR_GPS');
    const raw = (await call(client, 'latest', { msg_type: 'gps_raw_int' })).json?.fields;
    const item = (await call(client, 'latest', { msg_type: 'MISSION_ITEM_INT' })).json?.fields;
    if (place) {
      ok(`${tag}: the position is given`, Math.abs(g?.gps?.lat - 47.397742) < 1e-6 && Math.abs(g?.gps?.lon - 8.545594) < 1e-6 && raw?.lat === 473977420 && item?.x === 473978420, JSON.stringify(g?.gps));
    } else {
      ok(`${tag}: the position is left out`, !('lat' in (g?.gps ?? {})) && /left out/.test(g?.gps?.place ?? '') && /left out/.test(String(raw?.lat)) && /left out/.test(String(item?.x)), JSON.stringify(g?.gps));
    }

    // the aircraft now against a saved file
    const dir = mkdtempSync(join(tmpdir(), 'fc-observer-'));
    const file = join(dir, 'saved.params');
    writeFileSync(file, ref.params_text);
    const before = readFileSync(file);
    const d = (await call(client, 'diff_live_against_file', { path: file })).json;
    eq(`${tag}: what changed since the file`, Object.keys(d?.changed ?? {}).join(), 'COM_RC_LOSS_T,EKF2_TINY,SYS_AUTOSTART');
    eq(`${tag}: what is only in the file`, d?.only_in_file?.join(), 'ONLY_IN_FILE');
    ok(`${tag}: the file is as it was, and nothing was written beside it`, readFileSync(file).equals(before) && readdirSync(dir).join() === 'saved.params');
    ok(`${tag}: a file that is not there is said not to be`, /not found/.test((await call(client, 'diff_live_against_file', { path: join(dir, 'none.params') })).json?.error ?? ''));
    rmSync(dir, { recursive: true, force: true });

    // what is not a tool's input is refused by the protocol, not run
    const bad = await client.callTool({ name: 'messages', arguments: { n: 'all of them' } }).catch((e) => ({ isError: true, content: [{ text: String(e) }] }));
    ok(`${tag}: an input of the wrong kind is refused`, bad.isError === true);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${tag} stopped: ${e?.message ?? e}`);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
  await wait(200);
  ok(`${tag}: closed, the port is free again`, await canTake(port));
}

// ------------------------------------------------------------ answering from the desktop app's file
{
  const dir = mkdtempSync(join(tmpdir(), 'fc-observer-'));
  const file = join(dir, 'heard.json');
  const port = await freePort();
  const transport = start({ QGC_FWD_PORT: String(port), FC_OBSERVER_SNAPSHOT: file });
  const client = new Client({ name: 'verify-observer-node', version: '1.0.0' });
  try {
    await client.connect(transport);
    const none = (await call(client, 'status')).json;
    ok('from the app\'s file: with no file, it says the app is not listening', none?.vehicle === null && /desktop app is not listening/.test(none?.recent_errors?.at(-1)?.error ?? ''), JSON.stringify(none).slice(0, 300));
    eq('from the app\'s file: says where it hears from', none?.heard_by, 'the desktop app');
    ok('from the app\'s file: it opens no port of its own', await canTake(port));

    const state = new ObserverState(Date.now() / 1000 - 30);
    const reader = new MavlinkReader();
    for (const p of ref.packets.slice(0, -3)) for (const packet of reader.push(bytes(p.hex))) state.handle(packet, Date.now() / 1000);
    writeFileSync(file, state.toSnapshot(Date.now() / 1000));
    const s = (await call(client, 'status')).json;
    eq('from the app\'s file: a vehicle', s?.vehicle?.type, 'MAV_TYPE_QUADROTOR');
    eq('from the app\'s file: receiving', s?.receiving, true);
    eq('from the app\'s file: a parameter', (await call(client, 'param', { name: 'CBRK_IO_SAFETY' })).json?.value, 22027);
    ok('from the app\'s file: the position is left out', /left out/.test(String((await call(client, 'latest', { msg_type: 'HOME_POSITION' })).json?.fields?.latitude)));
    writeFileSync(file, 'not a snapshot');
    const broken = await call(client, 'status');
    ok('from the app\'s file: a file that is not one is an error, not an answer', broken.isError && /failed/.test(broken.json?.error ?? ''));
  } catch (e) {
    failed++;
    console.log(`  FAIL from the app's file, stopped: ${e?.message ?? e}`);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------ for a person: --watch
{
  const port = await freePort();
  const child = spawn(process.execPath, ['--no-warnings', SERVER, '--watch'], { cwd: ROOT, env: { ...process.env, QGC_FWD_PORT: String(port), QGC_FWD_HOST: ONLY_HERE, FC_OBSERVER_SNAPSHOT: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  await wait(700);
  await play(port, ref.packets.slice(0, -3));
  await wait(2600);
  child.kill();
  ok('--watch: says where it listens', out.includes(`listening on 127.0.0.1:${port}`), out.slice(0, 200));
  ok('--watch: prints what it hears', /rx=true types=\d+ params=9\/9 vehicle=MAV_TYPE_QUADROTOR MAV_AUTOPILOT_PX4 mode=POSCTL armed=true/.test(out), out.slice(-300));
}

// the stand-in refuses a port an observer or a ground station may hold
for (const p of [14445, 14550]) {
  let refused = false;
  try {
    await play(p, []);
  } catch {
    refused = true;
  }
  ok(`the stand-in refuses port ${p}`, refused);
}

console.log(`\nobserver on Node: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
