// What the desktop app offers the Live screen: three functions. The page cannot
// open a port; the desktop app can, and listens on this computer only. Absent
// in a browser, where the Live screen plays the practice flight instead.
//
// There is no function here that sends anything to an aircraft, and the desktop
// app has none to offer.
import type { LiveView } from './view.ts';

export interface LiveReply {
  /** True if the user has switched listening on. */
  listening: boolean;
  /** True if the port is held. False while another program holds it. */
  bound: boolean;
  port: number;
  view: LiveView | null;
}

export interface LiveBridge {
  version: number;
  start: () => Promise<LiveReply>;
  stop: () => Promise<LiveReply>;
  view: () => Promise<LiveReply>;
}

export function liveBridge(): LiveBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { flightCompanion?: { observer?: LiveBridge } }).flightCompanion?.observer;
  return b && typeof b.view === 'function' ? b : null;
}

/** What QGroundControl is told, in words the Live screen and the guide both use. */
export const FORWARDING_STEPS = [
  'Connect the aircraft to QGroundControl as usual, by USB cable or telemetry radio.',
  'In QGroundControl open Application Settings, then MAVLink.',
  'Switch on "Enable MAVLink forwarding".',
  'Set the host to localhost:14445.',
  'Come back here and switch listening on.',
] as const;
