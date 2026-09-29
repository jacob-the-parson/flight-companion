// Example missions for Learn mode. Every one is BUILT HERE, by this file, from
// distances in metres around one public point: the default home of PX4's
// simulator, in a field near Zurich. None is a recording of a real flight and
// none holds a real flying site. The files a student sees are what this app's
// own writers make of them.
import { toLatLng } from '../planner/geo.ts';
import { emptyMission, newId, type Mission, type MissionFormatId, type WaypointItem } from './model.ts';

/** PX4 SITL's default home: latitude, longitude and height above sea level. */
export const SAMPLE_HOME = { lat: 47.397742, lng: 8.545594, heightAmsl: 488 };

export interface MissionSample {
  id: string;
  title: string;
  /** One sentence: what the example is there to show. */
  shows: string;
  /** The format to look at first. */
  lookAt: MissionFormatId;
  /** Things to do with it, in order. */
  steps: string[];
  build: () => Mission;
}

const at = (east: number, north: number) => toLatLng({ x: east, y: north }, SAMPLE_HOME);

function wp(east: number, north: number, height: number | null, more: Partial<WaypointItem> = {}): WaypointItem {
  return {
    id: newId(),
    kind: 'waypoint',
    ...at(east, north),
    height,
    heightRef: height === null ? 'unknown' : 'home',
    ...more,
  };
}

function base(name: string): Mission {
  const m = emptyMission(name);
  m.home = { ...SAMPLE_HOME };
  m.firmware = 'px4';
  m.cruiseSpeed = 5;
  return m;
}

