// Reading and writing parameter files.
//
//   qgc-params  QGroundControl's .params: a header of comment lines, then one
//               row per parameter, tab-separated:
//                   vehicle id, component id, name, value, MAVLink type
//               Source: docs.qgroundcontrol.com, "Parameters File Format".
//   mp-param    Mission Planner's .param (and MAVProxy's .parm): NAME,VALUE a
//               line, or NAME then a space or tab then VALUE. No type, no ids.
//   csv         One row per parameter, for a spreadsheet.
//   fc-params   This app's JSON: every parameter with its unit, its meaning
//               and whether it differs from the default, for a person or an
//               assistant to read.
//
// Changing a file's FORMAT does not change whose parameters they are. PX4
// parameters written as a Mission Planner file are still PX4 parameters.
import { detectAutopilot, findingsOf, flagsOf, groupOf, valueMeaning } from './analysis.ts';
import {
  emptySet,
  isEdited,
  isFloatType,
  MAV_PARAM_TYPE,
  ParamFormatError,
  valueText,
  type ParamEntry,
  type ParamFormatId,
  type ParamReference,
  type ParamReport,
  type ParamSet,
  type WrittenParams,
} from './model.ts';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');

export interface ParamFormat {
  id: ParamFormatId;
  label: string;
  extensions: string[];
  usedBy: string;
  about: string;
  source: string;
  /** A ground station can load it. */
  loadable: boolean;
}

export const PARAM_FORMATS: ParamFormat[] = [
  {
    id: 'qgc-params',
    label: 'QGroundControl parameters',
    extensions: ['params'],
    usedBy: 'QGroundControl: Parameters, Tools, Save to file and Load from file',
    about: 'A header of comment lines, then one row per parameter: vehicle id, component id, name, value and MAVLink type, separated by tabs.',
    source: 'docs.qgroundcontrol.com, "Parameters File Format"',
    loadable: true,
  },
  {
    id: 'mp-param',
    label: 'Mission Planner parameters',
    extensions: ['param', 'parm'],
    usedBy: 'Mission Planner and MAVProxy',
    about: 'A name, a comma, a value. Nothing else: no type and no component.',
    source: 'files written by Mission Planner; ArduPilot publishes no specification for it',
    loadable: true,
  },
  {
    id: 'csv',
    label: 'Table (CSV)',
    extensions: ['csv'],
    usedBy: 'Spreadsheets',
    about: 'One row per parameter, with its unit, group, default and what it is.',
    source: 'this app',
    loadable: false,
  },
  {
    id: 'fc-params',
    label: 'Parameter document (JSON)',
    extensions: ['params.json', 'json'],
    usedBy: 'People, scripts and assistants',
    about: 'Every parameter with its value, unit, meaning, limits and whether it differs from the default.',
    source: 'this app, schema flight-companion/params@1',
    loadable: false,
  },
];

export function paramFormatById(id: ParamFormatId): ParamFormat {
  const f = PARAM_FORMATS.find((x) => x.id === id);
  if (!f) throw new ParamFormatError(`Unknown format: ${id}`);
  return f;
}

export const ACCEPTED_PARAM_EXTENSIONS = ['.params', '.param', '.parm', '.csv', '.json', '.txt'];

export const PARAMS_SCHEMA = 'flight-companion/params@1';

export function safeFileName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'parameters';
}

function baseName(fileName: string): string {
  return fileName.replace(/\.(params\.json|params|param|parm|csv|json|txt)$/i, '');
}

