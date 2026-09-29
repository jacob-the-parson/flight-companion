// Shell chrome state. THE drawer policy lives here (in actions), never in components:
// components call toggleDrawer(side) and render whatever the store says.
import { create } from 'zustand';
import type { DrawerSide, LayoutTier } from '@/lib/registry.types';

interface ShellState {
  tier: LayoutTier;
  leftOpen: boolean;
  rightOpen: boolean;
  /** Drawer pagination memory, keyed `${appId}:${side}` -> pageId. */
  activeDrawerPage: Record<string, string>;

  setTier: (tier: LayoutTier) => void;
  toggleDrawer: (side: DrawerSide) => void;
  closeDrawers: () => void;
  setDrawerPage: (appId: string, side: DrawerSide, pageId: string) => void;
}

export const useShellStore = create<ShellState>((set, get) => ({
  tier: 'wide',
  leftOpen: true,
  rightOpen: false,
  activeDrawerPage: {},

  setTier: (tier) => {
    const { leftOpen, rightOpen } = get();
    // shrinking below wide with both drawers open -> keep left, drop right
    const bothOpen = leftOpen && rightOpen;
    set({
      tier,
      rightOpen: tier !== 'wide' && bothOpen ? false : rightOpen,
      // entering compact: drawers become overlays; start closed for a clear view
      ...(tier === 'compact' ? { leftOpen: false, rightOpen: false } : null),
    });
  },

  toggleDrawer: (side) => {
    const { tier, leftOpen, rightOpen } = get();
    const isOpen = side === 'left' ? leftOpen : rightOpen;
    if (isOpen) {
      set(side === 'left' ? { leftOpen: false } : { rightOpen: false });
      return;
    }
    if (tier === 'wide') {
      set(side === 'left' ? { leftOpen: true } : { rightOpen: true });
      return;
    }
    // medium + compact: one drawer at a time — opening one closes the other
    set({ leftOpen: side === 'left', rightOpen: side === 'right' });
  },

  closeDrawers: () => set({ leftOpen: false, rightOpen: false }),

  setDrawerPage: (appId, side, pageId) =>
    set((s) => ({ activeDrawerPage: { ...s.activeDrawerPage, [`${appId}:${side}`]: pageId } })),
}));
