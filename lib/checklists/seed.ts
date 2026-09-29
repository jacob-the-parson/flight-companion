// Built-in checklist templates.
//
// "X500 V2 / Pixhawk 6C" is this project's own checklist (flight-checklists.md),
// including what the 2026-09-28 flights taught: the motor layout comes from the
// board's geometry, props are fitted by their own marking, and a pack is only
// full when a meter says 16.8 V. Numbers in it are this aircraft's settings, not
// general advice. "Generic multirotor" is a short starting point for any other
// aircraft and deliberately contains no aircraft-specific numbers.
import type { ChecklistSection, ChecklistTemplate, PhaseId } from './types';

type ItemSeed = [text: string, expect?: string, critical?: boolean];

function section(id: string, phase: PhaseId, title: string, items: ItemSeed[]): ChecklistSection {
  return {
    id,
    phase,
    title,
    items: items.map(([text, expect, critical], i) => ({
      id: `${id}-${i + 1}`,
      text,
      ...(expect ? { expect } : null),
      ...(critical ? { critical: true } : null),
    })),
  };
}

const X500: ChecklistTemplate = {
  id: 'builtin-x500v2',
  name: 'X500 V2 / Pixhawk 6C',
  aircraft: 'X500 V2',
  description: 'This build: PX4 v1.16.0, RadioMaster Pocket, SiK telemetry, 4S 5200 mAh.',
  builtIn: true,
  sections: [
    section('x5-gate', 'preflight', 'Before leaving for the field', [
      ['FAA registration done and the number is marked on the airframe.', 'Aircraft is over 250 g.', true],
      ['Remote ID module fitted, or the site is a FAA-Recognized Identification Area.', undefined, true],
      ['Pilot holds a TRUST certificate and carries proof.', 'Every pilot on the sticks, students included.', true],
      ['Airspace checked for the site in B4UFLY or a LAANC app.', 'Class G, no advisories.', true],
      ['Site is open: no tall trees, buildings, water or roofs nearby, nobody within 100 m.'],
      ['Instructor and one adult spotter are both present.', undefined, true],
      ['Weather: light breeze at most, no rain, daylight.'],
      ['Flight pack charged and checked with a meter.', '16.8 V, all cells within 0.02 V. The charger display is not the check.', true],
      ['Radio and laptop charged.'],
      ['Kit packed: aircraft, props (2 CW, 2 CCW) and spares, prop tool, radio, laptop, SiK ground radio, USB-C cable, LiPo bag, first-aid kit, multimeter.'],
      ['Parameters match the baseline, or every difference has a decision number.', 'Live diff against the baseline file is clean.', true],
      ['SD card is in the Pixhawk.', 'A missing card does not stop arming, it only loses the log.'],
    ]),
    section('x5-airframe', 'preflight', 'Airframe, props OFF', [
      ['Arms tight, no cracked carbon, landing gear firm.', undefined, true],
      ['Each motor spins freely by hand, no grinding, bell tight.', undefined, true],
      ['ESC signal leads on the breakout: signal wire on S, ground on the minus row.', 'Read the pad at the ESC, not the wire colour.', true],
      ['Breakout position 1 goes to front right, 2 to back left, 3 to front left, 4 to back right.', 'A crossed pair rolled this aircraft over.', true],
      ['ESC power plugs seated, power module XT60 seated, power module lead in the POWER port.'],
      ['GPS mast upright and locked, arrow forward. Antennas clear of carbon.'],
      ['Nothing loose that could reach a prop.', undefined, true],
    ]),
    section('x5-power', 'preflight', 'Power up and link', [
      ['Radio on first. Model "FPV Drone". Throttle down. SB toward you. SD light off.', 'SD light off means kill engaged.', true],
      ['SiK ground radio in the laptop, QGroundControl open.'],
      ['Aircraft level, nose away. Battery in. Do not move it for 20 seconds.', 'Startup tones, ESC chime.'],
      ['QGroundControl connects over the radio.', 'Vehicle shows in Fly view.'],
      ['Battery reading in QGroundControl.', '16.6 to 16.8 V and 95 % or more.', true],
      ['GPS.', '3D fix, 10 or more satellites, HDOP under 1.5.', true],
      ['Rotate the aircraft 90 degrees by hand: heading follows.', 'Within about 10 degrees of a phone compass.'],
      ['Readiness indicator.', 'Green "Ready to Fly". Any amber: read the report, fix or stop.', true],
      ['All four sticks move the right bars the right way.', undefined, true],
      ['Kill switch check: SD on, no kill message. SD off, "Kill switch engaged". Leave it off.', undefined, true],
      ['Mode switch check: SB toward you Position, middle Altitude, back Stabilized. Leave in Position.'],
      ['Home marker sits where the aircraft is. Nothing over 25 m tall between flying area and home.'],
      ['If flying a mission: the plan in QGroundControl is the one expected, all inside the site.'],
    ]),
    section('x5-props', 'preflight', 'Props on, last', [
      ['Battery OUT for prop fitting.', undefined, true],
      ['Props fitted by the marking on each prop: CCW props on front right and back left, CW props on front left and back right.', 'Matches the Actuators diagram: 1 and 2 one colour, 3 and 4 the other.', true],
      ['All four props tight.', undefined, true],
      ['Everyone behind the pilot, at least 10 m back. Spotter has eyes on the aircraft.', undefined, true],
      ['Battery back in, 20 seconds still, link, battery, GPS and readiness re-checked.'],
      ['Abort rules said out loud.', 'Anything unexpected: land, disarm, battery out.'],
    ]),

    section('x5-takeoff', 'inflight', 'Takeoff', [
      ['Mode Position. Throttle down. SD light ON.', 'No kill message.', true],
      ['Arm: throttle down, yaw right, hold one second.', 'Motors idle. If not, read the arming report. Do not retry blindly.'],
      ['Raise throttle smoothly through centre until the skids leave the ground.', 'Level lift-off, no yaw spin, no lean.', true],
      ['Hover at knee height for 5 seconds with the sticks centred.', 'Holds position. Any lean or spin: land and stop.', true],
    ]),
    section('x5-air', 'inflight', 'In the air', [
      ['Battery above 30 %.', 'At the low-battery warning, bring it home now.'],
      ['Aircraft in sight at all times.', undefined, true],
      ['Flying area clear of people and animals.', 'Anyone enters: land where it is.', true],
      ['Position hold steady, no drift or oscillation.'],
      ['Telemetry link up in QGroundControl.', 'Link loss does nothing by itself; the radio still flies it.'],
      ['Flight kept short.', 'Planned time not exceeded, pack above reserve.'],
    ]),

    section('x5-landing', 'landing', 'Approach and touchdown', [
      ['Over the pad, sticks released, aircraft stopped.'],
      ['Pad and the area around it clear.', undefined, true],
      ['Lower the throttle gently, then pull it fully down and hold.', 'Descends at about 0.7 m/s.'],
      ['Aircraft disarms by itself within two seconds of touchdown.', 'If not: throttle down, yaw left, hold one second.', true],
    ]),

    section('x5-shutdown', 'postlanding', 'Shutdown', [
      ['Press SD: light off, kill engaged. Say "killed" out loud.', 'After 5 seconds of kill the board disarms itself.', true],
      ['Battery out of the aircraft. Only now approach the props.', undefined, true],
      ['Motors felt by hand.', 'Warm is fine, hot is not.'],
      ['Props off before the aircraft goes in a case or a student touches it.'],
      ['Radio off last.'],
      ['Battery into the LiPo bag. Voltage noted.', 'Below 14.8 V after a short flight: log it. Store at 3.8 V per cell.'],
    ]),

    section('x5-review', 'postflight', 'Same-day review', [
      ['Walk the airframe: props, arms, motor bells, cable ties, GPS mast, antennas.'],
      ['Flight log copied off the SD card into the project logs folder.', 'A card reader is fastest.'],
      ['Log opened in the log viewer: attitude, motor outputs, battery sag, vibration, failsafe events.', 'Motor pairs within tens of microseconds of each other in a hover.'],
      ['SD card back in the Pixhawk.', undefined, true],
      ['Flight written into the build log: site, wind, duration, pack start and end, what was flown, anything odd.'],
      ['Parameters compared with the baseline.', 'A flight should move nothing.'],
      ['Decision logged: is the aircraft ready for the next flight?'],
    ]),
  ],
};

