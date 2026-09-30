// Example parameter sets for Learn mode. Every one is BUILT HERE from the
// defaults in PX4's own reference. None is read from a real aircraft, and the
// values that differ from the defaults are there to practise on: they are not
// a configuration to load into anything.
import { detectAutopilot } from './analysis.ts';
import { emptySet, floatText, type ParamEntry, type ParamReference, type ParamSet } from './model.ts';

const GROUPS = ['Battery Calibration', 'Commander', 'Geofence', 'Return Mode', 'Mission', 'System'];

export interface ParamSample {
  id: string;
  title: string;
  shows: string;
  steps: string[];
  /** The example to compare it with, where that is the lesson. */
  compareWith?: string;
  build: (reference: ParamReference) => ParamSet;
}

function entry(name: string, value: number, float: boolean): ParamEntry {
  return {
    name,
    value,
    text: float ? floatText(value) : String(Math.round(value)),
    type: float ? 9 : 6,
    vehicleId: 1,
    componentId: 1,
  };
}

function defaults(reference: ParamReference, name: string): ParamSet {
  const set = emptySet(name);
  set.stack = 'PX4 Pro';
  set.vehicle = 'Multi-Rotor';
  set.version = reference.firmware.replace(/^PX4 v?/, '');
  set.entries = Object.entries(reference.parameters)
    .filter(([, m]) => GROUPS.includes(m.group) && m.default !== undefined)
    .map(([n, m]) => entry(n, m.default as number, m.type === 'FLOAT'))
    .sort((a, b) => a.name.localeCompare(b.name));
  set.notes.push(
    `An example made by this app from the defaults in the ${reference.firmware} reference: the groups ${GROUPS.join(', ')}. It was not read from an aircraft.`,
  );
  const found = detectAutopilot(set, reference);
  set.autopilot = found.autopilot;
  set.autopilotFrom = 'the example says so';
  return set;
}

function withValues(set: ParamSet, values: Record<string, number>, reference: ParamReference): ParamSet {
  const left = { ...values };
  set.entries = set.entries.map((e) => {
    if (!(e.name in left)) return e;
    const v = left[e.name];
    delete left[e.name];
    return entry(e.name, v, e.type === 9);
  });
  // a name the defaults do not have is added at the end, as a file edited by hand would have it
  for (const [name, v] of Object.entries(left)) {
    const m = reference.parameters[name];
    set.entries.push(entry(name, v, m ? m.type === 'FLOAT' : !Number.isInteger(v)));
  }
  return set;
}

/** The values the "after a bench session" example differs by. Example values, not advice. */
export const BENCH_CHANGES: Record<string, number> = {
  BAT1_N_CELLS: 4,
  BAT1_CAPACITY: 5000,
  BAT_LOW_THR: 0.3,
  BAT_CRIT_THR: 0.2,
  COM_LOW_BAT_ACT: 3,
};

export const PARAM_SAMPLES: ParamSample[] = [
  {
    id: 'defaults',
    title: 'Firmware defaults',
    shows: 'Six groups of PX4 parameters, each at the value the firmware starts with.',
    steps: [
      'Select BAT1_N_CELLS. The Parameter page says what it is, in PX4’s own words, and lists what each value means.',
      'Its value is 0, which means "Unknown". The autopilot cannot work out how full a battery is until it is told how many cells it has.',
      'Find a parameter marked "restart". A change to it does nothing until the autopilot is switched off and on.',
      'Open the File view. One row per parameter: two ids, the name, the value, and a number for the type. 6 is a whole number, 9 a decimal.',
    ],
    build: (reference) => defaults(reference, 'Firmware defaults'),
  },
  {
    id: 'after-bench',
    title: 'After a bench session',
    shows: 'The same set with five values changed. The lesson is finding which five.',
    compareWith: 'defaults',
    steps: [
      'Open the Compare view. It is compared with the example "Firmware defaults".',
      'Five rows differ. Every other parameter is the same in both, and is not shown.',
      'This is how a change is checked on a real aircraft: save the parameters before, save them after, compare the two files, and explain every row that moved.',
      'A row you cannot explain is the one to look into.',
    ],
    build: (reference) => withValues(defaults(reference, 'After a bench session'), BENCH_CHANGES, reference),
  },
  {
    id: 'wrong-names',
    title: 'Names from another autopilot',
    shows: 'A PX4 set with three ArduPilot names in it, as happens when notes from one autopilot are used on the other.',
    steps: [
      'Open Findings in the tools drawer. The first one says Stop.',
      'FRAME_CLASS, SERIAL1_PROTOCOL and BATT_MONITOR are ArduPilot parameters. PX4 has none by those names.',
      'There is no table that turns one into the other. What each setting was for still stands; the PX4 parameter that does it has to be looked up in PX4’s documentation.',
      'Filter the list to "Flagged" to see only those three.',
    ],
    build: (reference) =>
      withValues(defaults(reference, 'Names from another autopilot'), { FRAME_CLASS: 1, SERIAL1_PROTOCOL: 2, BATT_MONITOR: 4 }, reference),
  },
  {
    id: 'outside',
    title: 'A value outside its limits',
    shows: 'One threshold typed as a percentage where PX4 wants a fraction.',
    steps: [
      'Open Findings. One value is outside the limits the reference gives.',
      'BAT_CRIT_THR is 20. Its unit is "norm": a fraction from 0 to 1, so 20 % is written 0.2.',
      'Select it and type 0.2. The finding clears, and the row is marked as changed here.',
      '"Put back" on the Parameter page returns it to the value the file had.',
    ],
    build: (reference) => withValues(defaults(reference, 'A value outside its limits'), { BAT_CRIT_THR: 20 }, reference),
  },
];

export function paramSampleById(id: string): ParamSample | undefined {
  return PARAM_SAMPLES.find((s) => s.id === id);
}

/** How to read each format's file, for the File view in Learn mode. */
export const PARAM_FORMAT_READING = {
  'qgc-params': [
    'Lines that begin with # are comments. The first few say which autopilot and which version wrote the file.',
    'Every other line is one parameter, five fields separated by tabs: vehicle id, component id, name, value, type.',
    'The type is a MAVLink number: 6 is INT32, a whole number; 9 is REAL32, a decimal with about seven digits.',
    'A value such as 5.2e+03 is 5.2 times 10 to the power 3: 5200.',
    'QGroundControl writes this file from Parameters, Tools, Save to file, and reads it with Load from file.',
  ],
  'mp-param': [
    'A name, a comma, a value. One parameter to a line.',
    'There is no type and no header, so the file does not say which autopilot it is for.',
    'Mission Planner writes this from the Full Parameter List, Save to file.',
  ],
  csv: [
    'One row per parameter. Any spreadsheet opens it.',
    'Beside each value: its unit, what the value means, the firmware’s default and the limits.',
    'Sort by the group column to read related parameters together.',
  ],
  'fc-params': [
    'This app’s own format. Each parameter carries what it is, its unit, its limits and whether it differs from the default.',
    '"findings" at the top is what the app noticed about the set as a whole.',
    'It is written so that a person, a script or an AI assistant can read it without the reference to hand.',
    'No ground station loads it. To load parameters, write a QGroundControl or Mission Planner file.',
  ],
} as const;
