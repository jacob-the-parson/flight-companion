// Checks for the parameter files.
//
//   node scripts/verify-params.mjs [--real <dir>]
//
// --real  a folder of .params files saved by QGroundControl from a real
//         aircraft. Each is read and written back, and must come out the same
//         byte for byte. Without the folder those checks are skipped.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectAutopilot, diffSets, findingsOf, flagsOf, looksLikeArduPilot, valueMeaning } from '../lib/params/analysis.ts';
import { detectParamFormat, PARAM_FORMATS, readParams, writeParams } from '../lib/params/codecs.ts';
import { floatText, isEdited, sameValue, valueText } from '../lib/params/model.ts';
import { BENCH_CHANGES, PARAM_SAMPLES } from '../lib/params/samples.ts';

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const real = arg('--real');

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
const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const refuses = (bytes, file) => {
  try {
    readParams(bytes, file, ref);
    return 'read without complaint';
  } catch (e) {
    return e.message;
  }
};

const ref = JSON.parse(readFileSync(new URL('../public/data/px4-v1.16.0-parameters.json', import.meta.url), 'utf8'));

// ------------------------------------------------------------ the reference
{
  eq('reference: schema', ref.schema, 'flight-companion/px4-parameter-reference@1');
  eq('reference: firmware', ref.firmware, 'PX4 v1.16.0');
  ok('reference: names its source and licence', ref.source.includes('PX4-Autopilot/blob/v1.16.0') && ref.licence.includes('CC BY 4.0'));
  eq('reference: count matches', Object.keys(ref.parameters).length, ref.count);
  ok('reference: over two thousand parameters', ref.count > 2000, String(ref.count));
  const p = ref.parameters;
  eq('reference: CBRK_IO_SAFETY default', p.CBRK_IO_SAFETY.default, 22027);
  eq('reference: GPS_1_CONFIG 202 is GPS 2', p.GPS_1_CONFIG.values['202'], 'GPS 2');
  eq('reference: GPS_1_CONFIG needs a restart', p.GPS_1_CONFIG.reboot_required, true);
  eq('reference: BAT_LOW_THR limits', `${p.BAT_LOW_THR.min} ${p.BAT_LOW_THR.max} ${p.BAT_LOW_THR.default}`, '0.12 0.5 0.15');
  eq('reference: COM_KILL_DISARM unit', p.COM_KILL_DISARM.unit, 's');
  eq('reference: a bitmask', p.EKF2_GPS_CTRL.bits['2'], '3D velocity');
  eq('reference: a default with a name', `${p.COM_ARM_CHK_ESCS.default} ${p.COM_ARM_CHK_ESCS.default_means}`, '0 Disabled');
  ok('reference: every parameter has a group, a type and a short description', Object.values(p).every((m) => m.group && (m.type === 'INT32' || m.type === 'FLOAT') && typeof m.short === 'string'));
  ok('reference: no ArduPilot name is in it', !['FRAME_CLASS', 'SERIAL1_PROTOCOL', 'BRD_SAFETY_DEFLT', 'NTF_BUZZ_PIN', 'GPS_AUTO_SWITCH', 'BATT_VOLT_MULT', 'ARMING_CHECK'].some((n) => n in p));
  // the shapes that mark an ArduPilot name must not catch PX4's own
  const caught = Object.keys(p).filter(looksLikeArduPilot);
  console.log(`  note: ${caught.length} PX4 names have the shape of an ArduPilot name (${caught.slice(0, 6).join(', ')}${caught.length > 6 ? ', ...' : ''}); being in the reference, none is ever flagged`);
}

// ------------------------------------------------------------ numbers
{
  eq('same: 0.3 and its REAL32', sameValue(0.3, 0.300000011920929, 9), true);
  eq('same: 5200 and 5.2e+03', sameValue(5200, Number('5.2e+03'), 9), true);
  eq('same: 36.367516 and 36.3675', sameValue(36.367516, 36.3675, 9), false);
  eq('same: whole numbers', sameValue(4, 4.0000001, 6), true);
  eq('same: 0 and 1', sameValue(0, 1, 6), false);
  eq('float text: 0.3', floatText(0.3), '0.3');
  eq('float text: 5200', floatText(5200), '5200');
  eq('float text: -1', floatText(-1), '-1');
  let bad = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 5000; i++) {
    const v = (rnd() - 0.5) * 10 ** Math.floor(rnd() * 12 - 5);
    if (Math.fround(Number(floatText(v))) !== Math.fround(v)) bad += 1;
  }
  eq('float text: 5000 values read back as the same REAL32', bad, 0);
}

