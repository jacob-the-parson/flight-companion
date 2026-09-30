// A flight log as a brief for an assistant: the numbers, the findings, the
// messages and the parameters that were changed, in plain names with the unit
// in each name. No series of samples: those are megabytes, and the findings
// are what was worked out from them.
//
// WHERE it flew is left out unless asked for. A brief is made to be pasted
// somewhere else, and a takeoff point is somebody's address.
import { levelName, type FlightSummary } from './analysis.ts';

export const LOG_BRIEF_SCHEMA = 'flight-companion/log-brief@1';

export interface LogBriefOptions {
  /** Include the takeoff point and the extent of the track. */
  withPlace?: boolean;
  /** Most messages to include; the most severe are kept first. */
  maxMessages?: number;
}

const round = (v: number | null, digits: number): number | null =>
  v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** digits) / 10 ** digits;

export function logBrief(name: string, s: FlightSummary, options: LogBriefOptions = {}): Record<string, unknown> {
  const { withPlace = false, maxMessages = 200 } = options;
  const messages = s.events.filter((e) => e.kind === 'message');
  // when there are too many, the least severe go first: 7 is debug, 0 is emergency
  const kept =
    messages.length <= maxMessages
      ? messages
      : [...messages]
          .sort((a, b) => a.level - b.level || a.t - b.t)
          .slice(0, maxMessages)
          .sort((a, b) => a.t - b.t);

  let place: Record<string, unknown> | null = null;
  if (withPlace && s.home) {
    place = { takeoff_latitude_deg: s.home.lat, takeoff_longitude_deg: s.home.lng };
  }

  return {
    schema: LOG_BRIEF_SCHEMA,
    about:
      'A summary of one PX4 flight log (.ulg) from the Flight Companion app. Times are seconds from the start of logging. The findings are worked out from the log by the app; each says what it measured. The app never connects to an aircraft.',
    file: name,
    logging_started_utc: s.startUtcMs === null ? null : new Date(s.startUtcMs).toISOString(),
    log_length_s: round(s.duration, 1),
    aircraft: {
      firmware: s.system.firmware,
      release: s.system.release,
      board: s.system.hardware,
      airframe_id: s.system.airframeId,
      rotors: s.system.rotorCount,
    },
    log_health: {
      size_bytes: s.log.bytes,
      topics: s.log.topics,
      gaps_in_logging: s.log.dropouts,
      gaps_total_ms: s.log.dropoutMs,
      ends_mid_message: s.log.truncated,
      unreadable_bytes: s.log.corruptBytes,
    },
    numbers: {
      time_in_the_air_s: round(s.stats.airborneS, 1),
      highest_above_takeoff_m: round(s.stats.maxAltM, 2),
      fastest_over_the_ground_m_s: round(s.stats.maxSpeedMs, 2),
      distance_flown_m: round(s.stats.distanceM, 1),
      most_roll_deg: round(s.stats.maxRollDeg, 1),
      most_pitch_deg: round(s.stats.maxPitchDeg, 1),
      battery_cells: s.stats.cells,
      battery_at_start_v: round(s.stats.battStartV, 3),
      battery_lowest_v: round(s.stats.battMinV, 3),
      battery_at_end_v: round(s.stats.battEndV, 3),
      battery_at_start_percent: round(s.stats.battStartPct, 1),
      battery_lowest_percent: round(s.stats.battMinPct, 1),
      current_highest_a: round(s.stats.maxCurrentA, 2),
      current_mean_in_the_air_a: round(s.stats.meanAirCurrentA, 2),
      charge_used_mah: round(s.stats.usedMah, 0),
      satellites_fewest: s.stats.satsMin,
      satellites_most: s.stats.satsMax,
      motor_output_mean_in_the_air_us: s.stats.motorMeansUs?.map((v) => Math.round(v)) ?? null,
    },
    armed_spans_s: s.armed.map((a) => [round(a.start, 1), round(a.end, 1)]),
    in_the_air_spans_s: s.airborne.map((a) => [round(a.start, 1), round(a.end, 1)]),
    flight_modes: s.modes.map((m) => ({ mode: m.name, from_s: round(m.start, 1), to_s: round(m.end, 1) })),
    findings: s.findings.map((f) => ({
      id: f.id,
      level: f.level,
      level_means: f.level === 'critical' ? 'stop' : f.level === 'warning' ? 'check' : f.level === 'info' ? 'note' : 'good',
      title: f.title,
      detail: f.detail,
      ...(f.at !== undefined ? { at_s: round(f.at, 1) } : null),
      ...(f.facts ? { evidence: Object.fromEntries(f.facts) } : null),
    })),
    messages_from_the_aircraft: kept.map((e) => ({ at_s: round(e.t, 1), severity: levelName(e.level), text: e.text })),
    messages_left_out: messages.length - kept.length,
    parameters_not_at_their_default: s.params
      .filter((p) => p.changed)
      .map((p) => ({
        name: p.name,
        value: p.value,
        airframe_default: p.airframeDefault,
        firmware_default: p.firmwareDefault,
      })),
    parameters_changed_during_the_log: s.paramChanges.map((c) => ({ at_s: round(c.t, 1), name: c.name, value: c.value })),
    parameters_in_the_log: s.params.length,
    place: place ?? 'left out. A brief is made to be passed on; ask for the place to be included if it is needed.',
    what_was_logged: s.topics.map((t) => t.key),
  };
}
