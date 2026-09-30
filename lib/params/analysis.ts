// What can be said about a set of parameters: whose they are, which ones the
// reference does not know, which are outside the limits the reference gives,
// and how two sets differ.
//
// The rule this file keeps: it never says what a parameter SHOULD be, and it
// never offers one autopilot's name for another's. PX4 and ArduPilot do not
// share parameter names and there is no table that turns one into the other.
import {
  isEdited,
  isFloatType,
  prefixOf,
  sameValue,
  type Autopilot,
  type ParamEntry,
  type ParamMeta,
  type ParamReference,
  type ParamSet,
} from './model.ts';

/**
 * Shapes of name that ArduPilot uses. A name is only ever called
 * ArduPilot-like when it matches one of these AND PX4's reference does not
 * have it, so a PX4 parameter is never flagged by its shape alone.
 */
const ARDUPILOT_SHAPES: RegExp[] = [
  /^SERIAL\d+_(PROTOCOL|BAUD|OPTIONS)$/,
  /^BRD_/,
  /^NTF_/,
  /^GPS_AUTO_SWITCH$/,
  /^FRAME_(CLASS|TYPE)$/,
  /^INS_/,
  /^ATC_/,
  /^PRX\d*_/,
  /^BATT\d*_/,
  /^ARMING_/,
  /^AHRS_/,
  /^EK[23]_/,
  /^PSC_/,
  /^WPNAV_/,
  /^FLTMODE\d/,
  /^FS_/,
  /^SERVO\d+_/,
  /^RC\d+_(MIN|MAX|TRIM|REVERSED|OPTION|DZ)$/,
  /^MOT_/,
  /^SR\d_/,
  /^LOG_BITMASK$/,
  /^SCHED_/,
  /^COMPASS_/,
];

export function looksLikeArduPilot(name: string): boolean {
  return ARDUPILOT_SHAPES.some((r) => r.test(name));
}

export function detectAutopilot(
  set: Pick<ParamSet, 'stack' | 'entries'>,
  reference: ParamReference | null,
): { autopilot: Autopilot; from: string } {
  const stack = (set.stack ?? '').toLowerCase();
  if (stack.includes('px4')) return { autopilot: 'px4', from: `the file's header says "${set.stack}"` };
  if (stack.includes('ardu') || stack.includes('apm')) {
    return { autopilot: 'ardupilot', from: `the file's header says "${set.stack}"` };
  }
  const n = set.entries.length;
  if (n === 0) return { autopilot: 'unknown', from: 'the file holds no parameters' };
  const ardu = set.entries.filter((e) => looksLikeArduPilot(e.name)).length;
  if (reference) {
    const known = set.entries.filter((e) => e.name in reference.parameters).length;
    if (known / n >= 0.6) {
      return { autopilot: 'px4', from: `${known} of its ${n} names are in the ${reference.firmware} reference` };
    }
    if (ardu / n >= 0.2 && ardu > known) {
      return { autopilot: 'ardupilot', from: `${ardu} of its ${n} names have the shape of ArduPilot names, and ${known} are PX4 names` };
    }
    return { autopilot: 'unknown', from: `${known} of its ${n} names are PX4 names and ${ardu} have the shape of ArduPilot names` };
  }
  if (ardu / n >= 0.2) return { autopilot: 'ardupilot', from: `${ardu} of its ${n} names have the shape of ArduPilot names` };
  return { autopilot: 'unknown', from: 'the file does not say, and the PX4 reference is not loaded' };
}

export interface ParamFlags {
  /** PX4's reference has this name. */
  known: boolean;
  /** Not in PX4's reference, and shaped like an ArduPilot name. */
  ardupilotLike: boolean;
  belowMin: boolean;
  aboveMax: boolean;
  /** The reference lists the values that mean something, and this is not one. */
  notListed: boolean;
  /** Differs from the firmware's default. Choosing an airframe does this to many. */
  notDefault: boolean;
  /** The file's type is not the reference's. */
  typeDiffers: boolean;
  edited: boolean;
  reboot: boolean;
}

const NO_FLAGS: ParamFlags = {
  known: false,
  ardupilotLike: false,
  belowMin: false,
  aboveMax: false,
  notListed: false,
  notDefault: false,
  typeDiffers: false,
  edited: false,
  reboot: false,
};

/**
 * The reference's word for a value, where it lists values. PX4 writes the keys
 * of a decimal parameter as "1.0" and "-1.0", so they are compared as numbers.
 */
export function listedLabel(value: number, meta: ParamMeta | undefined): string | null {
  if (!meta?.values) return null;
  for (const [key, label] of Object.entries(meta.values)) {
    if (Number(key) === value) return label;
  }
  return null;
}

