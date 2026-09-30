// Checks for the observer in mcp/observer/. It is Python, so these run only
// where a Python with its packages is found:
//   the FC_OBSERVER_PYTHON environment variable, else
//   mcp/observer/.venv, else
//   ../tools/qgc-readonly-mcp/.venv (this project's own, where that exists).
// Without one the checks are skipped, and the script says so.
//
//   node scripts/verify-observer.mjs
//
// Two parts. The observer's own self-test, which needs nothing. And a loopback:
// the observer is started as an assistant would start it, a stand-in for
// QGroundControl sends it a few made-up messages on this computer, and a real
// MCP client asks it what it heard. No aircraft is involved in either.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createSocket } from 'node:dgram';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { OBSERVER_SERVER } from '../lib/assistant/servers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'mcp', 'observer');
const candidates = [
  process.env.FC_OBSERVER_PYTHON,
  join(DIR, '.venv', 'Scripts', 'python.exe'),
  join(DIR, '.venv', 'bin', 'python'),
  join(ROOT, '..', 'tools', 'qgc-readonly-mcp', '.venv', 'Scripts', 'python.exe'),
  join(ROOT, '..', 'tools', 'qgc-readonly-mcp', '.venv', 'bin', 'python'),
].filter(Boolean);
const python = candidates.find((p) => existsSync(p) && spawnSync(p, ['-c', 'import pymavlink, mcp'], { encoding: 'utf8' }).status === 0);

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

