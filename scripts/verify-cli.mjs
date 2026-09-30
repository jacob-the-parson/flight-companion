// Checks for the command-line tool, bin/fc.mjs: every command answers with one
// JSON document that names its schema, and a refusal is JSON too.
//
//   node scripts/verify-cli.mjs [--logs <dir>] [--params <dir>]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const FC = fileURLToPath(new URL('../bin/fc.mjs', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'fc-cli-'));

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

function fc(...args) {
  const r = spawnSync(process.execPath, ['--no-warnings', FC, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const parse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };
  return { code: r.status, out: parse(r.stdout), err: parse(r.stderr), raw: r.stdout, rawErr: r.stderr };
}

try {
  // ---------------------------------------------------------- help and formats
  const help = fc('help');
  eq('help: exit code', help.code, 0);
  eq('help: schema', help.out?.schema, 'flight-companion/cli-help@1');
  eq('no command is help', fc().out?.schema, 'flight-companion/cli-help@1');
  const formats = fc('formats').out;
  eq('formats: eight for missions, four for parameters', `${formats?.missions.length} ${formats?.parameters.length}`, '8 4');
  ok('formats: each names where its definition was taken from', [...(formats?.missions ?? []), ...(formats?.parameters ?? [])].every((f) => f.source.length > 3));

  // ---------------------------------------------------------- the examples, written and read back
  const written = fc('samples-write', join(work, 'examples'));
  eq('samples-write: exit code', written.code, 0);
  ok('samples-write: more than sixty files', written.out?.files > 60, String(written.out?.files));
  ok('samples-write: says what it could not write, and why', written.out?.skipped.every((s) => s.why.length > 10));
  ok('samples-write: a README that says what the files are', readFileSync(join(work, 'examples', 'README.md'), 'utf8').includes('None is a recording of a real flight'));
  const samples = fc('samples').out;
  eq('samples: six missions and four parameter sets', `${samples?.missions.length} ${samples?.parameter_sets.length}`, '6 4');

  const dir = join(work, 'examples', 'missions', 'inspection');
  for (const f of readdirSync(dir)) {
    const m = fc('mission', join(dir, f));
    eq(`mission ${f}: exit code`, m.code, 0);
    eq(`mission ${f}: schema`, m.out?.schema, 'flight-companion/mission-brief@1');
    eq(`mission ${f}: four waypoints`, m.out?.mission.summary.waypoints, 4);
  }
  const brief = fc('mission', join(dir, 'inspection.plan')).out;
  ok('mission: every item is said in words', brief?.mission.items.every((i) => i.in_words.length > 3));
  ok('mission: every format says what it would drop', brief?.formats.length === 8 && brief.formats.every((f) => f.can_be_written === false || Array.isArray(f.would_be_dropped)));
  ok('mission: units are in the names', 'length_m' in (brief?.mission.summary ?? {}) && 'latitude_deg' in (brief?.mission.items[2] ?? {}));

  const check = fc('mission-check', join(work, 'examples', 'missions', 'no-heights', 'no-heights.fpl'));
  eq('mission-check: a route with no heights says stop', check.out?.checks[0].level, 'critical');
  eq('mission-check: and points at every waypoint', check.out?.checks[0].item_numbers.join(), '1,2,3,4');

  const target = join(work, 'out', 'route.kmz');
  const conv = fc('mission-convert', join(dir, 'inspection.plan'), '--to', 'dji-wpml', '--dji', 'm30', '--out', target);
  eq('mission-convert: exit code', conv.code, 0);
  ok('mission-convert: the file is there, and is a zip', existsSync(target) && readFileSync(target)[0] === 0x50);
  ok('mission-convert: the report says what was dropped', conv.out?.report.dropped.length > 0);
  eq('mission-convert: and reads back as a route for that aircraft', fc('mission', target).out?.mission.made_for, 'DJI Matrice 30');
  const noDji = fc('mission-convert', join(dir, 'inspection.plan'), '--to', 'dji-wpml', '--out', join(work, 'out', 'x.kmz'));
  ok('mission-convert: a DJI route without an aircraft is refused in words', noDji.code === 1 && noDji.err?.error.includes('Choose the DJI aircraft') && !existsSync(join(work, 'out', 'x.kmz')), noDji.rawErr);
  const noOut = fc('mission-convert', join(dir, 'inspection.plan'), '--to', 'gpx');
  ok('mission-convert: nothing is written without --out', noOut.code === 1 && noOut.err?.error.includes('--out'), noOut.rawErr);

  // ---------------------------------------------------------- parameters
  const pdir = join(work, 'examples', 'parameters');
  const p = fc('params', join(pdir, 'outside', 'outside.params'));
  eq('params: schema', p.out?.schema, 'flight-companion/params@1');
  eq('params: autopilot', p.out?.autopilot, 'px4');
  ok('params: the finding', p.out?.findings.some((f) => f.id === 'outside' && f.parameters.join() === 'BAT_CRIT_THR'));
  const flagged = fc('params', join(pdir, 'wrong-names', 'wrong-names.params'), '--only', 'flagged').out;
  eq('params --only flagged', flagged?.parameters.map((x) => x.name).join(), 'FRAME_CLASS,SERIAL1_PROTOCOL,BATT_MONITOR');
  const found = fc('params', join(pdir, 'defaults', 'defaults.params'), '--find', 'kill').out;
  ok('params --find', found?.parameters_shown >= 1 && found.parameters.every((x) => /kill/i.test(x.name + x.what_it_is)));
  const d = fc('params-diff', join(pdir, 'after-bench', 'after-bench.params'), join(pdir, 'defaults', 'defaults.param')).out;
  eq('params-diff: across two formats, five differ', `${d?.different} ${d?.only_in_first} ${d?.only_in_second}`, '5 0 0');
  eq('params-diff: a row says what the values mean', `${d?.rows.find((r) => r.name === 'BAT1_N_CELLS').in_first_means} / ${d?.rows.find((r) => r.name === 'BAT1_N_CELLS').in_second_means}`, '4S Battery / Unknown');
  const pc = fc('params-convert', join(pdir, 'defaults', 'defaults.param'), '--to', 'qgc-params', '--out', join(work, 'out', 'd.params'));
  eq('params-convert: exit code', pc.code, 0);
  eq('params-convert: the same file as the app writes', readFileSync(join(work, 'out', 'd.params'), 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n'), readFileSync(join(pdir, 'defaults', 'defaults.params'), 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n'));

  const ex = fc('explain', 'gps_1_config', 'FRAME_CLASS', 'NOT_A_THING').out;
  eq('explain: a name in any case', ex?.parameters[0].values['202'], 'GPS 2');
  ok('explain: an ArduPilot name gets no PX4 name offered', ex?.parameters[1].in_the_reference === false && /no table/.test(ex.parameters[1].note) && !/use [A-Z0-9_]{4,}/.test(ex.parameters[1].note));
  ok('explain: an unknown name', ex?.parameters[2].in_the_reference === false && /search/.test(ex.parameters[2].note));
  ok('explain: names the reference and its licence', ex?.reference.firmware === 'PX4 v1.16.0' && ex.reference.licence.includes('CC BY 4.0'));
  const s = fc('search', 'kill', 'switch').out;
  ok('search', s?.found >= 2 && s.parameters.some((x) => x.name === 'RC_MAP_KILL_SW'));

  // ---------------------------------------------------------- refusals are JSON, on standard error, exit 1
  for (const [name, args, expect] of [
    ['a command that does not exist', ['fly'], 'no command'],
    ['a file that does not exist', ['mission', join(work, 'nothing.plan')], 'There is no file'],
    ['a folder', ['params', work], 'is a folder'],
    ['no file named', ['log'], 'Name the file'],
    ['a parameter file given as a mission', ['mission', join(pdir, 'defaults', 'defaults.params')], 'parameter file'],
    ['a mission given as parameters', ['params', join(dir, 'inspection.plan')], 'mission'],
    ['a format that does not exist', ['mission-convert', join(dir, 'inspection.plan'), '--to', 'dxf', '--out', join(work, 'x')], 'Unknown format'],
    ['something that is not a log', ['log', join(dir, 'inspection.plan')], 'could not be read'],
  ]) {
    const r = fc(...args);
    ok(`refusal: ${name}`, r.code === 1 && r.raw === '' && typeof r.err?.error === 'string' && r.err.error.includes(expect), r.rawErr.slice(0, 200));
  }

  // ---------------------------------------------------------- real files, where there are any
  const logs = arg('--logs');
  if (logs && existsSync(logs) && readdirSync(logs).some((f) => f.endsWith('.ulg'))) {
    const file = join(logs, readdirSync(logs).filter((f) => f.endsWith('.ulg')).sort().pop());
    const l = fc('log', file);
    eq('log: exit code', l.code, 0);
    eq('log: schema', l.out?.schema, 'flight-companion/log-brief@1');
    ok('log: findings, each with a level in words', l.out?.findings.length > 0 && l.out.findings.every((f) => ['stop', 'check', 'note', 'good'].includes(f.level_means)));
    ok('log: holds no latitude or longitude unless asked', !/latitude|longitude/.test(l.raw) && typeof l.out?.place === 'string');
    ok('log: holds no series of samples', l.raw.length < 400_000, `${l.raw.length} characters`);
    const lp = fc('log', file, '--with-place');
    ok('log --with-place: the takeoff point, when the log has one', lp.out?.place === l.out?.place || typeof lp.out?.place?.takeoff_latitude_deg === 'number');
  } else {
    skipped += 1;
    console.log('  skipped: a real flight log (no --logs folder)');
  }
  const params = arg('--params');
  if (params && existsSync(params) && readdirSync(params).some((f) => f.endsWith('.params'))) {
    const files = readdirSync(params).filter((f) => f.endsWith('.params')).sort();
    const r = fc('params', join(params, files[files.length - 1]));
    eq('real parameters: exit code', r.code, 0);
    ok('real parameters: nearly all are described', r.out?.parameters.filter((x) => x.what_it_is).length >= r.out?.parameters.length - 3);
    const back = join(work, 'out', 'back.params');
    fc('params-convert', join(params, files[0]), '--to', 'qgc-params', '--out', back);
    eq('real parameters: converted to their own format, byte for byte', Buffer.compare(readFileSync(back), readFileSync(join(params, files[0]))), 0);
  } else {
    skipped += 1;
    console.log('  skipped: real parameter files (no --params folder)');
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\ncommand line: ${passed} checks passed, ${failed} failed${skipped ? `, ${skipped} group(s) skipped` : ''}`);
process.exit(failed ? 1 : 0);