export function flagsOf(e: ParamEntry, meta: ParamMeta | undefined, autopilot: Autopilot): ParamFlags {
  const edited = isEdited(e);
  if (!meta) {
    return { ...NO_FLAGS, edited, ardupilotLike: autopilot !== 'ardupilot' && looksLikeArduPilot(e.name) };
  }
  const float = meta.type === 'FLOAT';
  // a limit is compared as the aircraft stores it, so 0.3 is not "above 0.3"
  const v = float ? Math.fround(e.value) : e.value;
  const below = meta.min !== undefined && v < (float ? Math.fround(meta.min) : meta.min);
  const above = meta.max !== undefined && v > (float ? Math.fround(meta.max) : meta.max);
  return {
    known: true,
    ardupilotLike: false,
    belowMin: below,
    aboveMax: above,
    notListed: meta.values !== undefined && listedLabel(e.value, meta) === null,
    notDefault: meta.default !== undefined && !sameValue(e.value, meta.default, float ? 9 : 6),
    typeDiffers: e.type !== null && isFloatType(e.type) !== float,
    edited,
    reboot: meta.reboot_required === true,
  };
}

/** What a value means, in the reference's own words, where it gives any. */
export function valueMeaning(value: number, meta: ParamMeta | undefined): string | null {
  if (!meta) return null;
  const label = listedLabel(value, meta);
  if (label !== null) return label;
  if (meta.bits && Number.isInteger(value) && value >= 0) {
    const on = Object.entries(meta.bits)
      .filter(([bit]) => (Math.floor(value / 2 ** Number(bit)) & 1) === 1)
      .map(([, label]) => label);
    return on.length > 0 ? on.join(' + ') : 'nothing switched on';
  }
  return null;
}

export type FindingLevel = 'critical' | 'warning' | 'info' | 'good';

export interface ParamFinding {
  id: string;
  level: FindingLevel;
  title: string;
  detail: string;
  /** The parameters the finding points at. */
  names: string[];
}