// what can be checked with no Python: the files a user copies, and the source's guard
{
  for (const f of ['mcp.example.windows.json', 'mcp.example.mac.json']) {
    let cfg = null;
    try {
      cfg = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
    } catch {
      /* reported below */
    }
    const entry = cfg?.mcpServers?.['flight-companion-observer'];
    ok(`${f}: under the name the app gives the server`, Object.keys(cfg?.mcpServers ?? {}).join() === OBSERVER_SERVER.name);
    ok(`${f}: parses, and starts the observer`, !!entry && entry.args?.[0] === 'mcp/observer/server.py' && /python/.test(entry.command), JSON.stringify(entry));
    ok(`${f}: holds no path of anybody's computer`, !/Users|home\/|[A-Z]:\\/.test(JSON.stringify(cfg)));
  }
  const source = readFileSync(join(DIR, 'server.py'), 'utf8');
  eq('source: the connection\'s write is replaced', source.split('conn.write = _forbidden').length - 1, 1);
  eq('source: the socket is wrapped', source.split('conn.port = _RxOnlySocket(conn.port)').length - 1, 1);
  ok('source: listens on this computer unless told otherwise', source.includes('os.environ.get("QGC_FWD_HOST", "127.0.0.1")'));
  ok('source: opens no way out', !/udpout|tcp:|serial\.|\.sendto\(|mav\.mav\./.test(source));
  ok('source: names nothing of the project it came from', !/build-log|HANDOFF|notes\.txt|D-\d\d/.test(source));
  const sender = readFileSync(join(DIR, 'loopback_sender.py'), 'utf8');
  ok('the test sender can only reach this computer', sender.includes('ONLY_HERE = "127.0.0.1"') && sender.split('udpout:').length - 1 === 1 && sender.includes('udpout:{ONLY_HERE}'));
}

if (!python) {
  console.log('  skipped: the self-test and the loopback (no Python with pymavlink and mcp was found; see mcp/observer/README.md)');
  console.log(`\nobserver: ${passed} checks passed, ${failed} failed, 1 group(s) skipped`);
  process.exit(failed ? 1 : 0);
}

// ------------------------------------------------------------ the self-test
{
  const r = spawnSync(python, [join(DIR, 'selftest.py')], { encoding: 'utf8', cwd: ROOT });
  const last = r.stdout.trim().split(/\r?\n/).pop() ?? '';
  ok('self-test: every check passes', r.status === 0 && /^\d+ passed, 0 failed$/.test(last), last || r.stderr.slice(-300));
  ok('self-test: forty-three checks', /^43 passed/.test(last), last);
  for (const line of r.stdout.split(/\r?\n/).filter((l) => l.includes('FAIL'))) console.log(`  ${line.trim()}`);
}

// ------------------------------------------------------------ the loopback
// a port nothing else uses: asked of the system, then given back
const port = await new Promise((resolve) => {
  const s = createSocket('udp4');
  s.bind(0, '127.0.0.1', () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const start = (place) =>
  new StdioClientTransport({
    command: python,
    args: [join(DIR, 'server.py')],
    cwd: ROOT,
    env: { ...process.env, QGC_FWD_PORT: String(port), QGC_FWD_HOST: '127.0.0.1', FC_OBSERVER_PLACE: place ? '1' : '' },
    stderr: 'pipe',
  });
const call = async (client, name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  try {
    return { isError: !!r.isError, json: JSON.parse(text), text };
  } catch {
    return { isError: !!r.isError, json: r.structuredContent ?? null, text };
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

for (const place of [false, true]) {
  const transport = start(place);
  const client = new Client({ name: 'verify-observer', version: '1.0.0' });
  const tag = place ? 'loopback, place allowed' : 'loopback';
  try {
    await client.connect(transport);
    if (!place) {
      eq(`${tag}: server name`, client.getServerVersion()?.name, 'flight-companion-observer');
      const { tools } = await client.listTools();
      eq(`${tag}: nine tools`, tools.map((t) => t.name).sort().join(), 'autopilot_version,diff_live_against_file,latest,messages,param,params,sensors,status,traffic');
      eq(`${tag}: the app describes the same ones`, OBSERVER_SERVER.tools.map((t) => t.name).sort().join(), tools.map((t) => t.name).sort().join());
      ok(`${tag}: every tool says what it is for`, tools.every((t) => (t.description ?? '').length > 30));
      ok(`${tag}: none sends, sets, arms or uploads`, !tools.some((t) => /(^|_)(send|upload|arm|disarm|set|write|command|reboot)(_|$)/.test(t.name)));
      const quiet = await call(client, 'status');
      ok(`${tag}: before anything is sent, it says it hears nothing and how to switch forwarding on`, quiet.json?.vehicle === null && /Enable MAVLink forwarding/.test(quiet.json?.hint ?? ''), quiet.text.slice(0, 200));
      eq(`${tag}: listening on this computer`, quiet.json?.listening_on, `127.0.0.1:${port}`);
    }
    await wait(600);
    const sent = spawnSync(python, [join(DIR, 'loopback_sender.py'), String(port)], { encoding: 'utf8' });
    ok(`${tag}: the stand-in sent`, sent.status === 0, sent.stderr.slice(-200));
    await wait(700);
    const s = await call(client, 'status');
    eq(`${tag}: a vehicle is heard`, s.json?.vehicle?.type, 'MAV_TYPE_QUADROTOR');
    eq(`${tag}: its mode`, s.json?.vehicle?.mode?.name, 'AUTO:LOITER');
    eq(`${tag}: disarmed`, s.json?.vehicle?.armed, false);
    ok(`${tag}: no error`, (s.json?.recent_errors ?? []).length === 0, JSON.stringify(s.json?.recent_errors));
    eq(`${tag}: a whole-number parameter`, (await call(client, 'param', { name: 'SYS_AUTOSTART' })).json?.value, 4019);
    ok(`${tag}: a message from the board`, (await call(client, 'messages', { n: 3 })).json?.messages?.some((m) => m.text === 'loopback test'));
    const g = (await call(client, 'sensors')).json?.gps;
    eq(`${tag}: satellites`, g?.satellites_visible, 14);
    const raw = (await call(client, 'latest', { msg_type: 'GPS_RAW_INT' })).json?.fields;
    if (place) {
      ok(`${tag}: the position is given`, Math.abs(g?.lat - 47.397742) < 1e-6 && Math.abs(g?.lon - 8.545594) < 1e-6 && raw?.lat === 473977420, JSON.stringify(g));
    } else {
      ok(`${tag}: the position is left out`, !('lat' in (g ?? {})) && /left out/.test(g?.place ?? '') && /left out/.test(String(raw?.lat)), JSON.stringify(g));
    }
  } catch (e) {
    failed++;
    console.log(`  FAIL ${tag} stopped: ${e?.message ?? e}`);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
  }
}

// a ground station's port is refused by the stand-in
{
  const r = spawnSync(python, [join(DIR, 'loopback_sender.py'), '14550'], { encoding: 'utf8' });
  ok('the stand-in refuses the port a ground station listens on', r.status === 2 && /refused/.test(r.stdout));
}

console.log(`\nobserver: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