export function detectParamFormat(bytes: Uint8Array, fileName: string): ParamFormatId {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const head = dec(bytes.subarray(0, Math.min(bytes.length, 8192))).trimStart();
  if (head.startsWith('ULog') || ext === 'ulg' || ext === 'bin' || ext === 'tlog') {
    throw new ParamFormatError('That is a flight log, not a parameter file. Open it in Flight Logs: its Parameters view shows the parameters the log recorded.');
  }
  if (head.startsWith('QGC WPL') || ext === 'plan' || ext === 'waypoints' || ext === 'kmz' || ext === 'fpl') {
    throw new ParamFormatError('That is a mission, not a parameter file. Open it in Missions.');
  }
  if (head.startsWith('{')) {
    if (head.includes('flight-companion/params@')) return 'fc-params';
    if (head.includes('"fileType"') || head.includes('"mission"')) {
      throw new ParamFormatError('That is a mission, not a parameter file. Open it in Missions.');
    }
    throw new ParamFormatError('The file is JSON, but not a parameter document this app wrote.');
  }
  if (head.startsWith('<')) throw new ParamFormatError('The file is XML. A parameter file is plain text.');
  const rows = head.split(/\r?\n/).filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  const first = rows[0] ?? '';
  if (/^\d+\t\d+\t[A-Za-z][\w.-]*\t/.test(first) || /^\d+\s+\d+\s+[A-Za-z][\w.-]*\s+\S+\s+\d+\s*$/.test(first)) return 'qgc-params';
  if (/^name\s*[,;\t]/i.test(first)) return 'csv';
  if (/^[A-Za-z][\w.-]*\s*[,\s]\s*-?[\d.]/.test(first)) return 'mp-param';
  if (rows.length === 0 && /Onboard parameters/i.test(head)) return 'qgc-params';
  throw new ParamFormatError(
    'The file is not a parameter file this app reads. It reads QGroundControl .params, Mission Planner .param, and its own tables and documents.',
  );
}

function finish(set: ParamSet, reference: ParamReference | null, skipped: number): ParamSet {
  const found = detectAutopilot(set, reference);
  set.autopilot = found.autopilot;
  set.autopilotFrom = found.from;
  if (skipped > 0) set.notes.push(`${skipped} line(s) could not be read as a parameter and were left out.`);
  if (set.entries.length === 0) throw new ParamFormatError('The file holds no parameters.');
  return set;
}

function readQgc(text: string, fileName: string, reference: ParamReference | null): ParamSet {
  const set = emptySet(baseName(fileName));
  set.source = 'qgc-params';
  set.sourceFile = fileName;
  set.eol = text.includes('\r\n') ? '\r\n' : '\n';
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      // kept as written, trailing spaces and all, so the file can be written back the same
      set.header.push(raw);
      const m = /^#\s*(Stack|Vehicle|Version|Git Revision):\s*(.*)$/i.exec(line);
      if (m) {
        const v = m[2].trim();
        const k = m[1].toLowerCase();
        if (k === 'stack') set.stack = v;
        else if (k === 'vehicle') set.vehicle = v;
        else if (k === 'version') set.version = v;
        else set.gitRevision = v;
      }
      continue;
    }
    const c = line.split(/\t|\s+/);
    const value = Number(c[3]);
    const type = Number(c[4]);
    if (c.length < 5 || !Number.isInteger(Number(c[0])) || !Number.isInteger(Number(c[1])) || !Number.isFinite(value) || !(type in MAV_PARAM_TYPE)) {
      skipped += 1;
      continue;
    }
    set.entries.push({ name: c[2], value, text: c[3], type, vehicleId: Number(c[0]), componentId: Number(c[1]) });
  }
  return finish(set, reference, skipped);
}