// ------------------------------------------------------------ QGroundControl file
const QGC = [
  '# Onboard parameters for Vehicle 1',
  '#',
  '# Stack: PX4 Pro',
  '# Vehicle: Multi-Rotor',
  '# Version: 1.16.0 ',
  '# Git Revision: 0123456789abcdef',
  '#',
  '# Vehicle-Id Component-Id Name Value Type',
  '1\t1\tBAT1_CAPACITY\t5.2e+03\t9',
  '1\t1\tBAT1_N_CELLS\t4\t6',
  '1\t1\tBAT_LOW_THR\t0.30000001192092896\t9',
  '1\t1\tCBRK_IO_SAFETY\t22027\t6',
  '1\t1\tGPS_1_CONFIG\t202\t6',
  '1\t1\tSYS_AUTOSTART\t4019\t6',
  '',
].join('\r\n');
{
  const set = readParams(enc(QGC), 'bench.params', ref);
  eq('qgc: detected', detectParamFormat(enc(QGC), 'x.txt'), 'qgc-params');
  eq('qgc: six parameters', set.entries.length, 6);
  eq('qgc: header fields', `${set.stack}|${set.vehicle}|${set.version}|${set.gitRevision}`, 'PX4 Pro|Multi-Rotor|1.16.0|0123456789abcdef');
  eq('qgc: autopilot from the header', `${set.autopilot} ${set.autopilotFrom}`, 'px4 the file\'s header says "PX4 Pro"');
  eq('qgc: a value in exponent form', set.entries[0].value, 5200);
  eq('qgc: line ending kept', set.eol, '\r\n');
  const back = writeParams(set, 'qgc-params', ref);
  eq('qgc: written back byte for byte', dec(back.data), QGC);
  eq('qgc: file name', back.name, 'bench.params');

  // an edit changes one value and nothing else
  const edited = structuredClone(set);
  edited.entries[2] = { ...edited.entries[2], original: edited.entries[2].value, value: 0.25 };
  edited.entries[1] = { ...edited.entries[1], original: 4, value: 6 };
  ok('edit: marked', isEdited(edited.entries[2]) && isEdited(edited.entries[1]) && !isEdited(edited.entries[0]));
  eq('edit: a decimal is written short', valueText(edited.entries[2]), '0.25');
  const lines = dec(writeParams(edited, 'qgc-params', ref).data).split('\r\n');
  const before = QGC.split('\r\n');
  eq('edit: only two lines differ', lines.filter((l, i) => l !== before[i]).join('|'), '1\t1\tBAT1_N_CELLS\t6\t6|1\t1\tBAT_LOW_THR\t0.25\t9');
  ok('edit: report says so', writeParams(edited, 'qgc-params', ref).report.changed.some((c) => c.startsWith('2 values changed here')));
  // setting a value back to what the file had is not an edit
  const undone = { ...edited.entries[1], value: 4 };
  eq('edit: put back is not an edit', isEdited(undone), false);

  // meanings and flags
  eq('meaning: a listed value', valueMeaning(202, ref.parameters.GPS_1_CONFIG), 'GPS 2');
  eq('meaning: a bitmask', valueMeaning(7, ref.parameters.EKF2_GPS_CTRL), 'Lon/lat + Altitude + 3D velocity');
  eq('meaning: a bitmask of nothing', valueMeaning(0, ref.parameters.EKF2_GPS_CTRL), 'nothing switched on');
  eq('meaning: a plain number has none', valueMeaning(5200, ref.parameters.BAT1_CAPACITY), null);
  // PX4 writes the listed values of a decimal parameter as "1.0" and "-1.0"
  ok('meaning: the reference has decimal keys', '1.0' in ref.parameters.RC1_REV.values, Object.keys(ref.parameters.RC1_REV.values).join());
  eq('meaning: a decimal key', `${valueMeaning(1, ref.parameters.RC1_REV)} ${valueMeaning(-1, ref.parameters.RC1_REV)}`, 'Normal Reverse');
  const f = (name, value, type = 9) => flagsOf({ name, value, text: String(value), type, vehicleId: 1, componentId: 1 }, ref.parameters[name], 'px4');
  ok('flags: at the limit is inside it', !f('BAT_LOW_THR', 0.5).aboveMax && !f('BAT_LOW_THR', 0.12).belowMin);
  ok('flags: the REAL32 of a limit is inside it', !f('BAT_LOW_THR', 0.5000000001).aboveMax && !f('BAT_LOW_THR', Math.fround(0.12)).belowMin);
  ok('flags: above and below', f('BAT_LOW_THR', 0.6).aboveMax && f('BAT_LOW_THR', 0.1).belowMin);
  ok('flags: a value not on the list', f('GPS_1_CONFIG', 999, 6).notListed && !f('GPS_1_CONFIG', 202, 6).notListed);
  ok('flags: a listed decimal value', !f('RC1_REV', 1).notListed && !f('RC1_REV', -1).notListed && f('RC1_REV', 0.5).notListed);
  ok('flags: differs from the default', f('GPS_1_CONFIG', 202, 6).notDefault && !f('GPS_1_CONFIG', 201, 6).notDefault);
  ok('flags: restart', f('GPS_1_CONFIG', 202, 6).reboot && !f('BAT_LOW_THR', 0.3).reboot);
  ok('flags: type differs', f('BAT1_N_CELLS', 4, 9).typeDiffers && !f('BAT1_N_CELLS', 4, 6).typeDiffers);
  const stranger = flagsOf({ name: 'FRAME_CLASS', value: 1, text: '1', type: 6, vehicleId: 1, componentId: 1 }, ref.parameters.FRAME_CLASS, 'px4');
  ok('flags: an ArduPilot name in a PX4 set', stranger.ardupilotLike && !stranger.known);

  const found = findingsOf(set, ref).map((x) => x.id);
  ok('findings: a clean set says so, and notes what differs from default', found.includes('ok') && found.includes('not-default') && found.length === 2, found.join());
}