const GENERIC: ChecklistTemplate = {
  id: 'builtin-generic',
  name: 'Generic multirotor',
  aircraft: 'Any multirotor',
  description: 'A short starting point. Duplicate it and add your aircraft’s own numbers.',
  builtIn: true,
  sections: [
    section('gn-gate', 'preflight', 'Before leaving', [
      ['Registration, pilot credentials and Remote ID are in order for where you fly.', undefined, true],
      ['Airspace and site checked.', undefined, true],
      ['Weather suitable.'],
      ['Batteries charged and checked with a meter.', undefined, true],
      ['Kit packed, spare props included.'],
    ]),
    section('gn-airframe', 'preflight', 'Airframe and power', [
      ['Frame, arms and landing gear undamaged and tight.', undefined, true],
      ['Motors spin freely, props undamaged, correct way round and tight.', undefined, true],
      ['Battery secure, connectors seated.', undefined, true],
      ['Radio on before the aircraft. Correct model selected.', undefined, true],
      ['Ground station connected. Battery, GPS and readiness all good.', undefined, true],
      ['Failsafe and return-to-home settings known by the pilot.'],
      ['Home position set. People clear and behind the pilot.', undefined, true],
    ]),
    section('gn-flight', 'inflight', 'In flight', [
      ['Low hover first: stable, no drift, no unusual sound.', undefined, true],
      ['Aircraft in sight. Area clear.', undefined, true],
      ['Battery watched. Land with reserve.'],
    ]),
    section('gn-landing', 'landing', 'Landing', [
      ['Landing area clear.', undefined, true],
      ['Gentle descent, throttle down, disarmed.', undefined, true],
    ]),
    section('gn-shutdown', 'postlanding', 'Shutdown', [
      ['Aircraft disarmed and battery out before anyone approaches the props.', undefined, true],
      ['Radio off last. Battery stored safely.'],
    ]),
    section('gn-review', 'postflight', 'Review', [
      ['Airframe inspected.'],
      ['Log saved and looked at.'],
      ['Flight recorded.'],
    ]),
  ],
};

export const BUILT_IN_TEMPLATES: ChecklistTemplate[] = [X500, GENERIC];

export function builtInById(id: string): ChecklistTemplate | undefined {
  const t = BUILT_IN_TEMPLATES.find((x) => x.id === id);
  return t ? structuredClone(t) : undefined;
}