function readMp(text: string, fileName: string, reference: ParamReference | null): ParamSet {
  const set = emptySet(baseName(fileName));
  set.source = 'mp-param';
  set.sourceFile = fileName;
  set.eol = text.includes('\r\n') ? '\r\n' : '\n';
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      set.header.push(raw.replace(/\s+$/, ''));
      continue;
    }
    // a value may be followed by a comment
    const m = /^([A-Za-z][\w.-]*)\s*[,\s]\s*(-?[\d.]+(?:[eE][+-]?\d+)?)\s*(?:#.*)?$/.exec(line);
    const value = m ? Number(m[2]) : NaN;
    if (!m || !Number.isFinite(value)) {
      skipped += 1;
      continue;
    }
    set.entries.push({ name: m[1], value, text: m[2], type: null, vehicleId: 1, componentId: 1 });
  }
  set.notes.push('This format carries no types. When the set is written as a QGroundControl file, each type is taken from the reference, or from whether the value is a whole number.');
  return finish(set, reference, skipped);
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',' || ch === ';' || ch === '\t') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function readCsv(text: string, fileName: string, reference: ParamReference | null): ParamSet {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = splitCsv(lines[0] ?? '').map((h) => h.toLowerCase());
  const iName = header.indexOf('name');
  const iValue = header.indexOf('value');
  if (iName < 0 || iValue < 0) throw new ParamFormatError('The table needs a column called name and a column called value.');
  const iType = header.indexOf('mavlink_type');
  const iNote = header.indexOf('note');
  const set = emptySet(baseName(fileName));
  set.source = 'csv';
  set.sourceFile = fileName;
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const c = splitCsv(line);
    const value = Number(c[iValue]);
    if (!c[iName] || c[iValue] === '' || !Number.isFinite(value)) {
      skipped += 1;
      continue;
    }
    const type = iType >= 0 && Number(c[iType]) in MAV_PARAM_TYPE ? Number(c[iType]) : null;
    set.entries.push({
      name: c[iName],
      value,
      text: c[iValue],
      type,
      vehicleId: 1,
      componentId: 1,
      ...(iNote >= 0 && c[iNote] ? { note: c[iNote] } : null),
    });
  }
  return finish(set, reference, skipped);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function readJson(text: string, fileName: string, reference: ParamReference | null): ParamSet {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new ParamFormatError('The file is not valid JSON.');
  }
  if (!isObj(doc) || typeof doc.schema !== 'string' || !doc.schema.startsWith('flight-companion/params@')) {
    throw new ParamFormatError(`The file does not name the schema "${PARAMS_SCHEMA}".`);
  }
  const set = emptySet(typeof doc.name === 'string' ? doc.name : baseName(fileName));
  set.source = 'fc-params';
  set.sourceFile = fileName;
  const from = isObj(doc.file_header) ? doc.file_header : {};
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null);
  set.stack = str(from.stack);
  set.vehicle = str(from.vehicle);
  set.version = str(from.version);
  set.gitRevision = str(from.git_revision);
  if (Array.isArray(from.comment_lines)) set.header = from.comment_lines.filter((l): l is string => typeof l === 'string');
  if (from.line_ending === 'CRLF') set.eol = '\r\n';
  let skipped = 0;
  for (const p of Array.isArray(doc.parameters) ? doc.parameters : []) {
    if (!isObj(p) || typeof p.name !== 'string' || typeof p.value !== 'number' || !Number.isFinite(p.value)) {
      skipped += 1;
      continue;
    }
    const type = typeof p.mavlink_type === 'number' && p.mavlink_type in MAV_PARAM_TYPE ? p.mavlink_type : null;
    const original = typeof p.value_in_the_file_it_was_read_from === 'number' ? p.value_in_the_file_it_was_read_from : undefined;
    set.entries.push({
      name: p.name,
      value: p.value,
      text: typeof p.value_as_written === 'string' && original === undefined ? p.value_as_written : '',
      type,
      vehicleId: typeof p.vehicle_id === 'number' ? p.vehicle_id : 1,
      componentId: typeof p.component_id === 'number' ? p.component_id : 1,
      ...(original !== undefined ? { original } : null),
      ...(typeof p.note === 'string' && p.note ? { note: p.note } : null),
    });
  }
  if (Array.isArray(doc.notes_from_the_reader)) set.notes = doc.notes_from_the_reader.filter((n): n is string => typeof n === 'string');
  return finish(set, reference, skipped);
}