// ------------------------------------------------------------ Mission Planner file
{
  const MP = ['#NOTE: saved by hand', 'BAT1_N_CELLS,4', 'BAT_LOW_THR,0.3', 'GPS_1_CONFIG 202', 'MYSTERY_ONE\t2.5   # a comment', 'not a parameter line', ''].join('\n');
  const set = readParams(enc(MP), 'hand.param', ref);
  eq('mp: detected', detectParamFormat(enc(MP), 'hand.param'), 'mp-param');
  eq('mp: four parameters, by comma, space and tab', set.entries.map((e) => `${e.name}=${e.value}`).join(), 'BAT1_N_CELLS=4,BAT_LOW_THR=0.3,GPS_1_CONFIG=202,MYSTERY_ONE=2.5');
  ok('mp: says a line was left out', set.notes.some((n) => n.startsWith('1 line(s)')));
  ok('mp: no types', set.entries.every((e) => e.type === null));
  eq('mp: autopilot from the names', set.autopilot, 'px4');
  const mp = writeParams(set, 'mp-param', ref);
  eq('mp: written', dec(mp.data), 'BAT1_N_CELLS,4\nBAT_LOW_THR,0.3\nGPS_1_CONFIG,202\nMYSTERY_ONE,2.5\n');
  ok('mp: says these are still PX4 parameters', mp.report.warnings.some((w) => w.includes('does not make them ArduPilot parameters')));
  const q = writeParams(set, 'qgc-params', ref);
  const rows = dec(q.data).split('\n').filter((l) => !l.startsWith('#') && l);
  eq('mp to qgc: types from the reference, and one worked out', rows.join('|'), '1\t1\tBAT1_N_CELLS\t4\t6|1\t1\tBAT_LOW_THR\t0.3\t9|1\t1\tGPS_1_CONFIG\t202\t6|1\t1\tMYSTERY_ONE\t2.5\t9');
  ok('mp to qgc: report counts them', q.report.changed.some((c) => c.startsWith('3 types taken from the reference, and 1 worked out')), q.report.changed.join());
  ok('mp to qgc: a header is made', dec(q.data).startsWith('# Onboard parameters for Vehicle 1\n#\n# Stack: PX4 Pro\n'));

  const ardu = readParams(enc('FRAME_CLASS,1\nSERIAL1_PROTOCOL,2\nBATT_MONITOR,4\nARMING_CHECK,1\nATC_RAT_RLL_P,0.135\nINS_GYRO_FILTER,20\nWPNAV_SPEED,500\n'), 'copter.param', ref);
  eq('mp: an ArduPilot file is seen as one', ardu.autopilot, 'ardupilot');
  const af = findingsOf(ardu, ref).map((x) => x.id);
  ok('mp: ArduPilot names in an ArduPilot set are not a fault', !af.includes('ardupilot-names') && af.includes('ardupilot-set') && !af.includes('unknown'), af.join());
  ok('mp: written for QGroundControl, it says whose they are', writeParams(ardu, 'qgc-params', ref).report.warnings.some((w) => w.includes('These are ArduPilot parameters')));
  eq('autopilot: without the reference, by shape', detectAutopilot(ardu, null).autopilot, 'ardupilot');
}

