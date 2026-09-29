// Mission export. Two formats, both read by QGroundControl and by Mission Planner's
// family of tools:
//   .plan       QGroundControl's JSON plan (docs.qgroundcontrol.com, "Plan File Format")
//   .waypoints  the plain-text "QGC WPL 110" list (mavlink.io, "File Formats")
//
// This app only writes the file. Uploading it to an aircraft is done by a person in
// the ground station, after looking at it there.
import type { LatLng } from './geo.ts';
import type { SurveyParams, SurveyType, Waypoint } from './survey.ts';

// MAVLink command numbers (MAV_CMD), from the common message set.
const NAV_WAYPOINT = 16;
const NAV_RETURN_TO_LAUNCH = 20;
const NAV_TAKEOFF = 22;
const DO_CHANGE_SPEED = 178;
const DO_SET_ROI_LOCATION = 195;
const DO_SET_ROI_NONE = 197;
const DO_SET_CAM_TRIGG_DIST = 206;

// MAV_FRAME
const FRAME_MISSION = 2;
const FRAME_GLOBAL_RELATIVE_ALT = 3;

export type Firmware = 'px4' | 'ardupilot';

export interface MissionInput {
  type: SurveyType;
  waypoints: Waypoint[];
  home: LatLng;
  params: SurveyParams;
  photoSpacing: number;
  firmware: Firmware;
  /** Centre of an orbit, so the aircraft can be told to face it. */
  roi?: LatLng;
}

interface Item {
  command: number;
  frame: number;
  /** param1..4, then latitude, longitude, altitude. null = "leave as is". */
  params: (number | null)[];
}

const round7 = (v: number) => Math.round(v * 1e7) / 1e7;

export function missionItems(m: MissionInput): Item[] {
  const alt = m.params.altitude;
  const items: Item[] = [];

  items.push({
    command: NAV_TAKEOFF,
    frame: FRAME_GLOBAL_RELATIVE_ALT,
    params: [0, 0, 0, null, round7(m.home.lat), round7(m.home.lng), alt],
  });
  // param1 = 1: ground speed; param3 = -1: no change to throttle
  items.push({
    command: DO_CHANGE_SPEED,
    frame: FRAME_MISSION,
    params: [1, m.params.speed, -1, 0, 0, 0, 0],
  });
  if (m.type === 'orbit' && m.roi) {
    items.push({
      command: DO_SET_ROI_LOCATION,
      frame: FRAME_GLOBAL_RELATIVE_ALT,
      params: [0, 0, 0, 0, round7(m.roi.lat), round7(m.roi.lng), 0],
    });
  }

  const trigger = m.params.cameraTrigger && m.type !== 'orbit' && m.photoSpacing > 0;
  m.waypoints.forEach((w, i) => {
    items.push({
      command: NAV_WAYPOINT,
      frame: FRAME_GLOBAL_RELATIVE_ALT,
      params: [0, 0, 0, null, round7(w.lat), round7(w.lng), w.alt],
    });
    if (trigger && i === 0) {
      // start triggering once the aircraft is on the first line
      items.push({
        command: DO_SET_CAM_TRIGG_DIST,
        frame: FRAME_MISSION,
        params: [Math.round(m.photoSpacing * 100) / 100, 0, 1, 0, 0, 0, 0],
      });
    }
  });

  if (trigger) {
    items.push({ command: DO_SET_CAM_TRIGG_DIST, frame: FRAME_MISSION, params: [0, 0, 0, 0, 0, 0, 0] });
  }
  if (m.type === 'orbit' && m.roi) {
    items.push({ command: DO_SET_ROI_NONE, frame: FRAME_MISSION, params: [0, 0, 0, 0, 0, 0, 0] });
  }
  items.push({ command: NAV_RETURN_TO_LAUNCH, frame: FRAME_MISSION, params: [0, 0, 0, 0, 0, 0, 0] });
  return items;
}

/** QGroundControl .plan file. */
export function toQgcPlan(m: MissionInput): string {
  const items = missionItems(m).map((it, i) => {
    const positional = it.frame === FRAME_GLOBAL_RELATIVE_ALT;
    return {
      AMSLAltAboveTerrain: null,
      Altitude: positional ? (it.params[6] ?? 0) : 0,
      AltitudeMode: 1, // relative to the takeoff point
      autoContinue: true,
      command: it.command,
      doJumpId: i + 1,
      frame: it.frame,
      params: it.params,
      type: 'SimpleItem',
    };
  });

  const plan = {
    fileType: 'Plan',
    geoFence: { circles: [], polygons: [], version: 2 },
    groundStation: 'QGroundControl',
    mission: {
      cruiseSpeed: 15,
      firmwareType: m.firmware === 'px4' ? 12 : 3, // MAV_AUTOPILOT
      globalPlanAltitudeMode: 1,
      hoverSpeed: m.params.speed,
      items,
      // the altitude of home above sea level is not known here; the ground
      // station replaces the planned home with the real one when it connects
      plannedHomePosition: [round7(m.home.lat), round7(m.home.lng), 0],
      vehicleType: 2, // MAV_TYPE_QUADROTOR
      version: 2,
    },
    rallyPoints: { points: [], version: 2 },
    version: 1,
  };
  return JSON.stringify(plan, null, 4) + '\n';
}

/** Plain-text "QGC WPL 110" waypoint list. Row 0 is home, by convention. */
export function toWpl(m: MissionInput): string {
  const rows: string[] = ['QGC WPL 110'];
  const row = (i: number, current: number, frame: number, command: number, p: (number | null)[]) =>
    [i, current, frame, command, ...p.map((v) => (v === null ? 0 : v)), 1].join('\t');

  rows.push(row(0, 1, 0, NAV_WAYPOINT, [0, 0, 0, 0, round7(m.home.lat), round7(m.home.lng), 0]));
  missionItems(m).forEach((it, i) => rows.push(row(i + 1, 0, it.frame, it.command, it.params)));
  return rows.join('\n') + '\n';
}
