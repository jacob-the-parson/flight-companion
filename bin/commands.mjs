// The commands of Flight Companion, as functions. bin/fc.mjs runs them from a
// terminal and mcp/files/server.mjs offers them to an assistant as MCP tools:
// one set of functions, two ways in.
//
// Each command takes { positional, options } and returns one JSON document, or
// throws a Refusal that says in words what is wrong. They read files and write
// a file ONLY where options.out (or a folder argument) says. None of them opens
// a serial port, a socket or a network connection.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// Named one by one, not found by path at run time, so that the whole of this can
// be made into a single file for the desktop app (desktop/build.mjs).
import * as missionBrief from '../lib/mission/brief.ts';
import * as missionChecks from '../lib/mission/checks.ts';
import * as missionFormats from '../lib/mission/formats.ts';
import * as missionModel from '../lib/mission/model.ts';
import * as missionSamples from '../lib/mission/samples.ts';
import * as paramsAnalysis from '../lib/params/analysis.ts';
import * as paramsCodecs from '../lib/params/codecs.ts';
import * as paramsLookup from '../lib/params/lookup.ts';
import * as paramsSamples from '../lib/params/samples.ts';
import * as ulogAnalysis from '../lib/ulog/analysis.ts';
import * as ulogBrief from '../lib/ulog/brief.ts';
import * as ulogParser from '../lib/ulog/parser.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = {
  'mission/brief.ts': missionBrief,
  'mission/checks.ts': missionChecks,
  'mission/formats.ts': missionFormats,
  'mission/model.ts': missionModel,
  'mission/samples.ts': missionSamples,
  'params/analysis.ts': paramsAnalysis,
  'params/codecs.ts': paramsCodecs,
  'params/lookup.ts': paramsLookup,
  'params/samples.ts': paramsSamples,
  'ulog/analysis.ts': ulogAnalysis,
  'ulog/brief.ts': ulogBrief,
  'ulog/parser.ts': ulogParser,
};
const lib = async (p) => LIB[p];

export class Refusal extends Error {}

export const HELP = {
  schema: 'flight-companion/cli-help@1',
  about:
    'Flight Companion from a terminal. Every command prints one JSON document on standard output. An error prints {"error": ...} on standard error and exits with 1. Nothing here can reach an aircraft.',
  usage: 'node bin/fc.mjs <command> [arguments] [options]',
  commands: {
    help: 'This document.',
    formats: 'Every file format that is read or written, what it holds and where its definition was taken from.',
    'log <file.ulg>': 'A PX4 flight log: numbers, findings, flight modes, messages, parameters not at their default. Options: --with-place, --messages <n>.',
    'mission <file>': 'A mission in any format read: every item in words, the checks, and what each format would keep or drop.',
    'mission-check <file>': 'The checks only.',
    'mission-convert <file> --to <format> --out <file>': 'Write the mission in another format. Prints what was kept, changed and dropped. For dji-wpml add --dji <aircraft>.',
    'params <file>': 'A parameter file: every parameter with what it is, its unit, limits and default, and what stands out. Options: --only <changed|flagged|not-default>, --find <text>.',
    'params-diff <file> <other>': 'What differs between two parameter files, each row with what the parameter is.',
    'params-convert <file> --to <format> --out <file>': 'Write the parameters in another format.',
    'explain <NAME> [<NAME> ...]': 'What PX4 says a parameter is: description, unit, limits, default, listed values.',
    'search <text>': 'Parameters in the PX4 reference whose name or description has the text.',
    samples: 'The example missions and parameter sets the app teaches with.',
    'samples-write <folder>': 'Write every example in every format into a folder.',
  },
  mission_formats: 'qgc-plan, qgc-wpl, dji-wpml, garmin-fpl, kml, gpx, csv, fc-mission',
  parameter_formats: 'qgc-params, mp-param, csv, fc-params',
  rules: [
    'Parameter descriptions, limits and defaults are PX4\'s own, for PX4 v1.16.0. The tool holds no ArduPilot reference.',
    'The tool never says what a parameter should be set to, and never offers one autopilot\'s name for another\'s.',
    'A mission or a parameter file reaches an aircraft only when a person loads it in a ground station.',
  ],
};

