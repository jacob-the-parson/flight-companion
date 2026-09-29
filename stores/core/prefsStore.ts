// Preferences — who is flying and how numbers are shown. Local to this browser;
// there are no accounts. Persisted.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UnitSystem = 'metric' | 'imperial';

interface PrefsState {
  pilotName: string;
  pilotRole: string;
  units: UnitSystem;
  /** Learn mode: examples in each library, and the explanations beside the tools. */
  learn: boolean;
  setLearn: (learn: boolean) => void;
  setPilotName: (name: string) => void;
  setPilotRole: (role: string) => void;
  setUnits: (units: UnitSystem) => void;
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      pilotName: 'Pilot',
      pilotRole: 'Instructor',
      units: 'metric',
      learn: true,
      setLearn: (learn) => set({ learn }),
      setPilotName: (pilotName) => set({ pilotName }),
      setPilotRole: (pilotRole) => set({ pilotRole }),
      setUnits: (units) => set({ units }),
    }),
    { name: 'fc-prefs' },
  ),
);