// ------------------------------------------------------------ document and table
{
  const set = readParams(enc(QGC), 'bench.params', ref);
  set.entries[1] = { ...set.entries[1], original: 4, value: 6, note: 'Six cells on the big pack' };
  set.entries[3] = { ...set.entries[3], note: 'No safety switch fitted' };
  const json = writeParams(set, 'fc-params', ref);
  const doc = JSON.parse(dec(json.data));
  eq('document: schema', doc.schema, 'flight-companion/params@1');
  eq('document: file name', json.name, 'bench.params.json');
  const cells = doc.parameters.find((p) => p.name === 'BAT1_N_CELLS');
  eq('document: what it is, in PX4\'s words', cells.what_it_is, 'Number of cells for battery 1.');
  eq('document: what the value means', cells.value_means, '6S Battery');
  eq('document: the value the file had', cells.value_in_the_file_it_was_read_from, 4);
  eq('document: the unit', doc.parameters.find((p) => p.name === 'BAT1_CAPACITY').unit, 'mAh');
  eq('document: restart', doc.parameters.find((p) => p.name === 'GPS_1_CONFIG').takes_effect_after_restart, true);
  ok('document: names the reference and its licence', doc.reference.firmware === 'PX4 v1.16.0' && doc.reference.licence.includes('CC BY 4.0'));
  ok('document: carries the findings', doc.findings.some((f) => f.id === 'edited' && f.parameters.join() === 'BAT1_N_CELLS'));
  const back = readParams(json.data, json.name, ref);
  eq('document: detected', detectParamFormat(json.data, 'anything.json'), 'fc-params');
  const strip = (s) => JSON.stringify({ ...s, source: null, sourceFile: null, entries: s.entries.map((e) => ({ ...e, text: isEdited(e) ? '' : e.text })) });
  eq('document round trip: identical', strip(back), strip(set));
  eq('document round trip: and writes the same QGroundControl file', dec(writeParams(back, 'qgc-params', ref).data), dec(writeParams(set, 'qgc-params', ref).data));

  const csv = writeParams(set, 'csv', ref);
  const rows = dec(csv.data).trim().split('\n');
  eq('table: header', rows[0], 'name,value,unit,value_means,group,firmware_default,lowest,highest,mavlink_type,changed_here,note,what_it_is');
  eq('table: a row', rows[2], 'BAT1_N_CELLS,6,,6S Battery,Battery Calibration,0,,,6,yes,Six cells on the big pack,Number of cells for battery 1.');
  const t = readParams(csv.data, csv.name, ref);
  eq('table round trip: names and values', t.entries.map((e) => `${e.name}=${e.value}`).join(), set.entries.map((e) => `${e.name}=${e.value}`).join());
  eq('table round trip: notes', t.entries.filter((e) => e.note).map((e) => e.note).join('|'), 'Six cells on the big pack|No safety switch fitted');
  eq('table round trip: types', t.entries.map((e) => e.type).join(), '9,6,9,6,6,6');
  ok('notes: a QGroundControl file cannot hold them, and the report says so', writeParams(set, 'qgc-params', ref).report.dropped.some((d) => d.what === 'Notes' && d.count === 2));
}

