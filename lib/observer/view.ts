// What the Live screen shows, made from what the observer holds. It is built
// from the same answers an assistant is given (state.ts), so the screen and the
// assistant cannot disagree.
//
// Every unit here is MAVLink's own, from its definition of the message:
// ATTITUDE in radians, VFR_HUD in metres and metres a second, SYS_STATUS in
// millivolts and centiamperes. Degrees are worked out from the radians.
//
// No position is in it. A height is; a latitude and a longitude are not.
import { autopilotVersion, messages, sensors, status, traffic, type ObserverSettings, type ObserverState } from './state.ts';

export interface LiveVehicle {
  type: string;
  autopilot: string;
  state: string;
  armed: boolean;
  mode: string;
  heartbeatAgeS: number | null;
}

export interface LiveView {
  schema: 'flight-companion/live-view@1';
  /** Seconds, by this computer's clock. */
  at: number;
  /** True while packets are arriving. */
  heard: boolean;
  lastPacketAgeS: number | null;
  bytes: number;
  kinds: number;
  errors: string[];
  vehicle: LiveVehicle | null;
  attitude: { rollDeg: number; pitchDeg: number; yawDeg: number; ageS: number | null } | null;
  flight: { heightM: number | null; altM: number | null; climbMs: number | null; groundspeedMs: number | null; headingDeg: number | null; throttlePct: number | null; ageS: number | null } | null;
  battery: { volts: number | null; amps: number | null; percent: number | null; cellsMv: number[]; ageS: number | null } | null;
  gps: { fix: string; satellites: number; hdop: number | null; ageS: number | null } | null;
  sensors: { name: string; enabled: boolean; healthy: boolean }[];
  messages: { ageS: number | null; severity: string; text: string }[];
  traffic: { type: string; count: number; rateHz: number | null; ageS: number }[];
  params: { received: number; expected: number | null };
  firmware: string | null;
}

const DEG = 180 / Math.PI;
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v: number, places: number): number => Math.round(v * 10 ** places) / 10 ** places;

/** A name as MAVLink writes it, as a person reads it: MAV_TYPE_QUADROTOR is "Quadrotor". */
export function plainName(name: string, prefix: string): string {
  const rest = name.startsWith(prefix) ? name.slice(prefix.length) : name;
  const words = rest
    .replace(/^_+/, '')
    .toLowerCase()
    .replace(/_/g, ' ')
    // letters that are said as letters
    .replace(/\b(gps|dgps|rtk|rc|ahrs|px4|3d|2d|gcs|vtol|ppp)\b/g, (w) => w.toUpperCase());
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}

export function liveView(s: ObserverState, now: number, settings: ObserverSettings): LiveView {
  // the screen is never given the position, whatever an assistant is allowed
  const hidden = { ...settings, showPlace: false };
  const st = status(s, now, hidden) as Record<string, unknown>;
  const se = sensors(s, now, hidden) as Record<string, Record<string, unknown> | undefined>;
  const v = st.vehicle as Record<string, unknown> | null;
  const att = s.latest.get('ATTITUDE');
  const hud = s.latest.get('VFR_HUD');
  const ver = autopilotVersion(s, now) as Record<string, unknown>;
  // height above where it took off: GLOBAL_POSITION_INT's relative_alt, in millimetres,
  // or ALTITUDE's altitude_relative, in metres. Only the height is read from either.
  const gpi = s.latest.get('GLOBAL_POSITION_INT');
  const alt = s.latest.get('ALTITUDE');
  const height = gpi ? finite(Number(gpi.fields.relative_alt) / 1000) : alt ? finite(alt.fields.altitude_relative) : null;
  const age = (t: number): number => round(now - t, 1);

  const sys = se.sys_status;
  const bat = se.battery_status;
  const table = (sys?.sensors ?? {}) as Record<string, { enabled: boolean; healthy: boolean }>;

  return {
    schema: 'flight-companion/live-view@1',
    at: now,
    heard: st.receiving === true,
    lastPacketAgeS: finite(st.last_packet_age_s),
    bytes: Number(st.bytes_seen),
    kinds: Number(st.message_types_seen),
    errors: (st.recent_errors as { error: string }[]).map((e) => e.error),
    vehicle: v
      ? {
          type: plainName(String(v.type), 'MAV_TYPE'),
          autopilot: plainName(String(v.autopilot), 'MAV_AUTOPILOT'),
          state: plainName(String(v.system_status), 'MAV_STATE'),
          armed: v.armed === true,
          mode: String((v.mode as { name: string }).name),
          heartbeatAgeS: finite(v.heartbeat_age_s),
        }
      : null,
    attitude: att
      ? {
          rollDeg: round(Number(att.fields.roll) * DEG, 1),
          pitchDeg: round(Number(att.fields.pitch) * DEG, 1),
          yawDeg: round(((Number(att.fields.yaw) * DEG) % 360 + 360) % 360, 1),
          ageS: age(att.t),
        }
      : null,
    flight: hud
      ? {
          heightM: height === null ? null : round(height, 2),
          altM: finite(hud.fields.alt),
          climbMs: finite(hud.fields.climb),
          groundspeedMs: finite(hud.fields.groundspeed),
          headingDeg: finite(hud.fields.heading),
          throttlePct: finite(hud.fields.throttle),
          ageS: age(hud.t),
        }
      : null,
    battery:
      sys || bat
        ? {
            volts: finite(sys?.voltage_battery_V),
            amps: finite(sys?.current_battery_A),
            percent: finite(sys?.battery_remaining_pct) ?? finite(bat?.remaining_pct),
            cellsMv: ((bat?.cells_mV as number[] | undefined) ?? []).slice(),
            ageS: finite(sys?.age_s) ?? finite(bat?.age_s),
          }
        : null,
    gps: se.gps
      ? {
          fix: plainName(String(se.gps.fix_type), 'GPS_FIX_TYPE'),
          satellites: Number(se.gps.satellites_visible),
          hdop: finite(se.gps.hdop),
          ageS: finite(se.gps.age_s),
        }
      : null,
    sensors: Object.entries(table).map(([name, r]) => ({ name: plainName(name, name.startsWith('MAV_SYS_STATUS_SENSOR') ? 'MAV_SYS_STATUS_SENSOR' : 'MAV_SYS_STATUS'), enabled: r.enabled, healthy: r.healthy })),
    messages: ((messages(s, now, 100) as { messages: { age_s: number | null; severity: string; text: string }[] }).messages ?? [])
      .map((m) => ({ ageS: m.age_s, severity: plainName(m.severity, 'MAV_SEVERITY'), text: m.text }))
      .reverse(),
    traffic: ((traffic(s, now) as { messages: { type: string; count: number; rate_hz: number | null; age_s: number }[] }).messages ?? []).map((m) => ({
      type: m.type,
      count: m.count,
      rateHz: m.rate_hz,
      ageS: m.age_s,
    })),
    params: { received: s.params.size, expected: s.paramCount },
    firmware: 'error' in ver ? null : String((ver.flight_sw_version as { string: string }).string),
  };
}
