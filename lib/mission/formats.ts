// The register of mission formats: what each one is, what it can hold, how to
// tell a file is one, and the functions that read and write it. The screens,
// the command-line tool and any assistant all go through here.
import {
  MissionFormatError,
  type Mission,
  type MissionFormatId,
  type WrittenFile,
} from './model.ts';
import { decode } from './xml.ts';
import { readQgcPlan, writeQgcPlan } from './codecs/qgcPlan.ts';
import { looksLikeWpl, readWpl, writeWpl } from './codecs/wpl.ts';
import { looksLikeFpl, readGarminFpl, writeGarminFpl } from './codecs/garminFpl.ts';
import {
  isWpmlArchive,
  looksLikeZip,
  readDjiWpml,
  unzip,
  writeDjiWpml,
  type DjiAircraftId,
} from './codecs/djiWpml.ts';
import { looksLikeKml, readKml, readKmz, writeKml } from './codecs/kml.ts';
import { looksLikeGpx, readGpx, writeGpx } from './codecs/gpx.ts';
import { looksLikeMissionJson, readCsv, readMissionJson, writeCsv, writeMissionJson } from './codecs/plain.ts';

export type Holds = 'yes' | 'partly' | 'no';

export interface MissionFormat {
  id: MissionFormatId;
  label: string;
  /** The extension written, then others that are read. */
  extensions: string[];
  /** Who reads this file. */
  usedBy: string;
  /** One or two sentences a student can follow. */
  about: string;
  /** Where the definition of the format was taken from. */
  source: string;
  /** Can an aircraft fly it as it stands? */
  flyable: boolean;
  holds: {
    heights: Holds;
    speeds: Holds;
    commands: Holds;
    actions: Holds;
    geofence: Holds;
    names: Holds;
  };
}

export const FORMATS: MissionFormat[] = [
  {
    id: 'qgc-plan',
    label: 'QGroundControl plan',
    extensions: ['plan', 'mission'],
    usedBy: 'QGroundControl, for PX4 and ArduPilot aircraft',
    about:
      'A JSON file holding the mission, the geofence and the rally points together. Each mission item is a MAVLink command with seven parameters.',
    source: 'docs.qgroundcontrol.com, "Plan File Format", and QGroundControl’s source',
    flyable: true,
    holds: { heights: 'yes', speeds: 'yes', commands: 'yes', actions: 'partly', geofence: 'yes', names: 'no' },
  },
  {
    id: 'qgc-wpl',
    label: 'Waypoint list',
    extensions: ['waypoints', 'txt'],
    usedBy: 'Mission Planner, QGroundControl, MAVProxy and ArduPilot’s own tools',
    about:
      'A plain text table, one MAVLink command per row, twelve numbers to a row. The first line is "QGC WPL 110". Row 0 is the home position.',
    source: 'mavlink.io, "File Formats"',
    flyable: true,
    holds: { heights: 'yes', speeds: 'yes', commands: 'yes', actions: 'partly', geofence: 'no', names: 'no' },
  },
  {
    id: 'dji-wpml',
    label: 'DJI route (WPML)',
    extensions: ['kmz'],
    usedBy: 'DJI Pilot 2 and FlightHub 2, for the Matrice 30, 300, 350, 3D and Mavic 3 Enterprise lines',
    about:
      'A ZIP archive holding two XML files: a template, which is what was planned, and an execution file, which is what the aircraft flies. Built on KML.',
    source: 'DJI’s Cloud-API-Doc repository, the WPML pages',
    flyable: true,
    holds: { heights: 'yes', speeds: 'yes', commands: 'no', actions: 'yes', geofence: 'no', names: 'no' },
  },
  {
    id: 'garmin-fpl',
    label: 'Garmin flight plan',
    extensions: ['fpl'],
    usedBy: 'Garmin avionics and the tablet apps crewed-aircraft pilots use',
    about:
      'A table of named waypoints and the order to visit them. Made for crewed aircraft: it has no height to fly at, no speed and no commands.',
    source: 'Garmin’s schema, FlightPlanv1.xsd',
    flyable: false,
    holds: { heights: 'no', speeds: 'no', commands: 'no', actions: 'no', geofence: 'no', names: 'yes' },
  },
  {
    id: 'kml',
    label: 'KML',
    extensions: ['kml', 'kmz'],
    usedBy: 'Google Earth and most mapping tools. QGroundControl can save a mission as KML.',
    about: 'Shapes on a map: points, lines and areas. A way to look at a route or to hand over a field boundary.',
    source: 'OGC KML 2.2 schema',
    flyable: false,
    holds: { heights: 'partly', speeds: 'no', commands: 'no', actions: 'no', geofence: 'partly', names: 'yes' },
  },
  {
    id: 'gpx',
    label: 'GPX',
    extensions: ['gpx'],
    usedBy: 'Handheld GPS units, phone apps, most mapping tools',
    about: 'Waypoints, routes and recorded tracks. Heights are elevations above sea level.',
    source: 'GPX 1.1 schema, topografix.com',
    flyable: false,
    holds: { heights: 'partly', speeds: 'no', commands: 'no', actions: 'no', geofence: 'no', names: 'yes' },
  },
  {
    id: 'csv',
    label: 'Table (CSV)',
    extensions: ['csv'],
    usedBy: 'Spreadsheets',
    about: 'One row per item, with the unit in each column name.',
    source: 'this app',
    flyable: false,
    holds: { heights: 'yes', speeds: 'yes', commands: 'no', actions: 'no', geofence: 'no', names: 'yes' },
  },
  {
    id: 'fc-mission',
    label: 'Mission document (JSON)',
    extensions: ['mission.json', 'json'],
    usedBy: 'People, scripts and assistants',
    about: 'The whole mission in plain words and named units, with a summary. The one format that loses nothing.',
    source: 'this app, schema flight-companion/mission@1',
    flyable: false,
    holds: { heights: 'yes', speeds: 'yes', commands: 'yes', actions: 'yes', geofence: 'yes', names: 'yes' },
  },
];