export function parse(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) options[key] = true;
      else {
        options[key] = next;
        i += 1;
      }
    } else positional.push(a);
  }
  return { positional, options };
}

function bytesOf(path) {
  if (!path) throw new Refusal('Name the file to read.');
  const full = resolve(path);
  if (!existsSync(full)) throw new Refusal(`There is no file at ${full}`);
  if (statSync(full).isDirectory()) throw new Refusal(`${full} is a folder. Name a file.`);
  return new Uint8Array(readFileSync(full));
}

function writeOut(out, data) {
  if (typeof out !== 'string') throw new Refusal('Say where to write the file with --out <file>.');
  const full = resolve(out);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
  return full;
}

let cachedReference = null;
export function reference() {
  if (!cachedReference) {
    // beside the app's folder, unless the desktop app says where it has put it
    const at = process.env.FC_REFERENCE || join(HERE, '..', 'public', 'data', 'px4-v1.16.0-parameters.json');
    cachedReference = JSON.parse(readFileSync(at, 'utf8'));
  }
  return cachedReference;
}

export const COMMANDS = {
  help: async () => HELP,

  formats: async () => {
    const { FORMATS } = await lib('mission/formats.ts');
    const { PARAM_FORMATS } = await lib('params/codecs.ts');
    return {
      schema: 'flight-companion/formats@1',
      logs: [{ id: 'ulog', label: 'PX4 flight log', extensions: ['ulg'], read: true, written: false, source: 'docs.px4.io, "ULog File Format"' }],
      missions: FORMATS.map((f) => ({ id: f.id, label: f.label, extensions: f.extensions, read: true, written: true, an_aircraft_can_fly_it: f.flyable, holds: f.holds, used_by: f.usedBy, about: f.about, source: f.source })),
      parameters: PARAM_FORMATS.map((f) => ({ id: f.id, label: f.label, extensions: f.extensions, read: true, written: true, a_ground_station_can_load_it: f.loadable, used_by: f.usedBy, about: f.about, source: f.source })),
    };
  },

  log: async ({ positional, options }) => {
    const { ULog } = await lib('ulog/parser.ts');
    const { summarize } = await lib('ulog/analysis.ts');
    const { logBrief } = await lib('ulog/brief.ts');
    const bytes = bytesOf(positional[0]);
    let summary;
    try {
      summary = summarize(new ULog(Buffer.from(bytes)));
    } catch (e) {
      throw new Refusal(`The log could not be read: ${e.message}`);
    }
    return logBrief(basename(positional[0]), summary, {
      withPlace: options['with-place'] === true,
      maxMessages: options.messages ? Number(options.messages) : undefined,
    });
  },

  mission: async ({ positional, options }) => {
    const { readMission } = await lib('mission/formats.ts');
    const { missionBrief } = await lib('mission/brief.ts');
    const mission = readMission(bytesOf(positional[0]), basename(positional[0]));
    return missionBrief(mission, typeof options.dji === 'string' ? options.dji : null);
  },

  'mission-check': async ({ positional }) => {
    const { readMission } = await lib('mission/formats.ts');
    const { checkMission } = await lib('mission/checks.ts');
    const { missionStats } = await lib('mission/model.ts');
    const mission = readMission(bytesOf(positional[0]), basename(positional[0]));
    const s = missionStats(mission);
    return {
      schema: 'flight-companion/mission-checks@1',
      file: basename(positional[0]),
      read_as: mission.source,
      items: s.items,
      waypoints: s.waypoints,
      length_m: Math.round(s.lengthM * 10) / 10,
      checks: checkMission(mission).map((c) => ({ id: c.id, level: c.level, title: c.title, detail: c.detail, item_numbers: c.items ?? [] })),
      notes_from_the_reader: mission.notes,
    };
  },

  'mission-convert': async ({ positional, options }) => {
    const { readMission, writeMission, formatById } = await lib('mission/formats.ts');
    if (typeof options.to !== 'string') throw new Refusal(`Say the format to write with --to. One of: ${HELP.mission_formats}.`);
    formatById(options.to);
    const mission = readMission(bytesOf(positional[0]), basename(positional[0]));
    const file = writeMission(mission, options.to, { djiAircraft: typeof options.dji === 'string' ? options.dji : undefined });
    const written = writeOut(options.out, file.data);
    return { schema: 'flight-companion/written@1', read: basename(positional[0]), read_as: mission.source, written, written_as: options.to, bytes: file.data.length, report: file.report };
  },

  params: async ({ positional, options }) => {
    const { readParams, paramsDocument } = await lib('params/codecs.ts');
    const ref = reference();
    const set = readParams(bytesOf(positional[0]), basename(positional[0]), ref);
    const doc = paramsDocument(set, ref);
    let list = doc.parameters;
    if (options.only === 'changed') list = list.filter((p) => 'value_in_the_file_it_was_read_from' in p);
    else if (options.only === 'not-default') list = list.filter((p) => p.differs_from_firmware_default === true);
    else if (options.only === 'flagged') list = list.filter((p) => p.outside_limits || p.has_the_shape_of_an_ardupilot_name || p.in_the_reference === false);
    else if (options.only !== undefined) throw new Refusal('--only takes one of: changed, flagged, not-default.');
    if (typeof options.find === 'string') {
      const q = options.find.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.what_it_is ?? '').toLowerCase().includes(q) || (p.group ?? '').toLowerCase().includes(q));
    }
    return { ...doc, parameters_shown: list.length, parameters: list };
  },

  'params-diff': async ({ positional }) => {
    const { readParams } = await lib('params/codecs.ts');
    const { diffSets, valueMeaning } = await lib('params/analysis.ts');
    const ref = reference();
    const here = readParams(bytesOf(positional[0]), basename(positional[0]), ref);
    const there = readParams(bytesOf(positional[1]), basename(positional[1] ?? ''), ref);
    const d = diffSets(here, there);
    const meta = (name) => (here.autopilot === 'ardupilot' ? undefined : ref.parameters[name]);
    return {
      schema: 'flight-companion/params-diff@1',
      about: 'How the first file differs from the second. "in_first" and "in_second" are the values; null means the file does not have the parameter.',
      first: { file: basename(positional[0]), autopilot: here.autopilot, version: here.version?.trim() ?? null, parameters: here.entries.length },
      second: { file: basename(positional[1]), autopilot: there.autopilot, version: there.version?.trim() ?? null, parameters: there.entries.length },
      the_same: d.same,
      different: d.changed,
      only_in_first: d.onlyHere,
      only_in_second: d.onlyThere,
      rows: d.rows.map((r) => {
        const m = meta(r.name);
        return {
          name: r.name,
          how: r.kind === 'changed' ? 'different' : r.kind === 'only-here' ? 'only in first' : 'only in second',
          in_first: r.here,
          in_second: r.there,
          ...(r.here !== null && valueMeaning(r.here, m) ? { in_first_means: valueMeaning(r.here, m) } : null),
          ...(r.there !== null && valueMeaning(r.there, m) ? { in_second_means: valueMeaning(r.there, m) } : null),
          ...(m ? { what_it_is: m.short, ...(m.unit ? { unit: m.unit } : null), ...(m.reboot_required ? { takes_effect_after_restart: true } : null) } : { in_the_reference: false }),
        };
      }),
    };
  },

  'params-convert': async ({ positional, options }) => {
    const { readParams, writeParams, paramFormatById } = await lib('params/codecs.ts');
    if (typeof options.to !== 'string') throw new Refusal(`Say the format to write with --to. One of: ${HELP.parameter_formats}.`);
    paramFormatById(options.to);
    const ref = reference();
    const set = readParams(bytesOf(positional[0]), basename(positional[0]), ref);
    const file = writeParams(set, options.to, ref);
    const written = writeOut(options.out, file.data);
    return { schema: 'flight-companion/written@1', read: basename(positional[0]), read_as: set.source, written, written_as: options.to, bytes: file.data.length, report: file.report };
  },

  explain: async ({ positional }) => {
    if (positional.length === 0) throw new Refusal('Name one or more parameters.');
    const { explainParameters } = await lib('params/lookup.ts');
    return explainParameters(positional, reference());
  },

  search: async ({ positional }) => {
    const q = positional.join(' ').trim();
    if (q === '') throw new Refusal('Give the text to look for.');
    const { searchParameters } = await lib('params/lookup.ts');
    return searchParameters(q, reference());
  },

  samples: async () => {
    const { MISSION_SAMPLES } = await lib('mission/samples.ts');
    const { PARAM_SAMPLES } = await lib('params/samples.ts');
    return {
      schema: 'flight-companion/samples@1',
      about: 'The examples the app teaches with. Every one is made by the app: the missions around the default home of PX4\'s simulator, the parameter sets from the defaults in PX4\'s reference. None is a recording of a real flight or was read from an aircraft.',
      missions: MISSION_SAMPLES.map((s) => ({ id: s.id, title: s.title, shows: s.shows, look_at: s.lookAt, steps: s.steps })),
      parameter_sets: PARAM_SAMPLES.map((s) => ({ id: s.id, title: s.title, shows: s.shows, compare_with: s.compareWith ?? null, steps: s.steps })),
    };
  },

  'samples-write': async ({ positional }) => {
    if (!positional[0]) throw new Refusal('Name the folder to write the examples into.');
    const { MISSION_SAMPLES } = await lib('mission/samples.ts');
    const { PARAM_SAMPLES } = await lib('params/samples.ts');
    const { FORMATS } = await lib('mission/formats.ts');
    const { tryWrite } = await lib('mission/brief.ts');
    const { PARAM_FORMATS, writeParams } = await lib('params/codecs.ts');
    const ref = reference();
    const root = resolve(positional[0]);
    const written = [];
    const skipped = [];
    for (const s of MISSION_SAMPLES) {
      const mission = s.build();
      for (const f of FORMATS) {
        // a DJI route is made for one model; the examples are written for the Mavic 3E
        const attempt = tryWrite(mission, f.id, f.id === 'dji-wpml' ? 'm3e' : null);
        if (!attempt.ok) {
          skipped.push({ example: s.id, format: f.id, why: attempt.reason });
          continue;
        }
        const path = join(root, 'missions', s.id, `${s.id}.${f.extensions[0]}`);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, attempt.file.data);
        written.push(path);
      }
    }
    for (const s of PARAM_SAMPLES) {
      const set = s.build(ref);
      for (const f of PARAM_FORMATS) {
        const file = writeParams(set, f.id, ref);
        const path = join(root, 'parameters', s.id, `${s.id}.${f.extensions[0]}`);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, file.data);
        written.push(path);
      }
    }
    const readme = [
      '# Examples',
      '',
      'Written by `node bin/fc.mjs samples-write`. Every file here is made by the app.',
      '',
      '- The missions are built around the default home of PX4\'s simulator, a field near Zurich.',
      '  None is a recording of a real flight, and none holds a real flying site.',
      `- The parameter sets are built from the defaults in the ${ref.firmware} parameter reference`,
      `  (${ref.licence}). None was read from an aircraft, and none is a configuration to load.`,
      '- DJI routes are written for the Mavic 3E. No file here has been opened in DJI Pilot 2 or on a',
      '  Garmin device.',
      '',
      'Run `node bin/fc.mjs samples` for what each example is there to show.',
      '',
    ].join('\n');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'README.md'), readme);
    return { schema: 'flight-companion/samples-written@1', folder: root, files: written.length, skipped, written };
  },
};

/** True for an error that says in words what is wrong, as opposed to a fault in the tool. */
export function isRefusal(e) {
  return e instanceof Refusal || /FormatError$/.test(e?.constructor?.name ?? '');
}