export function readParams(bytes: Uint8Array, fileName: string, reference: ParamReference | null = null): ParamSet {
  if (bytes.length === 0) throw new ParamFormatError('The file is empty.');
  const id = detectParamFormat(bytes, fileName);
  const text = dec(bytes);
  switch (id) {
    case 'qgc-params':
      return readQgc(text, fileName, reference);
    case 'mp-param':
      return readMp(text, fileName, reference);
    case 'csv':
      return readCsv(text, fileName, reference);
    case 'fc-params':
      return readJson(text, fileName, reference);
  }
}

// ------------------------------------------------------------------ writing

function report(format: ParamFormatId): ParamReport {
  return { format, kept: [], dropped: [], changed: [], warnings: [] };
}

function whose(set: ParamSet): string {
  return set.autopilot === 'px4' ? 'PX4' : set.autopilot === 'ardupilot' ? 'ArduPilot' : 'an autopilot the file does not name';
}

function common(set: ParamSet, r: ParamReport, loadable: boolean): void {
  const edited = set.entries.filter(isEdited).length;
  r.kept.push(`${set.entries.length} parameter${set.entries.length === 1 ? '' : 's'}, in the order of the set.`);
  if (edited > 0) r.changed.push(`${edited} value${edited > 1 ? 's' : ''} changed here are written with their new value.`);
  if (loadable) {
    r.warnings.push(
      'Loading a parameter file sets every parameter in it. Save the aircraft’s own parameters to a file first, so there is a way back.',
    );
    r.warnings.push('This app never sends parameters to an aircraft. A person loads the file in the ground station.');
  }
}

function typeFor(e: ParamEntry, reference: ParamReference | null): { type: number; guessed: boolean } {
  if (e.type !== null) return { type: e.type, guessed: false };
  const meta = reference?.parameters[e.name];
  if (meta) return { type: meta.type === 'FLOAT' ? 9 : 6, guessed: false };
  return { type: Number.isInteger(e.value) && !/[.eE]/.test(e.text) ? 6 : 9, guessed: true };
}

export function writeQgcParams(set: ParamSet, reference: ParamReference | null = null): WrittenParams {
  const r = report('qgc-params');
  const eol = set.eol;
  // a QGroundControl header is written back as it was read, whatever the set has been
  // through since; a set that never had one gets QGroundControl's own
  const kept = set.header.some((l) => /Vehicle-Id\s+Component-Id/i.test(l));
  const header =
    kept
      ? set.header
      : [
          `# Onboard parameters for Vehicle ${set.entries[0]?.vehicleId ?? 1}`,
          '#',
          ...(set.stack ? [`# Stack: ${set.stack}`] : set.autopilot === 'px4' ? ['# Stack: PX4 Pro'] : set.autopilot === 'ardupilot' ? ['# Stack: ArduPilot'] : []),
          ...(set.vehicle ? [`# Vehicle: ${set.vehicle}`] : []),
          ...(set.version ? [`# Version: ${set.version}`] : []),
          ...(set.gitRevision ? [`# Git Revision: ${set.gitRevision}`] : []),
          '#',
          '# Vehicle-Id Component-Id Name Value Type',
        ];
  let guessed = 0;
  const rows = set.entries.map((e) => {
    const t = typeFor(e, reference);
    if (t.guessed) guessed += 1;
    const typed: ParamEntry = { ...e, type: t.type };
    // a whole number read from a file with no types may have been written "4.000000"
    const text = e.type === null && !isFloatType(t.type) ? String(Math.round(e.value)) : valueText(typed);
    return [e.vehicleId, e.componentId, e.name, text, t.type].join('\t');
  });
  common(set, r, true);
  if (kept) r.kept.push('The header and every unchanged value, exactly as the file had them.');
  const untyped = set.entries.filter((e) => e.type === null).length;
  if (untyped > 0) {
    r.changed.push(
      `${untyped - guessed} type${untyped - guessed === 1 ? '' : 's'} taken from the reference${guessed > 0 ? `, and ${guessed} worked out from whether the value is a whole number` : ''}. The file the set came from carries none.`,
    );
  }
  if (guessed > 0) r.warnings.push(`${guessed} type(s) could not be looked up. A whole number was written as INT32 and anything else as REAL32. Check them in the ground station.`);
  if (set.autopilot === 'ardupilot') {
    r.warnings.push('These are ArduPilot parameters. QGroundControl loads this file into an ArduPilot aircraft. A PX4 aircraft has no parameters by these names.');
  }
  const notes = set.entries.filter((e) => e.note).length;
  if (notes > 0) r.dropped.push({ what: 'Notes', count: notes, why: 'the format has a value for each parameter and nowhere for a note' });
  return {
    name: `${safeFileName(set.name)}.params`,
    mime: 'text/plain',
    data: enc([...header, ...rows].join(eol) + eol),
    report: r,
  };
}

