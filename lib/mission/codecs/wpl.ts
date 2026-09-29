// "QGC WPL 110" — the plain-text waypoint list that Mission Planner saves and
// both ground stations read. Source: mavlink.io, "File Formats":
//   QGC WPL <VERSION>
//   <INDEX> <CURRENT WP> <COORD FRAME> <COMMAND> <P1> <P2> <P3> <P4> <LAT> <LON> <ALT> <AUTOCONTINUE>
// with the fields separated by tabs. Files written by hand often use spaces, and
// those are read too.
//
// Row 0 is the home position by convention: ArduPilot's tools write it that way
// and QGroundControl's own test files follow it. It is not a waypoint to fly.
import {
  emptyMission,
  emptyReport,
  MissionFormatError,
  type Mission,
  type WrittenFile,
} from '../model.ts';
import { hoverSeconds, itemFromRow, rowFromItem, rowsFromActions, type MavRow } from '../mavlink.ts';
import { decode, encode, fmt } from '../xml.ts';
import { safeName } from './qgcPlan.ts';

export function looksLikeWpl(text: string): boolean {
  return /^\s*QGC WPL \d+/.test(text);
}

export function readWpl(bytes: Uint8Array, fileName: string): Mission {
  const lines = decode(bytes)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
  const header = lines.shift();
  const version = header ? /^QGC WPL (\d+)/.exec(header) : null;
  if (!version) {
    throw new MissionFormatError('The first line is not "QGC WPL 110", so this is not a waypoint list.');
  }

  const mission = emptyMission(fileName.replace(/\.(waypoints|mission|txt)$/i, ''));
  mission.source = 'qgc-wpl';
  mission.sourceFile = fileName;
  if (version[1] !== '110') {
    mission.notes.push(`The file says version ${version[1]}. It was read as version 110, the one that is documented.`);
  }

  const rows: (MavRow & { index: number; current: number })[] = [];
  let bad = 0;
  for (const line of lines) {
    const f = line.split(/\s+/).map(Number);
    if (f.length < 12 || f.slice(0, 12).some((v) => !Number.isFinite(v))) {
      bad += 1;
      continue;
    }
    rows.push({
      index: f[0],
      current: f[1],
      frame: f[2],
      command: f[3],
      params: [f[4], f[5], f[6], f[7], f[8], f[9], f[10]],
      autoContinue: f[11] !== 0,
    });
  }
  if (bad > 0) mission.notes.push(`${bad} line(s) did not have twelve numbers and were left out.`);

  const first = rows[0];
  if (first && first.index === 0 && first.command === 16 && first.frame === 0) {
    const [lat, lng, alt] = [first.params[4] ?? 0, first.params[5] ?? 0, first.params[6] ?? 0];
    if (lat !== 0 || lng !== 0) mission.home = { lat, lng, heightAmsl: alt };
    rows.shift();
    mission.notes.push(
      'Row 0 was read as the home position, as the convention has it, and not as a waypoint to fly.',
    );
  }
  mission.items = rows.map(itemFromRow);
  return mission;
}

export function writeWpl(mission: Mission): WrittenFile {
  const report = emptyReport('qgc-wpl');
  const rows: MavRow[] = [];
  const refused = new Map<string, number>();
  const changed = new Map<string, number>();
  let actionsDropped = 0;

  for (const item of mission.items) {
    const withHold =
      item.kind === 'waypoint' && hoverSeconds(item) > 0
        ? { ...item, holdS: (item.holdS ?? 0) + hoverSeconds(item) }
        : item;
    const r = rowFromItem(withHold, mission);
    if (!r.row) {
      refused.set(r.refused ?? 'could not be written', (refused.get(r.refused ?? '') ?? 0) + 1);
      continue;
    }
    if (r.changed) changed.set(r.changed, (changed.get(r.changed) ?? 0) + 1);
    rows.push(r.row);
    const extra = rowsFromActions(item);
    rows.push(...extra.rows);
    actionsDropped += extra.dropped;
    if (item.kind === 'waypoint' && item.speed && item.speed > 0) {
      rows.push({ command: 178, frame: 2, params: [1, item.speed, -1, 0, 0, 0, 0], autoContinue: true });
    }
  }

  const line = (i: number, current: number, r: MavRow) =>
    [
      i,
      current,
      r.frame,
      r.command,
      ...r.params.slice(0, 4).map((v) => fmt(v ?? 0, 8)),
      fmt(r.params[4] ?? 0, 8),
      fmt(r.params[5] ?? 0, 8),
      fmt(r.params[6] ?? 0, 6),
      r.autoContinue ? 1 : 0,
    ].join('\t');

  const out = ['QGC WPL 110'];
  const home = mission.home ?? { lat: 0, lng: 0, heightAmsl: 0 };
  out.push(
    line(0, 1, {
      command: 16,
      frame: 0,
      params: [0, 0, 0, 0, home.lat, home.lng, home.heightAmsl ?? 0],
      autoContinue: true,
    }),
  );
  rows.forEach((r, i) => out.push(line(i + 1, 0, r)));

  for (const [why, count] of refused) report.dropped.push({ what: 'Items', count, why });
  for (const [what, count] of changed) report.changed.push(`${count} item${count > 1 ? 's' : ''}: ${what}.`);
  if (actionsDropped > 0) {
    report.dropped.push({
      what: 'Waypoint actions',
      count: actionsDropped,
      why: 'gimbal moves and actions without a name have no agreed MAVLink mission command here',
    });
  }
  const named = mission.items.filter((i) => i.kind === 'waypoint' && i.name).length;
  if (named > 0) report.dropped.push({ what: 'Waypoint names', count: named, why: 'a row has a number, not a name' });
  const shapes = mission.areas.length + mission.circles.length;
  if (shapes > 0) {
    report.dropped.push({ what: 'Geofences and areas', count: shapes, why: 'a waypoint list holds the mission only' });
  }
  if (mission.rally.length > 0) {
    report.dropped.push({ what: 'Rally points', count: mission.rally.length, why: 'a waypoint list holds the mission only' });
  }
  if (mission.cruiseSpeed !== null && !mission.items.some((i) => i.kind === 'speed')) {
    report.dropped.push({
      what: 'Default speed',
      count: 1,
      why: 'a waypoint list has no default speed; add a "change speed" item to set one',
    });
  }
  if (!mission.home) {
    report.warnings.push('The mission has no takeoff point. Row 0, the home row, is written as 0, 0.');
  }
  report.kept.push(`${rows.length} mission item${rows.length === 1 ? '' : 's'}, with every command number and parameter.`);
  if (mission.home) report.kept.push('The home position, as row 0.');

  return {
    name: `${safeName(mission.name)}.waypoints`,
    mime: 'text/plain',
    data: encode(out.join('\n') + '\n'),
    report,
  };
}
