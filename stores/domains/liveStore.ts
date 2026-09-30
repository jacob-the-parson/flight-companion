// Live domain store — what is being heard, and from where.
//
// Two sources:
//   - 'aircraft': the desktop app listens on this computer for the copy of the
//     aircraft's messages that QGroundControl forwards, and this store asks it
//     twice a second what it holds. Desktop app only.
//   - 'practice': a made-up flight of one minute, read in the browser by the
//     same MAVLink reader, round and round. Works everywhere.
//
// Nothing is remembered between visits but the tab: what an aircraft said a
// minute ago is not what it says now.
//
// The app never sends anything to an aircraft. There is no action here that
// could: the desktop app offers start, stop and view, and nothing else.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { MavlinkReader } from '@/lib/mavlink/decode';
import { liveBridge, type LiveReply } from '@/lib/observer/bridge';
import { DEFAULT_SETTINGS, ObserverState } from '@/lib/observer/state';
import { liveView, type LiveView } from '@/lib/observer/view';

export type LiveSource = 'off' | 'practice' | 'aircraft';
export type LiveTab = 'overview' | 'messages' | 'traffic';

export const PRACTICE_URL = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/data/practice-telemetry.json`;
const ASK_EVERY_MS = 500;
const PLAY_EVERY_MS = 100;

interface Practice {
  seconds: number;
  packets: [number, string][];
}

interface LiveState {
  source: LiveSource;
  view: LiveView | null;
  tab: LiveTab;
  /** Whether this is the desktop app. null until looked for, after the page has loaded. */
  desktop: boolean | null;
  /** For 'aircraft': whether the port is held. */
  bound: boolean;
  port: number;
  notice: string | null;

  look: () => void;
  setTab: (tab: LiveTab) => void;
  startPractice: () => Promise<void>;
  listen: () => Promise<void>;
  stop: () => Promise<void>;
  dismissNotice: () => void;
}

// timers and the practice flight live outside the store: they are not state to draw
let timer: ReturnType<typeof setInterval> | null = null;
let practice: Practice | null = null;

function halt(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

const bytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

export const useLiveStore = create<LiveState>()(
  persist(
    (set, get) => ({
      source: 'off',
      view: null,
      tab: 'overview',
      desktop: null,
      bound: false,
      port: DEFAULT_SETTINGS.port,
      notice: null,

      look: () => {
        const bridge = liveBridge();
        set({ desktop: bridge !== null });
        // the desktop app may already be listening: the window was closed and opened again
        if (bridge && get().source === 'off') {
          void bridge
            .view()
            .then((r) => {
              if (r.listening && get().source === 'off') void get().listen();
            })
            .catch(() => undefined);
        }
      },

      setTab: (tab) => set({ tab }),
      dismissNotice: () => set({ notice: null }),

      startPractice: async () => {
        await get().stop();
        try {
          if (!practice) {
            const r = await fetch(PRACTICE_URL);
            if (!r.ok) throw new Error(`the practice flight could not be fetched (${r.status})`);
            const doc = (await r.json()) as { schema?: string; seconds?: number; packets?: [number, string][] };
            if (doc.schema !== 'flight-companion/practice-telemetry@1' || !Array.isArray(doc.packets) || typeof doc.seconds !== 'number') {
              throw new Error('the practice flight is not in the form this app reads');
            }
            practice = { seconds: doc.seconds, packets: doc.packets };
          }
        } catch (e) {
          set({ notice: e instanceof Error ? e.message : 'The practice flight could not be read.' });
          return;
        }
        const flight = practice;
        let state = new ObserverState(Date.now() / 1000);
        let reader = new MavlinkReader();
        let began = performance.now();
        let base = Date.now() / 1000;
        let next = 0;
        set({ source: 'practice', view: liveView(state, base, DEFAULT_SETTINGS), notice: null });
        timer = setInterval(() => {
          let t = (performance.now() - began) / 1000;
          if (t >= flight.seconds) {
            // round again, as a new flight: nothing is carried over
            state = new ObserverState(Date.now() / 1000);
            reader = new MavlinkReader();
            began = performance.now();
            base = Date.now() / 1000;
            next = 0;
            t = 0;
          }
          while (next < flight.packets.length && flight.packets[next][0] <= t) {
            const [at, hex] = flight.packets[next++];
            const raw = bytes(hex);
            state.noteBytes(raw.length);
            for (const packet of reader.push(raw)) state.handle(packet, base + at);
            reader.clear();
          }
          set({ view: liveView(state, base + t, DEFAULT_SETTINGS) });
        }, PLAY_EVERY_MS);
      },

      listen: async () => {
        const bridge = liveBridge();
        if (!bridge) {
          set({ notice: 'Listening for an aircraft needs the desktop app: a page in a browser cannot open the port QGroundControl forwards to. The practice flight works here.' });
          return;
        }
        await get().stop();
        const take = (r: LiveReply) => set({ bound: r.bound, port: r.port, view: r.view });
        try {
          const r = await bridge.start();
          take(r);
          set({ source: 'aircraft', notice: null });
        } catch (e) {
          set({ notice: `Listening could not be started: ${e instanceof Error ? e.message : String(e)}` });
          return;
        }
        timer = setInterval(() => {
          void bridge
            .view()
            .then((r) => {
              if (get().source === 'aircraft') take(r);
            })
            .catch(() => undefined);
        }, ASK_EVERY_MS);
      },

      stop: async () => {
        halt();
        const was = get().source;
        set({ source: 'off', view: null, bound: false });
        if (was === 'aircraft') await liveBridge()?.stop().catch(() => undefined);
      },
    }),
    {
      name: 'fc-live',
      // what was heard is not kept: only which tab was open
      partialize: (s) => ({ tab: s.tab }),
    },
  ),
);

/** One line for the footer and the dashboard. */
export function liveLine(source: LiveSource, view: LiveView | null, bound: boolean): string {
  if (source === 'off') return 'Not listening';
  if (source === 'aircraft' && !bound) return 'Port in use';
  if (!view?.vehicle) return source === 'practice' ? 'Practice' : 'Listening, nothing heard';
  if (source === 'aircraft' && !view.heard) return 'Link lost';
  return `${source === 'practice' ? 'Practice: ' : ''}${view.vehicle.mode} ${view.vehicle.armed ? 'armed' : 'disarmed'}`;
}