export function findingsOf(set: ParamSet, reference: ParamReference | null): ParamFinding[] {
  const out: ParamFinding[] = [];
  const names = (list: ParamEntry[]) => list.map((e) => e.name);
  if (set.entries.length === 0) {
    return [{ id: 'empty', level: 'info', title: 'The set holds no parameters', detail: 'Open a parameter file.', names: [] }];
  }

  // the same name twice, for the same component
  const seen = new Map<string, number>();
  for (const e of set.entries) {
    const key = `${e.vehicleId}/${e.componentId}/${e.name}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const twice = [...seen].filter(([, n]) => n > 1).map(([k]) => k.split('/')[2]);
  if (twice.length > 0) {
    out.push({
      id: 'twice',
      level: 'warning',
      title: `${twice.length} name${twice.length > 1 ? 's are' : ' is'} in the file more than once`,
      detail: 'A ground station loading the file sets the parameter once for each row, so the last row wins. Find out which value was meant.',
      names: twice,
    });
  }

  const foreign = set.entries.filter((e) => set.autopilot !== 'ardupilot' && looksLikeArduPilot(e.name) && !(reference && e.name in reference.parameters));
  if (foreign.length > 0 && set.autopilot === 'px4') {
    out.push({
      id: 'ardupilot-names',
      level: 'critical',
      title: `${foreign.length} name${foreign.length > 1 ? 's have' : ' has'} the shape of an ArduPilot parameter`,
      detail:
        'This is a PX4 set. PX4 has no parameter by these names and will not accept them. There is no table that turns an ArduPilot name into a PX4 one: what the setting was for still stands, and the PX4 parameter that does it has to be looked up in PX4’s documentation.',
      names: names(foreign),
    });
  }

  if (set.autopilot === 'ardupilot') {
    out.push({
      id: 'ardupilot-set',
      level: 'info',
      title: 'These are ArduPilot parameters',
      detail:
        'The app holds PX4’s parameter reference and none for ArduPilot, so it can list, compare, edit and write these and cannot describe them or check their limits.',
      names: [],
    });
  }

  if (!reference) {
    out.push({
      id: 'no-reference',
      level: 'info',
      title: 'The PX4 reference is not loaded',
      detail: 'Descriptions, limits and defaults come from it. Without it the parameters can still be listed, compared, edited and written.',
      names: [],
    });
  } else if (set.autopilot !== 'ardupilot') {
    const flagged = set.entries.map((e) => ({ e, f: flagsOf(e, reference.parameters[e.name], set.autopilot) }));
    const unknown = flagged.filter((x) => !x.f.known && !x.f.ardupilotLike);
    if (unknown.length > 0) {
      out.push({
        id: 'unknown',
        level: set.autopilot === 'px4' ? 'info' : 'warning',
        title: `${unknown.length} name${unknown.length > 1 ? 's are' : ' is'} not in the ${reference.firmware} reference`,
        detail:
          'The reference lists the parameters PX4 documents for that release. A board can have a few more: a parameter of a driver or a build option. If the set is from another release, names may have changed between the two.',
        names: names(unknown.map((x) => x.e)),
      });
    }
    const outside = flagged.filter((x) => x.f.belowMin || x.f.aboveMax);
    if (outside.length > 0) {
      out.push({
        id: 'outside',
        level: 'warning',
        title: `${outside.length} value${outside.length > 1 ? 's are' : ' is'} outside the limits the reference gives`,
        detail:
          'PX4 gives a lowest and highest value for many parameters. A ground station may refuse a value outside them, or the autopilot may hold it to the limit.',
        names: names(outside.map((x) => x.e)),
      });
    }
    const unlisted = flagged.filter((x) => x.f.notListed);
    if (unlisted.length > 0) {
      out.push({
        id: 'not-listed',
        level: 'warning',
        title: `${unlisted.length} value${unlisted.length > 1 ? 's are' : ' is'} not among the ones the reference lists`,
        detail: 'For these parameters PX4 lists each value that means something. These values are not on the list.',
        names: names(unlisted.map((x) => x.e)),
      });
    }
    const typed = flagged.filter((x) => x.f.typeDiffers);
    if (typed.length > 0) {
      out.push({
        id: 'type',
        level: 'warning',
        title: `${typed.length} parameter${typed.length > 1 ? 's have' : ' has'} a different type in the file than in the reference`,
        detail: 'A whole number where the reference has a decimal, or the other way round. The file may be from a different release.',
        names: names(typed.map((x) => x.e)),
      });
    }
    const moved = flagged.filter((x) => x.f.notDefault);
    if (moved.length > 0) {
      out.push({
        id: 'not-default',
        level: 'info',
        title: `${moved.length} differ from the firmware’s defaults`,
        detail:
          'That is expected. Choosing an airframe changes many parameters from the firmware’s defaults, and so does every calibration. To see what a person changed, compare two files saved before and after.',
        names: names(moved.map((x) => x.e)),
      });
    }
    const version = set.version?.trim();
    if (version && !reference.firmware.includes(version)) {
      out.push({
        id: 'version',
        level: 'warning',
        title: `The file is from version ${version}, the reference is ${reference.firmware}`,
        detail: 'Descriptions, limits and defaults shown here are those of the reference’s release and may differ from the file’s.',
        names: [],
      });
    }
  }

  const edited = set.entries.filter(isEdited);
  if (edited.length > 0) {
    const reboot = reference ? edited.filter((e) => reference.parameters[e.name]?.reboot_required) : [];
    out.push({
      id: 'edited',
      level: 'info',
      title: `${edited.length} value${edited.length > 1 ? 's were' : ' was'} changed here`,
      detail: `The file on disk is not touched until you download a new one.${reboot.length > 0 ? ` ${reboot.length} of them take effect only after the autopilot restarts.` : ''}`,
      names: names(edited),
    });
  }

  if (!out.some((f) => f.level === 'critical' || f.level === 'warning')) {
    out.unshift({
      id: 'ok',
      level: 'good',
      title: 'Nothing stands out',
      detail: 'Every name is known, and every value is inside the limits the reference gives. That says the file is well formed. It does not say the aircraft is set up correctly.',
      names: [],
    });
  }
  const order: FindingLevel[] = ['critical', 'warning', 'info', 'good'];
  return out.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
}

export interface ParamDiffRow {
  name: string;
  kind: 'changed' | 'only-here' | 'only-there';
  here: number | null;
  there: number | null;
  hereText: string | null;
  thereText: string | null;
}

export interface ParamDiff {
  rows: ParamDiffRow[];
  same: number;
  changed: number;
  onlyHere: number;
  onlyThere: number;
}

/** How this set differs from another. "Here" is the open set, "there" the one it is compared with. */
export function diffSets(here: ParamSet, there: ParamSet): ParamDiff {
  const key = (e: ParamEntry) => `${e.componentId}/${e.name}`;
  const other = new Map(there.entries.map((e) => [key(e), e]));
  const rows: ParamDiffRow[] = [];
  let same = 0;
  const met = new Set<string>();
  for (const e of here.entries) {
    const o = other.get(key(e));
    met.add(key(e));
    if (!o) {
      rows.push({ name: e.name, kind: 'only-here', here: e.value, there: null, hereText: String(e.value), thereText: null });
    } else if (sameValue(e.value, o.value, e.type ?? o.type)) {
      same += 1;
    } else {
      rows.push({ name: e.name, kind: 'changed', here: e.value, there: o.value, hereText: String(e.value), thereText: String(o.value) });
    }
  }
  for (const o of there.entries) {
    if (!met.has(key(o))) {
      rows.push({ name: o.name, kind: 'only-there', here: null, there: o.value, hereText: null, thereText: String(o.value) });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return {
    rows,
    same,
    changed: rows.filter((r) => r.kind === 'changed').length,
    onlyHere: rows.filter((r) => r.kind === 'only-here').length,
    onlyThere: rows.filter((r) => r.kind === 'only-there').length,
  };
}

/** The group a parameter is listed under: the reference's, else the start of its name. */
export function groupOf(name: string, reference: ParamReference | null): string {
  return reference?.parameters[name]?.group ?? `${prefixOf(name)} (not in the reference)`;
}
