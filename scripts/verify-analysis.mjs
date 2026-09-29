// Check the flight analysis against figures worked out independently with pyulog
// on 2026-09-28 (recorded in build-log.md), using this project's own logs.
// Usage: node scripts/verify-analysis.mjs <logs dir>
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ULog } from '../lib/ulog/parser.ts';
import { summarize } from '../lib/ulog/analysis.ts';

const dir = process.argv[2];
let failed = 0;
let passed = 0;
const near = (name, got, want, tol) => {
  if (got !== null && Math.abs(got - want) <= tol) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}: got ${got}, want ${want} ± ${tol}`);
  }
};
const yes = (name, cond) => {
  if (cond) passed++;
  else {
    failed++;
    console.log(`  FAIL ${name}`);
  }
};

const files = readdirSync(dir).filter((f) => f.endsWith('.ulg')).sort();
const byTag = (tag) => files.find((f) => f.includes(tag));
const load = (tag) => {
  const f = byTag(tag);
  if (!f) throw new Error(`no log matching ${tag}`);
  return summarize(new ULog(readFileSync(join(dir, f))));
};
const ids = (s) => s.findings.map((f) => f.id);

console.log('file'.padEnd(62), 'air s', ' alt m', ' V start', ' V min', ' A max', ' mAh', ' findings');
for (const f of files) {
  const t0 = performance.now();
  const s = summarize(new ULog(readFileSync(join(dir, f))));
  const ms = performance.now() - t0;
  const n = (v, d = 1) => (v === null ? 'n/a' : v.toFixed(d));
  console.log(
    f.padEnd(62),
    n(s.stats.airborneS, 0).padStart(5),
    n(s.stats.maxAltM).padStart(6),
    n(s.stats.battStartV, 2).padStart(8),
    n(s.stats.battMinV, 2).padStart(6),
    n(s.stats.maxCurrentA).padStart(6),
    n(s.stats.usedMah, 0).padStart(4),
    ' ' + ids(s).join(', '),
    ` (${ms.toFixed(0)} ms, ${s.charts.length} charts)`,
  );
}

// --- the roll-over
{
  const s = load('212408Z');
  yes('rollover: attitude failure is found', ids(s).includes('attitude-failure'));
  yes('rollover: it is the first finding', s.findings[0].id === 'attitude-failure');
  yes('rollover: it is critical', s.findings[0].level === 'critical');
  near('rollover: failure time', s.findings[0].at, 890.22 - 882.24, 0.3);
  yes('rollover: says soon after takeoff', /after leaving the ground/.test(s.findings[0].detail));
  yes('rollover: quotes the message plainly', /reported "Preflight Fail: Attitude failure \(roll\)"/.test(s.findings[0].detail));
  yes('rollover: a pack at 4.04 V per cell is a note, not a warning', s.findings.find((f) => f.id === 'pack-not-full').level === 'info');
  yes('rollover: rolled past 120 degrees', s.stats.maxRollDeg > 120);
  near('rollover: start voltage', s.stats.battStartV, 16.17, 0.05);
  near('rollover: current spike', s.stats.maxCurrentA, 66.4, 0.5);
  near('rollover: lowest voltage', s.stats.battMinV, 11.23, 0.05);
  yes('rollover: crash figures are not reported as findings', !ids(s).some((i) => /motor-|voltage-sag|percent-/.test(i)));
}

// --- hover 25 s
{
  const s = load('224847Z');
  near('hover25: airborne', s.stats.airborneS, 25, 1.5);
  near('hover25: max height', s.stats.maxAltM, 1.6, 0.15);
  near('hover25: max current', s.stats.maxCurrentA, 9.0, 0.2);
  // the counter read 238 mAh at the end and 195 at the end of the log before it
  near('hover25: used mAh in this log', s.stats.usedMah, 238 - 195, 6);
  const want = [1465, 1428, 1244, 1184];
  want.forEach((w, i) => near(`hover25: motor ${i + 1} mean`, s.stats.motorMeansUs[i], w, 15));
  yes('hover25: yaw imbalance is found', ids(s).includes('motor-balance-yaw'));
  yes('hover25: names motors 1 and 2', /Motors 1 and 2 worked harder than 3 and 4/.test(s.findings.find((f) => f.id === 'motor-balance-yaw').title));
  yes('hover25: no attitude failure', !ids(s).includes('attitude-failure'));
  yes('hover25: mode is Position', s.modes.some((m) => m.name === 'Position'));
}

// --- hover with the battery return
{
  const s = load('224715Z');
  yes('return: modes include Hold and Return', ['Position', 'Hold', 'Return'].every((n) => s.modes.some((m) => m.name === n)));
  yes('return: failsafe is found', ids(s).includes('failsafe'));
  near('return: max current', s.stats.maxCurrentA, 27.1, 0.2);
  near('return: lowest voltage', s.stats.battMinV, 14.35, 0.03);
}

// --- hover 39 s, critical battery
{
  const s = load('230340Z');
  near('critical: airborne', s.stats.airborneS, 39, 1.5);
  near('critical: start voltage', s.stats.battStartV, 15.74, 0.05);
  near('critical: lowest voltage', s.stats.battMinV, 14.33, 0.03);
  near('critical: max current', s.stats.maxCurrentA, 18.6, 0.2);
  near('critical: used mAh', s.stats.usedMah, 150, 2);
  near('critical: estimate at start', s.stats.battStartPct, 75, 1.5);
  near('critical: estimate at lowest', s.stats.battMinPct, 19, 1.5);
  for (const id of ['failsafe', 'pack-not-full', 'voltage-sag', 'percent-follows-sag', 'motor-balance-yaw', 'hover-current']) {
    yes(`critical: finding ${id}`, ids(s).includes(id));
  }
  const sag = s.findings.find((f) => f.id === 'voltage-sag');
  const mOhm = Number(sag.facts[0][1].replace(/[^0-9.]/g, ''));
  // pyulog, 2026-09-29: rest 15.733 V; in the air 14.939 V at 12.68 A = 62.7 mΩ;
  // steady hover only (14 A and over) 14.857 V at 15.27 A = 57.4 mΩ
  yes(`critical: resistance is 55 to 68 mΩ (got ${mOhm})`, mOhm >= 55 && mOhm <= 68);
  yes('critical: measured from the resting voltage', /Resting voltage before takeoff/.test(sag.facts[4][1]));
  near('critical: resting voltage', Number(sag.facts[1][1].replace(/[^0-9.]/g, '')), 15.74, 0.06);
  const fs = s.findings.find((f) => f.id === 'failsafe');
  yes('critical: failsafe stepped in twice', /2 times/.test(fs.detail));
  yes('critical: messages are shown without the module name', fs.facts.every(([, v]) => !v.startsWith('[')));
  const hover = s.findings.find((f) => f.id === 'hover-current');
  yes(`critical: hover current offered is 13 to 16 A (got ${hover.offer.value})`, hover.offer.value >= 13 && hover.offer.value <= 16);
  yes('critical: has a track and a home', s.track !== null && s.home !== null);
  yes('critical: start time is 2026-09-28 UTC', new Date(s.startUtcMs).toISOString().startsWith('2026-09-28T23:03'));
  yes('critical: events are in time order', s.events.every((e, i) => i === 0 || e.t >= s.events[i - 1].t));
  yes('critical: all chart series are inside the log', s.charts.every((c) => c.series.every((x) => x.t[0] >= 0 && x.t[x.t.length - 1] <= s.duration + 1)));
  yes('critical: no chart has more than four series', s.charts.every((c) => c.series.length <= 4));
  yes('critical: parameters listed', s.params.length === 1116);
  yes('critical: firmware named', /1\.16/.test(s.system.firmware));
  yes('critical: airframe 4019', s.system.airframeId === 4019);
}

// --- armed, never flew
{
  const s = load('212334Z');
  yes('no takeoff: says so', ids(s).includes('did-not-fly'));
  near('no takeoff: airborne', s.stats.airborneS, 0, 0.01);
  yes('no takeoff: no motor balance claim', !ids(s).some((i) => i.startsWith('motor-balance')));
}

console.log(`\nanalysis: ${passed} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
