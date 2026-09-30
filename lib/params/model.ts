// A set of parameters, whatever file it came from. A parameter is a name and a
// number. What the number MEANS is not in the file: it is in the autopilot's
// own reference, which this app reads from PX4's documentation and never
// writes itself.
//
// This app reads parameter files and writes them. It never sends a parameter
// to an aircraft: that is done by a person, in the ground station.

export type ParamFormatId = 'qgc-params' | 'mp-param' | 'csv' | 'fc-params';
export type Autopilot = 'px4' | 'ardupilot' | 'unknown';

/** MAVLink's MAV_PARAM_TYPE, the number in the last column of a QGroundControl file. */
export const MAV_PARAM_TYPE: Record<number, string> = {
  1: 'UINT8',
  2: 'INT8',
  3: 'UINT16',
  4: 'INT16',
  5: 'UINT32',
  6: 'INT32',
  7: 'UINT64',
  8: 'INT64',
  9: 'REAL32',
  10: 'REAL64',
};

export function isFloatType(type: number | null): boolean {
  return type === 9 || type === 10;
}

export interface ParamEntry {
  name: string;
  value: number;
  /** The value exactly as the file wrote it. An unedited value is written back as this. */
  text: string;
  /** MAV_PARAM_TYPE, where the file gives one. */
  type: number | null;
  vehicleId: number;
  componentId: number;
  /** The value the file had, once it has been changed here. */
  original?: number;
  /** Written by the user: why it is set this way. */
  note?: string;
}

export interface ParamSet {
  name: string;
  /** The format it was read from; null for one made in the app. */
  source: ParamFormatId | null;
  sourceFile: string | null;
  autopilot: Autopilot;
  /** How the autopilot was worked out, in words. */
  autopilotFrom: string;
  /** From the file's header, where it has one. */
  stack: string | null;
  vehicle: string | null;
  version: string | null;
  gitRevision: string | null;
  /** Comment lines of the file, kept so it can be written back as it was. */
  header: string[];
  /** The line ending the file used. */
  eol: '\n' | '\r\n';
  entries: ParamEntry[];
  notes: string[];
}

/** One parameter as PX4's reference describes it. Every word and number is PX4's. */
export interface ParamMeta {
  group: string;
  type: string;
  short: string;
  long?: string;
  values?: Record<string, string>;
  bits?: Record<string, string>;
  reboot_required?: boolean;
  min?: number;
  max?: number;
  increment?: number;
  default?: number;
  default_means?: string;
  unit?: string;
}

export interface ParamReference {
  schema: string;
  firmware: string;
  source: string;
  licence: string;
  about: string;
  count: number;
  groups: string[];
  parameters: Record<string, ParamMeta>;
}

export interface ParamReport {
  format: ParamFormatId;
  kept: string[];
  dropped: { what: string; count: number; why: string }[];
  changed: string[];
  warnings: string[];
}

export interface WrittenParams {
  name: string;
  mime: string;
  data: Uint8Array;
  report: ParamReport;
}

export class ParamFormatError extends Error {}

export function emptySet(name = 'Untitled parameters'): ParamSet {
  return {
    name,
    source: null,
    sourceFile: null,
    autopilot: 'unknown',
    autopilotFrom: 'not stated',
    stack: null,
    vehicle: null,
    version: null,
    gitRevision: null,
    header: [],
    eol: '\n',
    entries: [],
    notes: [],
  };
}

/** Two values are the same parameter value if the aircraft would store the same number. */
export function sameValue(a: number, b: number, type: number | null): boolean {
  if (a === b) return true;
  if (type !== null && !isFloatType(type)) return Math.round(a) === Math.round(b);
  // a REAL32 holds about seven digits; files round it in different places.
  // Two steps of a REAL32 apart, or less, is the same stored number.
  if (Math.fround(a) === Math.fround(b)) return true;
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= scale * 2.5e-7;
}

/** The shortest text that an aircraft would read back as the same REAL32. */
export function floatText(v: number): string {
  if (!Number.isFinite(v)) return '0';
  const target = Math.fround(v);
  for (let p = 1; p <= 9; p++) {
    const t = Number(target.toPrecision(p));
    if (Math.fround(t) === target) return String(t);
  }
  return String(target);
}

export function valueText(e: ParamEntry): string {
  // untouched: exactly what the file said
  if (e.original === undefined && e.text !== '') return e.text;
  if (e.type !== null && !isFloatType(e.type)) return String(Math.round(e.value));
  return floatText(e.value);
}

export function isEdited(e: ParamEntry): boolean {
  return e.original !== undefined && !sameValue(e.original, e.value, e.type);
}

/** The part of a name before its first underscore: BAT1_N_CELLS belongs with BAT1. */
export function prefixOf(name: string): string {
  const i = name.indexOf('_');
  return i > 0 ? name.slice(0, i) : name;
}