export const MISSION_SAMPLES: MissionSample[] = [
  {
    id: 'three-points',
    title: 'Three waypoints and home',
    shows: 'The smallest mission there is: take off, visit three places, come back.',
    lookAt: 'qgc-wpl',
    steps: [
      'Open the File view. Every row after the first line is one command, twelve numbers to a row.',
      'Find the fourth number of each row. 22 is take off, 16 is a waypoint, 20 is return. Those numbers are MAVLink commands.',
      'Row 0 is not flown. It is the home position, by a convention older than this app.',
      'Drag a waypoint on the map and watch which two numbers change in the file.',
    ],
    build: () => {
      const m = base('Three waypoints and home');
      m.items = [
        { id: newId(), kind: 'takeoff', lat: null, lng: null, height: 10, heightRef: 'home' },
        wp(30, 40, 15),
        wp(80, 40, 15),
        wp(80, -10, 15),
        { id: newId(), kind: 'return' },
      ];
      return m;
    },
  },
  {
    id: 'inspection',
    title: 'Looking at a tower',
    shows: 'Waypoints that do things: wait, turn, tilt the camera, take a photo, record video.',
    lookAt: 'qgc-plan',
    steps: [
      'Select waypoint 4 on the map and open Item in the tools drawer. It has a heading and two actions.',
      'Open the Convert view and choose the DJI route. Actions survive, because DJI has words for them.',
      'Now choose the Garmin flight plan. Read what is dropped, and why. A format can only hold what it has a place for.',
      'Choose the mission document. It is the one format that drops nothing.',
    ],
    build: () => {
      const m = base('Looking at a tower');
      m.items = [
        { id: newId(), kind: 'takeoff', lat: null, lng: null, height: 20, heightRef: 'home' },
        { id: newId(), kind: 'speed', speed: 4 },
        wp(40, 30, 30, { name: 'Gate', holdS: 5 }),
        wp(120, 60, 35, {
          name: 'Tower north',
          headingDeg: 180,
          actions: [{ kind: 'gimbal', pitchDeg: -45, yawDeg: null }, { kind: 'photo' }],
        }),
        { id: newId(), kind: 'roi', ...at(100, 40), height: 10 },
        wp(140, -20, 35, { name: 'Tower east', speed: 3, actions: [{ kind: 'hover', seconds: 4 }, { kind: 'video-start' }] }),
        wp(60, -60, 30, { name: 'Tower south', actions: [{ kind: 'video-stop' }] }),
        { id: newId(), kind: 'roi', lat: null, lng: null, height: null },
        { id: newId(), kind: 'return' },
      ];
      return m;
    },
  },
  {
    id: 'survey',
    title: 'Photographing a field',
    shows: 'Back-and-forth lines with the camera triggered by distance, the pattern every mapping flight uses.',
    lookAt: 'qgc-plan',
    steps: [
      'Count the lines on the map. The aircraft flies up one and down the next.',
      'Find the item that says "Take a photo every 12 m", and the one that stops the photos. Everything between them is photographed.',
      'The Flight Planner makes this pattern from a drawn area. Draw one there and send it here.',
      'In the Mission page, raise every height by 10 m. Longer in the air, more ground in each photo, less detail.',
    ],
    build: () => {
      const m = base('Photographing a field');
      const lines = 6;
      const spacing = 18;
      const length = 120;
      const pts: WaypointItem[] = [];
      for (let i = 0; i < lines; i++) {
        const x = 30 + i * spacing;
        const up = i % 2 === 0;
        pts.push(wp(x, up ? 20 : 20 + length, 40), wp(x, up ? 20 + length : 20, 40));
      }
      m.items = [
        { id: newId(), kind: 'takeoff', lat: null, lng: null, height: 40, heightRef: 'home' },
        { id: newId(), kind: 'speed', speed: 5 },
        pts[0],
        { id: newId(), kind: 'camera-distance', distanceM: 12 },
        ...pts.slice(1),
        { id: newId(), kind: 'camera-distance', distanceM: 0 },
        { id: newId(), kind: 'return' },
      ];
      m.areas = [
        {
          name: 'Field',
          role: 'survey',
          points: [at(30, 20), at(30 + (lines - 1) * spacing, 20), at(30 + (lines - 1) * spacing, 20 + length), at(30, 20 + length)],
        },
      ];
      return m;
    },
  },
  {
    id: 'fence',
    title: 'A fence and a safe place to land',
    shows: 'A geofence to stay inside, a circle to stay out of, and a rally point.',
    lookAt: 'qgc-plan',
    steps: [
      'The dashed outline is the keep-in fence. The circle is a keep-out: a tree, a building, people.',
      'In the File view, find "geoFence" and "rallyPoints". A plan file holds three things: the mission, the fence, the rally points.',
      'Convert to the waypoint list. The fence is dropped: that format holds a mission and nothing else.',
      'A fence in a file does nothing until the ground station uploads it and the aircraft is told what to do when it is crossed.',
    ],
    build: () => {
      const m = base('A fence and a safe place to land');
      m.items = [
        { id: newId(), kind: 'takeoff', lat: null, lng: null, height: 15, heightRef: 'home' },
        wp(40, 60, 20),
        wp(130, 70, 20),
        wp(140, -30, 20),
        wp(40, -40, 20),
        { id: newId(), kind: 'return' },
      ];
      m.areas = [{ name: 'Flying field', role: 'keep-in', points: [at(-40, -90), at(190, -90), at(190, 120), at(-40, 120)] }];
      m.circles = [{ center: at(90, 15), radiusM: 25, role: 'keep-out' }];
      m.rally = [{ ...at(-20, 40), height: 15, heightRef: 'home' }];
      return m;
    },
  },
  {
    id: 'no-heights',
    title: 'A route with no heights',
    shows: 'What a route from a map or a crewed-aircraft planner looks like: places, and nothing about how high.',
    lookAt: 'garmin-fpl',
    steps: [
      'Open Checks in the tools drawer. The first one says Stop: no waypoint has a height.',
      'Garmin flight plans, GPX routes and most KML lines are like this. They say where, never how high.',
      'In the Mission page, set every height to 30 m above takeoff. The check clears.',
      'Add a takeoff and a return from the Mission page, and the route has become a mission an aircraft could fly.',
    ],
    build: () => {
      const m = base('A route with no heights');
      m.firmware = null;
      m.cruiseSpeed = null;
      m.items = [
        wp(20, 30, null, { name: 'BARN' }),
        wp(90, 80, null, { name: 'POND' }),
        wp(170, 40, null, { name: 'OAK' }),
        wp(120, -40, null, { name: 'GATE' }),
      ];
      return m;
    },
  },
  {
    id: 'mixed-heights',
    title: 'Two kinds of height',
    shows: 'One waypoint measured from sea level among others measured from takeoff. The numbers look alike and mean different things.',
    lookAt: 'fc-mission',
    steps: [
      'Look at the heights in the Items view: 30, 30, 520, 30. Waypoint 4 is not 490 m higher than the others.',
      'It is measured from sea level, and takeoff here is 488 m above sea level. So it is 32 m above takeoff.',
      'Open Checks. The app points at the mix; it cannot know whether it was meant.',
      'Change waypoint 4 to 32 m above takeoff in the Item page. The mission flies the same and reads clearly.',
    ],
    build: () => {
      const m = base('Two kinds of height');
      m.items = [
        { id: newId(), kind: 'takeoff', lat: null, lng: null, height: 30, heightRef: 'home' },
        wp(40, 40, 30),
        wp(110, 50, 30),
        { ...wp(120, -30, 520), heightRef: 'amsl' },
        wp(40, -30, 30),
        { id: newId(), kind: 'return' },
      ];
      return m;
    },
  },
];