export function formatById(id: MissionFormatId): MissionFormat {
  const f = FORMATS.find((x) => x.id === id);
  if (!f) throw new MissionFormatError(`Unknown format: ${id}`);
  return f;
}

/** Every extension the app opens, for a file picker. */
export const ACCEPTED_EXTENSIONS = [
  ...new Set(FORMATS.flatMap((f) => f.extensions.map((e) => `.${e.split('.').pop()}`))),
];

/** Work out what a file is from what is IN it, using its name only to break a tie. */
export function detectFormat(bytes: Uint8Array, fileName: string): MissionFormatId {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (looksLikeZip(bytes)) {
    return isWpmlArchive(unzip(bytes)) ? 'dji-wpml' : 'kml';
  }
  const head = decode(bytes.subarray(0, Math.min(bytes.length, 4096))).trimStart();
  if (head.startsWith('ULog') || ext === 'bin' || ext === 'ulg' || ext === 'tlog') {
    throw new MissionFormatError('That is a flight log, not a mission. Open it in Flight Logs.');
  }
  if (ext === 'params' || ext === 'param' || ext === 'parm' || head.startsWith('# Onboard parameters')) {
    throw new MissionFormatError('That is a parameter file, not a mission. Open it in Parameters.');
  }
  if (looksLikeWpl(head)) return 'qgc-wpl';
  if (head.startsWith('<') || head.startsWith('﻿<')) {
    if (looksLikeFpl(head)) return 'garmin-fpl';
    if (looksLikeGpx(head)) return 'gpx';
    if (looksLikeKml(head)) return 'kml';
    throw new MissionFormatError(
      'The file is XML, but not a Garmin flight plan, a KML or a GPX. Those are the XML formats this app reads.',
    );
  }
  if (head.startsWith('{')) {
    const all = decode(bytes);
    if (looksLikeMissionJson(all)) return 'fc-mission';
    return 'qgc-plan';
  }
  if (ext === 'csv' || /^[\w" ]+[,;\t][\w" ]+/.test(head.split(/\r?\n/)[0] ?? '')) return 'csv';
  throw new MissionFormatError(
    `The file is not in a format this app reads. It reads: ${FORMATS.map((f) => f.label).join(', ')}.`,
  );
}

export function readMission(bytes: Uint8Array, fileName: string): Mission {
  if (bytes.length === 0) throw new MissionFormatError('The file is empty.');
  const id = detectFormat(bytes, fileName);
  switch (id) {
    case 'qgc-plan':
      return readQgcPlan(bytes, fileName);
    case 'qgc-wpl':
      return readWpl(bytes, fileName);
    case 'garmin-fpl':
      return readGarminFpl(bytes, fileName);
    case 'dji-wpml':
      return readDjiWpml(bytes, fileName);
    case 'kml':
      return looksLikeZip(bytes) ? readKmz(bytes, fileName) : readKml(bytes, fileName);
    case 'gpx':
      return readGpx(bytes, fileName);
    case 'csv':
      return readCsv(bytes, fileName);
    case 'fc-mission':
      return readMissionJson(bytes, fileName);
  }
}

export interface WriteOptions {
  /** Needed for a DJI route: the aircraft it is for. */
  djiAircraft?: DjiAircraftId;
}

export function writeMission(mission: Mission, id: MissionFormatId, options: WriteOptions = {}): WrittenFile {
  switch (id) {
    case 'qgc-plan':
      return writeQgcPlan(mission);
    case 'qgc-wpl':
      return writeWpl(mission);
    case 'garmin-fpl':
      return writeGarminFpl(mission);
    case 'dji-wpml':
      if (!options.djiAircraft) throw new MissionFormatError('Choose the DJI aircraft the route is for.');
      return writeDjiWpml(mission, { aircraft: options.djiAircraft });
    case 'kml':
      return writeKml(mission);
    case 'gpx':
      return writeGpx(mission);
    case 'csv':
      return writeCsv(mission);
    case 'fc-mission':
      return writeMissionJson(mission);
  }
}