export function writeMpParam(set: ParamSet): WrittenParams {
  const r = report('mp-param');
  const rows = set.entries.map((e) => `${e.name},${valueText(e)}`);
  common(set, r, true);
  const typed = set.entries.filter((e) => e.type !== null).length;
  if (typed > 0) r.dropped.push({ what: 'Types', count: typed, why: 'the format has a name and a value, nothing else' });
  const comps = new Set(set.entries.map((e) => e.componentId));
  if (comps.size > 1) r.dropped.push({ what: 'Component ids', count: comps.size, why: 'the format does not say which component a parameter belongs to' });
  if (set.header.length > 0) r.dropped.push({ what: 'Header lines', count: set.header.length, why: 'the header is QGroundControl’s' });
  const notes = set.entries.filter((e) => e.note).length;
  if (notes > 0) r.dropped.push({ what: 'Notes', count: notes, why: 'the format has nowhere for a note' });
  if (set.autopilot !== 'ardupilot') {
    r.warnings.push(
      `These are parameters of ${whose(set)}. Writing them in Mission Planner’s format does not make them ArduPilot parameters: ArduPilot has no parameters by these names, and there is no table that turns one autopilot’s names into the other’s.`,
    );
  }
  return {
    name: `${safeFileName(set.name)}.param`,
    mime: 'text/plain',
    data: enc(rows.join(set.eol) + set.eol),
    report: r,
  };
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeParamsCsv(set: ParamSet, reference: ParamReference | null = null): WrittenParams {
  const r = report('csv');
  const head = ['name', 'value', 'unit', 'value_means', 'group', 'firmware_default', 'lowest', 'highest', 'mavlink_type', 'changed_here', 'note', 'what_it_is'];
  const rows = set.entries.map((e) => {
    const m = reference?.parameters[e.name];
    return [
      e.name,
      valueText(e),
      m?.unit ?? '',
      valueMeaning(e.value, m) ?? '',
      groupOf(e.name, reference),
      m?.default ?? '',
      m?.min ?? '',
      m?.max ?? '',
      e.type ?? '',
      isEdited(e) ? 'yes' : '',
      e.note ?? '',
      m?.short ?? '',
    ]
      .map(cell)
      .join(',');
  });
  common(set, r, false);
  if (set.header.length > 0) r.dropped.push({ what: 'Header lines', count: set.header.length, why: 'a table holds rows' });
  r.warnings.push('No ground station loads this file. It is for a spreadsheet.');
  if (reference) r.kept.push(`Descriptions, units, limits and defaults from the ${reference.firmware} reference (${reference.licence}).`);
  return {
    name: `${safeFileName(set.name)}.csv`,
    mime: 'text/csv',
    data: enc([head.join(','), ...rows].join('\n') + '\n'),
    report: r,
  };
}

/** The set as a document a person or an assistant can read without the reference to hand. */
export function paramsDocument(set: ParamSet, reference: ParamReference | null = null): Record<string, unknown> {
  const useRef = set.autopilot !== 'ardupilot' ? reference : null;
  return {
    schema: PARAMS_SCHEMA,
    about:
      'A set of autopilot parameters from the Flight Companion app. Values are numbers. Where a unit, a meaning, limits or a default are given they come from the reference named below and are that autopilot’s own words. The app never sends parameters to an aircraft.',
    name: set.name,
    autopilot: set.autopilot,
    autopilot_worked_out_from: set.autopilotFrom,
    read_from: set.source,
    read_from_file: set.sourceFile,
    file_header: {
      stack: set.stack,
      vehicle: set.vehicle,
      version: set.version,
      git_revision: set.gitRevision,
      comment_lines: set.header,
      line_ending: set.eol === '\r\n' ? 'CRLF' : 'LF',
    },
    reference: useRef
      ? { firmware: useRef.firmware, source: useRef.source, licence: useRef.licence, note: useRef.about }
      : null,
    summary: {
      parameters: set.entries.length,
      changed_here: set.entries.filter(isEdited).length,
      with_a_note: set.entries.filter((e) => e.note).length,
    },
    findings: findingsOf(set, reference).map((f) => ({
      id: f.id,
      level: f.level,
      level_means: f.level === 'critical' ? 'stop' : f.level === 'warning' ? 'check' : f.level === 'info' ? 'note' : 'good',
      title: f.title,
      detail: f.detail,
      parameters: f.names,
    })),
    parameters: set.entries.map((e) => {
      const m = useRef?.parameters[e.name];
      const f = flagsOf(e, m, set.autopilot);
      return {
        name: e.name,
        value: e.value,
        value_as_written: valueText(e),
        ...(m?.unit ? { unit: m.unit } : null),
        ...(valueMeaning(e.value, m) !== null ? { value_means: valueMeaning(e.value, m) } : null),
        ...(m ? { what_it_is: m.short, group: m.group } : { in_the_reference: false }),
        ...(m?.long ? { more: m.long } : null),
        ...(m?.default !== undefined ? { firmware_default: m.default, differs_from_firmware_default: f.notDefault } : null),
        ...(m?.min !== undefined ? { lowest: m.min } : null),
        ...(m?.max !== undefined ? { highest: m.max } : null),
        ...(f.belowMin || f.aboveMax ? { outside_limits: true } : null),
        ...(m?.reboot_required ? { takes_effect_after_restart: true } : null),
        ...(f.ardupilotLike ? { has_the_shape_of_an_ardupilot_name: true } : null),
        mavlink_type: e.type,
        mavlink_type_name: e.type === null ? null : MAV_PARAM_TYPE[e.type],
        vehicle_id: e.vehicleId,
        component_id: e.componentId,
        ...(isEdited(e) ? { value_in_the_file_it_was_read_from: e.original } : null),
        ...(e.note ? { note: e.note } : null),
      };
    }),
    notes_from_the_reader: set.notes,
  };
}

export function writeParamsJson(set: ParamSet, reference: ParamReference | null = null): WrittenParams {
  const r = report('fc-params');
  r.kept.push('Everything: values, types, the file’s header, notes, and what was changed here.');
  if (reference && set.autopilot !== 'ardupilot') {
    r.kept.push(`What each parameter is, from the ${reference.firmware} reference (${reference.licence}).`);
  }
  r.warnings.push('No ground station loads this file. It is for people, scripts and assistants.');
  return {
    name: `${safeFileName(set.name)}.params.json`,
    mime: 'application/json',
    data: enc(JSON.stringify(paramsDocument(set, reference), null, 2) + '\n'),
    report: r,
  };
}

export function writeParams(set: ParamSet, id: ParamFormatId, reference: ParamReference | null = null): WrittenParams {
  if (set.entries.length === 0) throw new ParamFormatError('The set holds no parameters to write.');
  switch (id) {
    case 'qgc-params':
      return writeQgcParams(set, reference);
    case 'mp-param':
      return writeMpParam(set);
    case 'csv':
      return writeParamsCsv(set, reference);
    case 'fc-params':
      return writeParamsJson(set, reference);
  }
}