export function sampleById(id: string): MissionSample | undefined {
  return MISSION_SAMPLES.find((s) => s.id === id);
}

/** How to read each format's file, for the File view in Learn mode. */
export const FORMAT_READING: Record<MissionFormatId, string[]> = {
  'qgc-plan': [
    'JSON: names in quotes, a colon, then the value. Curly brackets hold named things, square brackets hold lists.',
    '"items" is the mission. Each item has a "command" number and a list of seven "params".',
    'For a waypoint (command 16) the last three params are latitude, longitude and height. The first is seconds to wait.',
    '"frame": 3 means the height is measured from the takeoff point. 0 means from sea level. 2 means the command has no place.',
    '"plannedHomePosition" is where the planner expected takeoff to be. The aircraft uses where it really is.',
  ],
  'qgc-wpl': [
    'Line 1 names the format and its version. Every other line is one command.',
    'The twelve columns: row number, current (1 on the first row), frame, command, four parameters, latitude, longitude, height, continue.',
    'Row 0 is the home position. The mission begins at row 1.',
    'Columns are separated by tabs. Mission Planner, QGroundControl and MAVProxy all read this file.',
  ],
  'dji-wpml': [
    'A .kmz is a ZIP archive. This one holds two XML files in a folder called wpmz.',
    'template.kml is what was planned. waylines.wpml is what the aircraft flies. DJI Pilot 2 makes the second from the first.',
    'Coordinates are written longitude first, then latitude. That is KML\'s order, and the opposite of most other formats.',
    'Tags beginning "wpml:" are DJI\'s own. "droneEnumValue" is a number for the aircraft model: the route is made for one model.',
    'Each "actionGroup" belongs to a waypoint and holds the things to do there.',
  ],
  'garmin-fpl': [
    'Two parts: a table of waypoints, then a route that lists them by name in the order to visit.',
    'An identifier is capital letters and digits, twelve at most. "Tower north" has to become TOWERNORTH.',
    '"elevation" is the height of the ground at that place, above sea level. There is nowhere to write a height to fly at.',
    'This format was made for crewed aircraft, whose pilots choose their own height.',
  ],
  kml: [
    'XML: every thing has an opening tag and a closing tag, and tags sit inside each other.',
    'A Placemark is one thing on the map. It holds a Point, a LineString or a Polygon.',
    'Coordinates are longitude, latitude, height, with commas and no spaces. Longitude comes first.',
    '"altitudeMode" says what the height is measured from: absolute is sea level, relativeToGround is the ground below.',
  ],
  gpx: [
    'A route ("rte") is a list of route points ("rtept"). Latitude and longitude are written inside the tag itself.',
    '"ele" is elevation: metres above sea level.',
    'A GPX can also hold a track: a record of where something went. A route is a plan; a track is a history.',
  ],
  csv: [
    'One row per item, values separated by commas. Any spreadsheet opens it.',
    'The unit is in the column name: height_m is metres, speed_m_s is metres per second.',
    'The last column says in words what the item does.',
  ],
  'fc-mission': [
    'This app\'s own format. Every number has its unit in its name, and every height says what it is measured from.',
    '"summary" is worked out from the items: length, highest point, time. "in_words" says what each item does.',
    'It is written so that a person, a script or an AI assistant can read it without knowing MAVLink.',
    'No ground station reads it. To fly, convert it to a plan or a waypoint list.',
  ],
};
