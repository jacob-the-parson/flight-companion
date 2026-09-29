// Favorites — starred domains (activeDomain is owned by ROUTING in the Next
// app, so this store holds only the stars). Persisted to localStorage for now;
// swap to idb-keyval storage when the storage service lands.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface FavoritesState {
  favorites: string[];
  toggleFavorite: (appId: string) => void;
  /** Move the favorite at `from` so it lands at `to` (indices in the list). */
  reorderFavorites: (from: number, to: number) => void;
  /** Drop ids that no longer exist in the registry (domain renames/removals) —
   *  stale ids otherwise render as INVISIBLE rows and the section looks blank. */
  pruneFavorites: (validIds: string[]) => void;
}

export const useFavoritesStore = create<FavoritesState>()(
  persist(
    (set) => ({
      favorites: [],
      toggleFavorite: (appId) =>
        set((s) => ({
          favorites: s.favorites.includes(appId)
            ? s.favorites.filter((id) => id !== appId)
            : [...s.favorites, appId],
        })),
      pruneFavorites: (validIds) =>
        set((s) => {
          const valid = new Set(validIds);
          const pruned = s.favorites.filter((id) => valid.has(id));
          return pruned.length === s.favorites.length ? s : { favorites: pruned };
        }),
      reorderFavorites: (from, to) =>
        set((s) => {
          if (from === to || from < 0 || from >= s.favorites.length) return s;
          const next = [...s.favorites];
          const [moved] = next.splice(from, 1);
          next.splice(to > from ? to - 1 : to, 0, moved);
          return { favorites: next };
        }),
    }),
    { name: 'fc-favorites' },
  ),
);
