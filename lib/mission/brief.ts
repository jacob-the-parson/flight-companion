// What a file looks like inside, and the mission as a brief for an assistant.
// Both are for reading: by a student in the File view, by an assistant that is
// handed the mission and asked about it.
import { unzipSync } from 'fflate';
import { checkMission } from './checks.ts';
import { DJI_AIRCRAFT, type DjiAircraftId } from './codecs/djiWpml.ts';
import { writeMissionJson } from './codecs/plain.ts';
import { FORMATS, writeMission } from './formats.ts';
import { MissionFormatError, type ConversionReport, type Mission, type MissionFormatId, type WrittenFile } from './model.ts';
import { decode } from './xml.ts';

export interface FilePart {
  /** The file's name, or its path inside an archive. */
  name: string;
  text: string;
}

/** The text of a written file. An archive gives one part for each file inside it. */
export function fileParts(file: WrittenFile): FilePart[] {
  const zipped = file.data.length > 4 && file.data[0] === 0x50 && file.data[1] === 0x4b;
  if (!zipped) return [{ name: file.name, text: decode(file.data) }];
  const inside = unzipSync(file.data);
  return Object.keys(inside)
    .sort()
    .map((path) => ({ name: `${file.name} / ${path}`, text: decode(inside[path]) }));
}

export type WriteAttempt =
  | { ok: true; file: WrittenFile }
  | { ok: false; reason: string; needsAircraft: boolean };

/** Write the mission, and say in words why not when it cannot be written. */
export function tryWrite(mission: Mission, format: MissionFormatId, djiAircraft: DjiAircraftId | null): WriteAttempt {
  if (format === 'dji-wpml' && !djiAircraft) {
    return { ok: false, reason: 'Choose the DJI aircraft the route is for. A DJI route is made for one model.', needsAircraft: true };
  }
  try {
    return { ok: true, file: writeMission(mission, format, { djiAircraft: djiAircraft ?? undefined }) };
  } catch (e) {
    if (e instanceof MissionFormatError) return { ok: false, reason: e.message, needsAircraft: false };
    throw e;
  }
}

export const BRIEF_SCHEMA = 'flight-companion/mission-brief@1';

interface FormatOutcome {
  format: MissionFormatId;
  label: string;
  file_extension: string;
  an_aircraft_can_fly_it: boolean;
  can_be_written: boolean;
  why_not?: string;
  would_be_dropped?: ConversionReport['dropped'];
  would_be_changed?: string[];
}

/**
 * The mission, its checks and what each format would do to it, as one JSON
 * document. Made to be pasted to an assistant: plain names, units in the
 * names, nothing that needs MAVLink to be understood.
 */
export function missionBrief(mission: Mission, djiAircraft: DjiAircraftId | null = null): Record<string, unknown> {
  const formats: FormatOutcome[] = FORMATS.map((f) => {
    const head = {
      format: f.id,
      label: f.label,
      file_extension: `.${f.extensions[0]}`,
      an_aircraft_can_fly_it: f.flyable,
    };
    // a DJI route needs a model; the first in the table stands in, to say what would be dropped
    const attempt = tryWrite(mission, f.id, f.id === 'dji-wpml' ? (djiAircraft ?? DJI_AIRCRAFT[0].id) : null);
    if (!attempt.ok) return { ...head, can_be_written: false, why_not: attempt.reason };
    return {
      ...head,
      can_be_written: true,
      would_be_dropped: attempt.file.report.dropped,
      would_be_changed: attempt.file.report.changed,
    };
  });
  return {
    schema: BRIEF_SCHEMA,
    about:
      'A flight mission from the Flight Companion app, with the checks the app ran on it and what each file format would keep or drop. The app never connects to an aircraft: a mission reaches one only when a person opens a file in a ground station and uploads it from there.',
    checks: checkMission(mission).map((c) => ({
      id: c.id,
      level: c.level,
      level_means: c.level === 'critical' ? 'stop' : c.level === 'warning' ? 'check' : c.level === 'info' ? 'note' : 'good',
      title: c.title,
      detail: c.detail,
      item_numbers: c.items ?? [],
    })),
    formats,
    mission: JSON.parse(decode(writeMissionJson(mission).data)) as unknown,
  };
}