// ------------------------------------------------------------ comparing
{
  const a = readParams(enc(QGC), 'a.params', ref);
  const b = readParams(enc(QGC.replace('GPS_1_CONFIG\t202', 'GPS_1_CONFIG\t201').replace('1\t1\tSYS_AUTOSTART\t4019\t6\r\n', '').replace('0.30000001192092896', '0.3') + '1\t1\tCOM_KILL_DISARM\t5\t9\r\n'), 'b.params', ref);
  const d = diffSets(a, b);
  eq('diff: counts', `${d.same} same, ${d.changed} changed, ${d.onlyHere} only here, ${d.onlyThere} only there`, '4 same, 1 changed, 1 only here, 1 only there');
  eq('diff: rows, by name', d.rows.map((r) => `${r.name}:${r.kind}:${r.here}:${r.there}`).join(), 'COM_KILL_DISARM:only-there:null:5,GPS_1_CONFIG:changed:202:201,SYS_AUTOSTART:only-here:4019:null');
  eq('diff: a set against itself', diffSets(a, a).rows.length, 0);
  // two components may hold a parameter of the same name
  const two = readParams(enc('1\t1\tCAL_X\t1\t6\n1\t100\tCAL_X\t2\t6\n'), 'two.params', ref);
  eq('diff: the same name in two components is two parameters', diffSets(two, two).same, 2);
  ok('findings: and is not called a repeat', !findingsOf(two, ref).some((f) => f.id === 'twice'));
  const twice = readParams(enc('1\t1\tBAT1_N_CELLS\t4\t6\n1\t1\tBAT1_N_CELLS\t6\t6\n'), 'twice.params', ref);
  ok('findings: the same name twice in one component is', findingsOf(twice, ref).some((f) => f.id === 'twice' && f.names.join() === 'BAT1_N_CELLS'));
}

// ------------------------------------------------------------ refusals
{
  for (const [name, bytes, file, expect] of [
    ['an empty file', new Uint8Array(0), 'x.params', 'empty'],
    ['a flight log', enc('ULog\x01\x12'), 'flight.ulg', 'flight log'],
    ['a plan', enc('{"fileType": "Plan", "mission": {}}'), 'a.plan', 'mission'],
    ['a waypoint list', enc('QGC WPL 110\n0\t1\t0\t16\t0\t0\t0\t0\t1\t2\t3\t1\n'), 'a.txt', 'mission'],
    ['JSON of another kind', enc('{"name": "package"}'), 'package.json', 'not a parameter document'],
    ['XML', enc('<?xml version="1.0"?><gpx></gpx>'), 'a.gpx', 'XML'],
    ['prose', enc('Dear pilot,\nplease check the props.\n'), 'note.txt', 'not a parameter file'],
    ['a header and no rows', enc('# Onboard parameters for Vehicle 1\n#\n'), 'x.params', 'holds no parameters'],
  ]) {
    const message = refuses(bytes, file);
    ok(`refusal: ${name}`, message.includes(expect), message);
  }
  eq('formats: four', PARAM_FORMATS.length, 4);
}

