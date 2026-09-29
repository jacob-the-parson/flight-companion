// Site — the data bus between domains for "where were we". The log viewer writes
// the takeoff point of the log it opens; the planner can start its map there.
// Domains never import each other's stores; they meet here. Persisted.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface TakeoffPoint {
  lat: number;
  lng: number;
  /** Where the point came from, shown to the user: a log name, "map click". */
  source: string;
  at: number;
}

interface SiteState {
  lastTakeoff: TakeoffPoint | null;
  setLastTakeoff: (p: Omit<TakeoffPoint, 'at'>) => void;
  clearLastTakeoff: () => void;
}

export const useSiteStore = create<SiteState>()(
  persist(
    (set) => ({
      lastTakeoff: null,
      setLastTakeoff: (p) => set({ lastTakeoff: { ...p, at: Date.now() } }),
      clearLastTakeoff: () => set({ lastTakeoff: null }),
    }),
    { name: 'fc-site' },
  ),
);
