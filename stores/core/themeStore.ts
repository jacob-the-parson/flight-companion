// Theme + vibe state — USER UI PREFERENCES (surfaced in ModalProfile, not a
// domain). Persisted. ThemeSync mirrors both onto <html>.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Vibe = 'soft' | 'toon';

interface ThemeState {
  isDark: boolean;
  vibe: Vibe;
  toggleTheme: () => void;
  setVibe: (vibe: Vibe) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDark: false,
      vibe: 'soft',
      toggleTheme: () => set((s) => ({ isDark: !s.isDark })),
      setVibe: (vibe) => set({ vibe }),
    }),
    { name: 'fc-theme' },
  ),
);
