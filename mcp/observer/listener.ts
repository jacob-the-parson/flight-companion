// The observer's ear: one UDP socket that listens for the copy of the
// aircraft's messages that QGroundControl forwards, and fills an ObserverState.
//
// IT LISTENS AND CANNOT SEND. The socket's ways of sending are replaced, before
// it is bound, with a function that raises, and they cannot be put back. The
// checks try to send and must fail (scripts/verify-observer-node.mjs).
//
// It is used by the MCP server beside this file and by the desktop app.
import { createSocket, type Socket } from 'node:dgram';
import { MavlinkReader } from '../../lib/mavlink/decode.ts';
import { ObserverState, type ObserverSettings } from '../../lib/observer/state.ts';

export const NEVER = 'the observer never transmits';

export function refuse(): never {
  throw new Error(NEVER);
}

/** The ways a UDP socket has of sending, or of being pointed at somewhere to send to. */
export const SENDING = ['send', 'connect', 'setBroadcast', 'setMulticastTTL', 'setTTL', 'addMembership'] as const;

/** A socket that can be bound and heard from, and nothing else. */
export function listeningSocket(): Socket {
  // an address in use is an error to be told about, not shared: two listeners on one port starve each other
  const socket = createSocket({ type: 'udp4', reuseAddr: false });
  for (const name of SENDING) {
    Object.defineProperty(socket, name, { value: refuse, writable: false, configurable: false, enumerable: false });
  }
  return socket;
}

export interface Listening {
  state: ObserverState;
  settings: ObserverSettings;
  /** True once the port is held. */
  bound(): boolean;
  stop(): Promise<void>;
  /** For the checks only: the socket itself. */
  socket(): Socket | null;
}

const seconds = (): number => Date.now() / 1000;

/** Settings from the environment, as the Python observer reads them. */
export function settingsFromEnv(env: NodeJS.ProcessEnv = process.env): ObserverSettings {
  const port = Number(env.QGC_FWD_PORT ?? '14445');
  return {
    host: env.QGC_FWD_HOST || '127.0.0.1',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 14445,
    // exactly 1, and nothing like it
    showPlace: env.FC_OBSERVER_PLACE === '1',
  };
}

/**
 * Starts listening. If the port is held by another program it says so in the
 * state's errors and tries again every two seconds, so that closing the other
 * program is enough.
 */
export function listen(settings: ObserverSettings, o: { retryMs?: number; onChange?: () => void } = {}): Listening {
  const state = new ObserverState(seconds());
  const reader = new MavlinkReader();
  let socket: Socket | null = null;
  let held = false;
  let stopped = false;
  let again: NodeJS.Timeout | null = null;

  const open = () => {
    if (stopped) return;
    const s = listeningSocket();
    socket = s;
    s.on('error', (err: NodeJS.ErrnoException) => {
      held = false;
      const inUse = err.code === 'EADDRINUSE' || err.code === 'EACCES';
      state.noteError(
        inUse
          ? `UDP ${settings.port} is already held by another program, probably an observer started by another assistant session or by the desktop app. Close that one. (${err.code})`
          : `${err.code ?? 'error'}: ${err.message}`,
        seconds(),
      );
      o.onChange?.();
      try {
        s.close();
      } catch {
        // it was never open
      }
      if (socket === s) socket = null;
      if (!stopped) again = setTimeout(open, o.retryMs ?? 2000);
    });
    s.on('message', (data: Buffer) => {
      state.noteBytes(data.length);
      const now = seconds();
      try {
        for (const packet of reader.push(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))) state.handle(packet, now);
      } catch (e) {
        state.noteError(`a packet could not be read: ${e instanceof Error ? e.message : String(e)}`, now);
      }
      reader.clear();
      o.onChange?.();
    });
    s.on('listening', () => {
      held = true;
      o.onChange?.();
    });
    s.bind({ port: settings.port, address: settings.host, exclusive: true });
  };
  open();

  return {
    state,
    settings,
    bound: () => held,
    socket: () => socket,
    stop: () =>
      new Promise<void>((resolve) => {
        stopped = true;
        held = false;
        if (again) clearTimeout(again);
        const s = socket;
        socket = null;
        if (!s) return resolve();
        try {
          s.close(() => resolve());
        } catch {
          resolve();
        }
      }),
  };
}
