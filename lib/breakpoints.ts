// Layout tiers — single source of truth for the responsive drawer policy.
//   wide    ≥1280px  both drawers + workspace may be open together
//   medium  ≥768px   workspace + ONE drawer; opening one closes the other
//   compact <768px   drawers overlay the workspace, one at a time
import type { LayoutTier } from './registry.types';

export const TIER_QUERIES: Record<Exclude<LayoutTier, 'compact'>, string> = {
  wide: '(min-width: 1280px)',
  medium: '(min-width: 768px)',
};

export function resolveTier(): LayoutTier {
  if (typeof window === 'undefined') return 'wide';
  if (window.matchMedia(TIER_QUERIES.wide).matches) return 'wide';
  if (window.matchMedia(TIER_QUERIES.medium).matches) return 'medium';
  return 'compact';
}
