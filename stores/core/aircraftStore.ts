// Aircraft profiles — the cross-domain facts about the airframe being flown.
// The planner reads endurance from here, checklists name the aircraft, the log
// viewer compares what it sees against it. Persisted.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AircraftProfile {
  id: string;
  name: string;
  frame: string;
  autopilot: string;
  firmware: 'px4' | 'ardupilot';
  cells: number;
  capacityMah: number;
  /** Average current in a hover, amps. Measured from a log, not guessed. */
  hoverCurrentA: number;
  /** Share of the pack kept in reserve and never planned for, 0..1. */
  reserve: number;
  cruiseSpeedMs: number;
  notes: string;
}

/** The aircraft this project was started for. Hover current is the 14 to 16 A seen in
 *  the 2026-09-28 hover logs; capacity and cells are read off the pack label. */
export const DEFAULT_AIRCRAFT: AircraftProfile = {
  id: 'x500v2',
  name: 'X500 V2',
  frame: 'Holybro X500 V2, Quadrotor X',
  autopilot: 'Pixhawk 6C',
  firmware: 'px4',
  cells: 4,
  capacityMah: 5200,
  hoverCurrentA: 15,
  reserve: 0.3,
  cruiseSpeedMs: 5,
  notes: 'Motors: 1 front right CCW, 2 back left CCW, 3 front left CW, 4 back right CW.',
};

interface AircraftState {
  profiles: AircraftProfile[];
  activeId: string;
  setActive: (id: string) => void;
  addProfile: () => string;
  updateProfile: (id: string, patch: Partial<Omit<AircraftProfile, 'id'>>) => void;
  removeProfile: (id: string) => void;
}

export const useAircraftStore = create<AircraftState>()(
  persist(
    (set, get) => ({
      profiles: [DEFAULT_AIRCRAFT],
      activeId: DEFAULT_AIRCRAFT.id,
      setActive: (activeId) => set({ activeId }),
      addProfile: () => {
        const id = `ac-${Date.now().toString(36)}`;
        const base = get().profiles.find((p) => p.id === get().activeId) ?? DEFAULT_AIRCRAFT;
        set((s) => ({
          profiles: [...s.profiles, { ...base, id, name: `${base.name} copy` }],
          activeId: id,
        }));
        return id;
      },
      updateProfile: (id, patch) =>
        set((s) => ({
          profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),
      removeProfile: (id) =>
        set((s) => {
          if (s.profiles.length <= 1) return s; // never zero aircraft
          const profiles = s.profiles.filter((p) => p.id !== id);
          return { profiles, activeId: s.activeId === id ? profiles[0].id : s.activeId };
        }),
    }),
    { name: 'fc-aircraft' },
  ),
);

/** Usable flight time in minutes for a profile: capacity less reserve, at hover current. */
export function enduranceMinutes(p: AircraftProfile): number {
  if (p.hoverCurrentA <= 0) return 0;
  return ((p.capacityMah / 1000) * (1 - p.reserve) * 60) / p.hoverCurrentA;
}

export function useActiveAircraft(): AircraftProfile {
  return useAircraftStore((s) => s.profiles.find((p) => p.id === s.activeId) ?? s.profiles[0]);
}
