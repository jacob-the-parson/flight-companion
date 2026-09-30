// Checks for the MCP server in mcp/files/. A real MCP client starts the server
// as an assistant would, over standard input and output, and calls every tool.
//
//   node scripts/verify-mcp.mjs
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { FILES_SERVER } from '../lib/assistant/servers.ts';

const SERVER = fileURLToPath(new URL('../mcp/files/server.mjs', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'fc-mcp-'));

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

const transport = new StdioClientTransport({ command: process.execPath, args: ['--no-warnings', SERVER], cwd: ROOT, stderr: 'pipe' });
let stderr = '';
transport.stderr?.on('data', (c) => (stderr += c.toString()));
const client = new Client({ name: 'verify-mcp', version: '1.0.0' });

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? '';
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* reported by the caller */
  }
  return { isError: !!r.isError, json, text };
};

try {
  await client.connect(transport);
  const info = client.getServerVersion();
  eq('server: name', info?.name, 'flight-companion-files');
  ok('server: offers tools', !!client.getServerCapabilities()?.tools);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  eq('tools: thirteen', tools.length, 13);
  eq('tools: the app describes the same ones', FILES_SERVER.tools.map((t) => t.name).sort().join(), names.join());
  eq('tools: and the same three as writing', FILES_SERVER.tools.filter((t) => t.writes).map((t) => t.name).sort().join(), 'convert_mission,convert_parameters,write_examples');
  eq('tools: under the name the app gives the server', info?.name === 'flight-companion-files' && FILES_SERVER.name, 'flight-companion');
  eq(
    'tools: names',
    names.join(),
    'check_mission,compare_parameters,convert_mission,convert_parameters,explain_parameter,list_examples,list_formats,read_flight_log,read_mission,read_parameters,rules,search_parameters,write_examples',
  );
  ok('tools: every one says what it is for, at length', tools.every((t) => (t.description ?? '').length > 60));
  ok('tools: every one has a schema for its inputs', tools.every((t) => t.inputSchema?.type === 'object'));
  const writers = tools.filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name).sort();
  eq('tools: three write, and say so', writers.join(), 'convert_mission,convert_parameters,write_examples');
  ok('tools: the three that write say WRITE in their description', tools.filter((t) => writers.includes(t.name)).every((t) => /WRITE/.test(t.description)));
  ok('tools: none is marked destructive or open to the world', tools.every((t) => t.annotations?.destructiveHint === false && t.annotations?.openWorldHint === false));
  // what must never be offered: the project's first rule
  const forbidden = /(^|_)(send|upload|arm|disarm|set_param|write_param|command|connect|mavlink|serial|takeoff_now|reboot)(_|$)/;
  ok('tools: none sends, uploads, arms, sets or connects', !names.some((n) => forbidden.test(n)), names.filter((n) => forbidden.test(n)).join());

  // the server's source opens nothing
  const source = readFileSync(SERVER, 'utf8') + readFileSync(join(ROOT, 'bin', 'commands.mjs'), 'utf8');
  ok('source: imports no network, serial or process module', !/from 'node:(net|dgram|http|https|http2|tls|child_process|worker_threads)'|serialport|pymavlink|mavlink/i.test(source.replace(/\/\/.*$/gm, '')));

  // ---------------------------------------------------------- the rules
  const rules = await call('rules');
  ok('rules: come back, and name what the tools cannot do', !rules.isError && rules.json?.these_tools_cannot.includes('reach an aircraft') && rules.json.rules.length >= 5);

  // ---------------------------------------------------------- examples, written and read back
  const folder = join(work, 'examples');
  const wrote = await call('write_examples', { folder });
  ok('write_examples: writes', !wrote.isError && wrote.json?.files > 60, wrote.text.slice(0, 200));
  const again = await call('write_examples', { folder });
  ok('write_examples: refuses a folder that exists', again.isError && /already something/.test(again.json?.error ?? ''), again.text.slice(0, 200));

  const plan = join(folder, 'missions', 'inspection', 'inspection.plan');
  const m = await call('read_mission', { path: plan });
  eq('read_mission: schema', m.json?.schema, 'flight-companion/mission-brief@1');
  eq('read_mission: four waypoints', m.json?.mission.summary.waypoints, 4);
  const c = await call('check_mission', { path: join(folder, 'missions', 'no-heights', 'no-heights.gpx') });
  eq('check_mission: a route with no heights says stop', c.json?.checks[0].level, 'critical');

  const out = join(work, 'route.fpl');
  const conv = await call('convert_mission', { path: plan, to: 'garmin-fpl', out });
  ok('convert_mission: writes, and says what was dropped', !conv.isError && existsSync(out) && conv.json?.report.dropped.length > 0);
  const before = readFileSync(out, 'utf8');
  const over = await call('convert_mission', { path: plan, to: 'gpx', out });
  ok('convert_mission: does not write over a file', over.isError && /does not write over/.test(over.json?.error ?? '') && readFileSync(out, 'utf8') === before, over.text.slice(0, 200));
  const dji = await call('convert_mission', { path: plan, to: 'dji-wpml', out: join(work, 'r.kmz') });
  ok('convert_mission: a DJI route with no aircraft is refused, and nothing is written', dji.isError && /Choose the DJI aircraft/.test(dji.json?.error ?? '') && !existsSync(join(work, 'r.kmz')));
  const bad = await client.callTool({ name: 'convert_mission', arguments: { path: plan, to: 'dxf', out: join(work, 'x') } }).catch((e) => ({ isError: true, thrown: e.message }));
  ok('convert_mission: a format that does not exist is refused by the schema', bad.isError === true && !existsSync(join(work, 'x')));

  const params = join(folder, 'parameters', 'outside', 'outside.params');
  const p = await call('read_parameters', { path: params });
  ok('read_parameters: with no filter, the summary and findings and no list', !p.isError && p.json?.parameters.length === 0 && p.json.summary.parameters > 100 && /find/.test(p.json.how_to_see_parameters));
  ok('read_parameters: the finding', p.json?.findings.some((f) => f.id === 'outside' && f.parameters.join() === 'BAT_CRIT_THR'));
  ok('read_parameters: a thousand parameters would not fit an assistant, so the answer is small', p.text.length < 20_000, `${p.text.length} characters`);
  const pf = await call('read_parameters', { path: params, find: 'BAT_CRIT' });
  eq('read_parameters: find', pf.json?.parameters.map((x) => `${x.name}=${x.value} ${x.unit} outside=${x.outside_limits}`).join(), 'BAT_CRIT_THR=20 norm outside=true');
  const po = await call('read_parameters', { path: join(folder, 'parameters', 'wrong-names', 'wrong-names.params'), only: 'flagged' });
  eq('read_parameters: only flagged', po.json?.parameters.map((x) => x.name).join(), 'FRAME_CLASS,SERIAL1_PROTOCOL,BATT_MONITOR');

  const d = await call('compare_parameters', { path: join(folder, 'parameters', 'after-bench', 'after-bench.params'), other: join(folder, 'parameters', 'defaults', 'defaults.params') });
  eq('compare_parameters: five differ', d.json?.different, 5);
  ok('compare_parameters: each row says what the parameter is', d.json?.rows.every((r) => typeof r.what_it_is === 'string'));

  const pc = await call('convert_parameters', { path: params, to: 'mp-param', out: join(work, 'p.param') });
  ok('convert_parameters: writes, and says these are still PX4 parameters', !pc.isError && pc.json?.report.warnings.some((w) => /does not make them ArduPilot/.test(w)));
  ok('convert_parameters: does not write over a file', (await call('convert_parameters', { path: params, to: 'mp-param', out: join(work, 'p.param') })).isError);

  const e = await call('explain_parameter', { names: ['COM_KILL_DISARM', 'FRAME_CLASS'] });
  eq('explain_parameter: PX4\'s words', e.json?.parameters[0].what_it_is, 'Timeout value for disarming when kill switch is engaged.');
  ok('explain_parameter: an ArduPilot name gets no PX4 name offered', e.json?.parameters[1].in_the_reference === false && /no table/.test(e.json.parameters[1].note));
  const s = await call('search_parameters', { text: 'kill switch' });
  ok('search_parameters', s.json?.parameters.some((x) => x.name === 'RC_MAP_KILL_SW'));
  eq('list_formats', (await call('list_formats')).json?.missions.length, 8);
  eq('list_examples', (await call('list_examples')).json?.missions.length, 6);

  // ---------------------------------------------------------- refusals are answers, not crashes
  for (const [name, tool, args, expect] of [
    ['a file that is not there', 'read_mission', { path: join(work, 'nothing.plan') }, 'There is no file'],
    ['a parameter file given as a mission', 'read_mission', { path: params }, 'parameter file'],
    ['a mission given as a log', 'read_flight_log', { path: plan }, 'could not be read'],
    ['a folder', 'read_parameters', { path: work }, 'is a folder'],
  ]) {
    const r = await call(tool, args);
    ok(`refusal: ${name}`, r.isError && typeof r.json?.error === 'string' && r.json.error.includes(expect), r.text.slice(0, 200));
  }
  ok('after every refusal the server still answers', !(await call('list_formats')).isError);

  // ---------------------------------------------------------- a real log, where there is one
  const logs = join(ROOT, '..', 'logs');
  if (existsSync(logs) && readdirSync(logs).some((f) => f.endsWith('.ulg'))) {
    const file = join(logs, readdirSync(logs).filter((f) => f.endsWith('.ulg')).sort().pop());
    const l = await call('read_flight_log', { path: file });
    eq('read_flight_log: schema', l.json?.schema, 'flight-companion/log-brief@1');
    ok('read_flight_log: no latitude or longitude unless asked', !/latitude|longitude/.test(l.text));
    ok('read_flight_log: small enough to read', l.text.length < 120_000, `${l.text.length} characters`);
  } else {
    console.log('  skipped: a real flight log (no ../logs folder)');
  }

  // the configuration a user copies must itself be valid
  const example = JSON.parse(readFileSync(join(ROOT, 'mcp', 'files', 'mcp.example.json'), 'utf8'));
  ok('mcp.example.json: parses, and starts this server', example.mcpServers?.['flight-companion']?.args?.some((a) => a.endsWith('mcp/files/server.mjs')));
  writeFileSync(join(work, 'done'), '');

  await client.close();
  ok('the server printed nothing but the protocol', !/Error|Unhandled/i.test(stderr), stderr.slice(0, 300));
} catch (e) {
  failed++;
  console.log(`  FAIL the check itself stopped: ${e?.stack ?? e}`);
  if (stderr) console.log(`  the server said: ${stderr.slice(0, 500)}`);
} finally {
  await transport.close().catch(() => undefined);
  rmSync(work, { recursive: true, force: true });
}

console.log(`\nMCP files server: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