// ------------------------------------------------------------ the examples
{
  const built = Object.fromEntries(PARAM_SAMPLES.map((s) => [s.id, s.build(ref)]));
  const d = built.defaults;
  ok('examples: the defaults are six groups', d.entries.length > 100 && d.entries.length < 300, String(d.entries.length));
  ok('examples: every value is the reference\'s default', d.entries.every((e) => sameValue(e.value, ref.parameters[e.name].default, e.type)));
  eq('examples: the defaults have nothing to stop or check', findingsOf(d, ref).filter((f) => f.level === 'critical' || f.level === 'warning').map((f) => `${f.id}: ${f.names.join(' ')}`).join('; '), '');
  ok('examples: say they were not read from an aircraft', Object.values(built).every((s) => s.notes.some((n) => n.includes('was not read from an aircraft'))));
  const bench = diffSets(built['after-bench'], d);
  eq('examples: the bench session differs by five', `${bench.changed} ${bench.onlyHere} ${bench.onlyThere}`, '5 0 0');
  eq('examples: and by these five', bench.rows.map((r) => r.name).join(), Object.keys(BENCH_CHANGES).sort((a, b) => a.localeCompare(b)).join());
  eq('examples: whose values are inside their limits', findingsOf(built['after-bench'], ref).filter((f) => f.level !== 'info' && f.level !== 'good').length, 0);
  const wrong = findingsOf(built['wrong-names'], ref);
  eq('examples: wrong names are the first finding', `${wrong[0].id} ${wrong[0].level} ${wrong[0].names.join()}`, 'ardupilot-names critical FRAME_CLASS,SERIAL1_PROTOCOL,BATT_MONITOR');
  ok('examples: and no PX4 name is offered for them', !/use |instead|equivalent is/i.test(wrong[0].detail), wrong[0].detail);
  const out = findingsOf(built.outside, ref).find((f) => f.id === 'outside');
  eq('examples: the value outside its limits', out?.names.join(), 'BAT_CRIT_THR');
  // every example can be written in every format and read back
  for (const s of PARAM_SAMPLES) {
    for (const f of PARAM_FORMATS) {
      const back = readParams(writeParams(built[s.id], f.id, ref).data, `x.${f.extensions[0]}`, ref);
      eq(`examples: ${s.id} as ${f.id}`, back.entries.map((e) => `${e.name}=${Math.fround(e.value)}`).join(), built[s.id].entries.map((e) => `${e.name}=${Math.fround(e.value)}`).join());
    }
  }
}

// ------------------------------------------------------------ real files from an aircraft
if (real && existsSync(real)) {
  const files = readdirSync(real).filter((f) => f.endsWith('.params')).sort();
  ok('real: there are files to read', files.length > 0);
  const sets = [];
  for (const f of files) {
    const bytes = readFileSync(join(real, f));
    const set = readParams(new Uint8Array(bytes), f, ref);
    sets.push(set);
    eq(`real ${f}: written back byte for byte`, Buffer.compare(Buffer.from(writeParams(set, 'qgc-params', ref).data), bytes), 0);
    eq(`real ${f}: autopilot`, set.autopilot, 'px4');
    const found = findingsOf(set, ref);
    ok(`real ${f}: no name with the shape of another autopilot's, no type that differs`, !found.some((x) => x.id === 'ardupilot-names' || x.id === 'type'), found.map((x) => x.id).join());
    const back = readParams(writeParams(set, 'fc-params', ref).data, 'x.params.json', ref);
    eq(`real ${f}: through the document and back, the same file`, Buffer.compare(Buffer.from(writeParams(back, 'qgc-params', ref).data), bytes), 0);
    const viaMp = readParams(writeParams(set, 'mp-param', ref).data, 'x.param', ref);
    const d = diffSets(set, viaMp);
    eq(`real ${f}: through Mission Planner's format and back, the same values`, d.rows.length, 0);
  }
  for (let i = 1; i < sets.length; i++) {
    const d = diffSets(sets[i], sets[i - 1]);
    console.log(`  ${files[i - 1]} -> ${files[i]}: ${d.changed} changed, ${d.onlyHere} new, ${d.onlyThere} gone, ${d.same} the same`);
    eq(`real: ${files[i]} accounts for every parameter`, d.same + d.changed + d.onlyHere, sets[i].entries.length);
  }
  const last = sets[sets.length - 1];
  const unknown = findingsOf(last, ref).find((x) => x.id === 'unknown');
  console.log(`  ${files[files.length - 1]}: ${last.entries.length} parameters, not in the reference: ${unknown ? unknown.names.join(', ') : 'none'}`);
  const outside = findingsOf(last, ref).find((x) => x.id === 'outside');
  console.log(`  outside the reference's limits: ${outside ? outside.names.join(', ') : 'none'}`);
  const unlisted = findingsOf(last, ref).find((x) => x.id === 'not-listed');
  console.log(`  not among the values the reference lists: ${unlisted ? unlisted.names.join(', ') : 'none'}`);
} else {
  skipped += 1;
  console.log('  skipped: files from a real aircraft (no --real folder)');
}

console.log(`\nparameters: ${passed} checks passed, ${failed} failed${skipped ? `, ${skipped} group(s) skipped` : ''}`);
process.exit(failed ? 1 : 0);
