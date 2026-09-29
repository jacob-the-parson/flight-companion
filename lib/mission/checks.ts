// Checks on a mission, whatever format it came from. The same three levels as
// the planner and the log viewer: stop, check, good. Each check says what was
// found and where, so a person or an assistant can go and look.
import {
  distanceM,
  flownPoints,
  hasPosition,
  HEIGHT_REF_LABEL,
  missionStats,
  type Mission,
} from './model.ts';

export type CheckLevel = 'critical' | 'warning' | 'info' | 'good';

export interface MissionCheck {
  id: string;
  level: CheckLevel;
  title: string;
  detail: string;
  /** Item numbers (counting from 1) the check points at. */
  items?: number[];
}

/** Limits this app uses. They are its own rules of thumb unless a source is named. */
export const MISSION_LIMITS = {
  /** 400 ft: the ceiling for recreational and Part 107 flights in the United States. */
  ceilingM: 120,
  /** A single leg longer than this is usually a mistyped coordinate. */
  longLegM: 2000,
  /** Beyond this the pilot should confirm the aircraft can still be seen. */
  farM: 400,
  /** Two waypoints closer than this are probably the same point entered twice. */
  duplicateM: 0.5,
};

export function checkMission(m: Mission): MissionCheck[] {
  const out: MissionCheck[] = [];
  const stats = missionStats(m);
  const flown = flownPoints(m);
  const list = (n: number[]) => n.slice(0, 8).join(', ') + (n.length > 8 ? ` and ${n.length - 8} more` : '');

  if (m.items.length === 0) {
    return [{ id: 'empty', level: 'info', title: 'The mission has no items', detail: 'Add a waypoint on the map, or open a file.' }];
  }

  // positions that cannot be real
  const offMap = m.items
    .map((item, i) => (hasPosition(item) && (Math.abs(item.lat) > 90 || Math.abs(item.lng) > 180) ? i + 1 : 0))
    .filter(Boolean);
  if (offMap.length) {
    out.push({
      id: 'off-map',
      level: 'critical',
      title: 'A position is not on the Earth',
      detail: `Latitude runs from −90 to 90 and longitude from −180 to 180. Check item ${list(offMap)}. Latitude and longitude may be the wrong way round.`,
      items: offMap,
    });
  }
  const nullIsland = m.items
    .map((item, i) => (item.kind === 'waypoint' && item.lat === 0 && item.lng === 0 ? i + 1 : 0))
    .filter(Boolean);
  if (nullIsland.length) {
    out.push({
      id: 'zero-zero',
      level: 'critical',
      title: 'A waypoint sits at latitude 0, longitude 0',
      detail: `That is in the sea off West Africa, and is what an empty field becomes. Check item ${list(nullIsland)}.`,
      items: nullIsland,
    });
  }

  // heights
  const noHeight = m.items.map((item, i) => (item.kind === 'waypoint' && item.height === null ? i + 1 : 0)).filter(Boolean);
  if (noHeight.length) {
    out.push({
      id: 'no-height',
      level: 'critical',
      title: `${noHeight.length} waypoint${noHeight.length > 1 ? 's have' : ' has'} no height`,
      detail: `An aircraft cannot fly to a place without a height. ${m.source === 'garmin-fpl' || m.source === 'kml' || m.source === 'gpx' ? 'The format this came from does not carry flying heights. ' : ''}Give each one a height and say what it is measured from.`,
      items: noHeight,
    });
  }
  if (stats.heightRefs.length > 1) {
    out.push({
      id: 'mixed-refs',
      level: 'warning',
      title: 'Heights are measured from more than one reference',
      detail: `This mission uses ${stats.heightRefs.map((r) => HEIGHT_REF_LABEL[r]).join(' and ')}. That is allowed, and it is also how a 50 m waypoint ends up underground. Make sure it is meant.`,
    });
  }
  const unknownRef = m.items
    .map((item, i) => (item.kind === 'waypoint' && item.height !== null && item.heightRef === 'unknown' ? i + 1 : 0))
    .filter(Boolean);
  if (unknownRef.length) {
    out.push({
      id: 'unknown-ref',
      level: 'warning',
      title: 'Some heights do not say what they are measured from',
      detail: `The file gave a number and no reference for item ${list(unknownRef)}. Above takeoff, above sea level and above the ground can differ by hundreds of metres.`,
      items: unknownRef,
    });
  }
  const high = m.items
    .map((item, i) =>
      (item.kind === 'waypoint' || item.kind === 'takeoff') &&
      item.height !== null &&
      (item.heightRef === 'home' || item.heightRef === 'ground') &&
      item.height > MISSION_LIMITS.ceilingM
        ? i + 1
        : 0,
    )
    .filter(Boolean);
  if (high.length) {
    out.push({
      id: 'too-high',
      level: 'critical',
      title: `Above ${MISSION_LIMITS.ceilingM} m (400 ft)`,
      detail: `Item ${list(high)}. Recreational and Part 107 flights in the United States are limited to 400 ft above the ground unless authorised. Check the rule that applies where you fly.`,
      items: high,
    });
  }
  const low = m.items
    .map((item, i) =>
      item.kind === 'waypoint' && item.height !== null && item.heightRef === 'home' && item.height < 2 ? i + 1 : 0,
    )
    .filter(Boolean);
  if (low.length) {
    out.push({
      id: 'too-low',
      level: 'warning',
      title: 'A waypoint is less than 2 m above takeoff',
      detail: `Item ${list(low)}. Ground that rises between takeoff and the waypoint would be in the way.`,
      items: low,
    });
  }

  // shape of the route
  const long: number[] = [];
  const twins: number[] = [];
  for (let i = 1; i < flown.length; i++) {
    const d = distanceM(flown[i - 1], flown[i]);
    if (d > MISSION_LIMITS.longLegM) long.push(flown[i].index + 1);
    if (d < MISSION_LIMITS.duplicateM) twins.push(flown[i].index + 1);
  }
  if (long.length) {
    out.push({
      id: 'long-leg',
      level: 'warning',
      title: `A leg is longer than ${MISSION_LIMITS.longLegM / 1000} km`,
      detail: `The leg ending at item ${list(long)}. A single long leg in a short mission is usually a mistyped coordinate.`,
      items: long,
    });
  }
  if (twins.length) {
    out.push({
      id: 'duplicates',
      level: 'info',
      title: 'Two waypoints in a row are at the same place',
      detail: `Item ${list(twins)} is within half a metre of the one before it.`,
      items: twins,
    });
  }

  // beginning and end
  const first = m.items[0];
  const last = m.items[m.items.length - 1];
  const flyable = m.source !== 'garmin-fpl' && m.source !== 'kml' && m.source !== 'gpx' && m.source !== 'csv';
  if (flyable && m.firmware !== 'dji') {
    if (!m.items.some((i) => i.kind === 'takeoff')) {
      out.push({
        id: 'no-takeoff',
        level: 'warning',
        title: 'The mission has no takeoff item',
        detail: 'PX4 and ArduPilot missions usually begin with one. Without it the aircraft must already be in the air when the mission starts.',
      });
    } else if (first.kind !== 'takeoff' && first.kind !== 'speed' && first.kind !== 'raw') {
      out.push({
        id: 'takeoff-late',
        level: 'warning',
        title: 'Takeoff is not the first item',
        detail: 'Something is asked of the aircraft before it has left the ground.',
      });
    }
    if (last.kind !== 'return' && last.kind !== 'land') {
      out.push({
        id: 'no-ending',
        level: 'warning',
        title: 'The mission does not end with a return or a landing',
        detail: 'After the last waypoint the aircraft will hold where it is until the pilot takes over or the battery failsafe acts.',
      });
    }
  }

  // distance from the pilot
  if (stats.farthestFromHomeM !== null && stats.farthestFromHomeM > MISSION_LIMITS.farM) {
    out.push({
      id: 'far',
      level: 'warning',
      title: 'A long way from the takeoff point',
      detail: `The farthest point is ${Math.round(stats.farthestFromHomeM)} m away. Confirm you can see the aircraft, and tell which way it points, at that distance.`,
    });
  }
  if (!m.home && flown.length > 0) {
    out.push({
      id: 'no-home',
      level: 'info',
      title: 'The mission does not say where takeoff is',
      detail: 'Distances from the pilot cannot be worked out. The aircraft uses wherever it is armed.',
    });
  }

  // commands the app cannot explain
  const raws = m.items.map((item, i) => (item.kind === 'raw' ? i + 1 : 0)).filter(Boolean);
  if (raws.length) {
    out.push({
      id: 'raw',
      level: 'info',
      title: `${raws.length} command${raws.length > 1 ? 's' : ''} kept as read`,
      detail: `Item ${list(raws)}. The app names these commands and carries them through unchanged, and it does not check what they do.`,
      items: raws,
    });
  }

  if (!out.some((c) => c.level === 'critical' || c.level === 'warning')) {
    out.unshift({
      id: 'ok',
      level: 'good',
      title: 'Nothing stands out',
      detail: 'Positions are on the map, every waypoint has a height and a reference, and the mission has a beginning and an end. That is not the same as safe to fly: look at it on the ground station’s map.',
    });
  }

  const order: CheckLevel[] = ['critical', 'warning', 'info', 'good'];
  return out.sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));
}
