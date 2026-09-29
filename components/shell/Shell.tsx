// Shell — the chrome socket, left-unit layout:
//   [ LEFT UNIT: full-height island — expanded drawer OR icon rail ]
//   [ RIGHT COLUMN: header / workspace island + right drawer ]
//   [ FOOTER TRAY: full width, five keycaps ]
// The left unit never disappears on desktop — "closed" springs it down to the
// RailLeft icon toolbar. Compact tier: rail hidden, drawers overlay the page.
// Widths: left 256 expanded / 64 rail · right 288 (fixed; frames animate,
// content never resizes).
'use client';
import { useEffect, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { Wrench } from 'lucide-react';
import { appByRoute } from '@/lib/registry';
import { TIER_QUERIES, resolveTier } from '@/lib/breakpoints';
import { useShellStore } from '@/stores/core/shellStore';
import { ShellHeader } from './ShellHeader';
import { ShellFooter } from './ShellFooter';
import { DrawerShell } from './DrawerShell';
import { DrawerLeft } from './DrawerLeft';
import { RailLeft } from './RailLeft';

const SPRING = { type: 'spring', bounce: 0.2, duration: 0.5 } as const;
const RAIL_W = 64;
const LEFT_W = 256;
const RIGHT_W = 288;

export function Shell({ children }: { children: ReactNode }) {
  const tier = useShellStore((s) => s.tier);
  const leftOpen = useShellStore((s) => s.leftOpen);
  const rightOpen = useShellStore((s) => s.rightOpen);
  const setTier = useShellStore((s) => s.setTier);
  const closeDrawers = useShellStore((s) => s.closeDrawers);

  const segment = usePathname()?.split('/').filter(Boolean)[0] ?? null;
  const app = appByRoute(segment);
  const right = app.drawerRight;

  useEffect(() => {
    const sync = () => setTier(resolveTier());
    sync();
    const mqls = Object.values(TIER_QUERIES).map((q) => window.matchMedia(q));
    mqls.forEach((m) => m.addEventListener('change', sync));
    return () => mqls.forEach((m) => m.removeEventListener('change', sync));
  }, [setTier]);

  const compact = tier === 'compact';

  return (
    <div className="ambient-bg flex h-dvh flex-col overflow-hidden bg-surface-sunken font-sans print:h-auto print:overflow-visible print:bg-white">
      <div className="relative z-10 flex min-h-0 flex-1">
        {/* LEFT UNIT — full-height island: expanded drawer <-> icon rail */}
        {!compact && (
          <motion.aside
            initial={false}
            animate={{ width: leftOpen ? LEFT_W : RAIL_W }}
            transition={SPRING}
            className="z-30 mb-3 ml-3 mt-3 box-content shrink-0 overflow-hidden rounded-xl border border-edge bg-surface-raised/85 shadow-vibe print:hidden"
          >
            <AnimatePresence initial={false} mode="popLayout">
              {leftOpen ? (
                <motion.div
                  key="drawer"
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={SPRING}
                  className="h-full"
                >
                  <DrawerLeft app={app} />
                </motion.div>
              ) : (
                <motion.div
                  key="rail"
                  initial={{ opacity: 0, x: 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 16 }}
                  transition={SPRING}
                  className="h-full"
                >
                  <RailLeft />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.aside>
        )}

        {/* RIGHT COLUMN — header + workspace/right-drawer */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ShellHeader app={app} />

          <div className="relative flex min-h-0 flex-1">
            {/* compact-tier backdrop + overlay drawer */}
            <AnimatePresence>
              {compact && (leftOpen || rightOpen) && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 z-20 bg-black/50"
                  onClick={closeDrawers}
                />
              )}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {compact && leftOpen && (
                <motion.aside
                  initial={{ x: -(LEFT_W + 24) }}
                  animate={{ x: 0 }}
                  exit={{ x: -(LEFT_W + 24) }}
                  transition={SPRING}
                  className="absolute inset-y-2 left-2 z-30 overflow-hidden rounded-xl border border-edge bg-surface-raised shadow-2xl"
                >
                  <DrawerLeft app={app} />
                </motion.aside>
              )}
            </AnimatePresence>

            {/* the workspace ISLAND */}
            <main className="relative mx-3 my-3 min-w-0 flex-1 overflow-hidden rounded-xl border border-edge bg-surface/85 shadow-vibe print:m-0 print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
              {children}
            </main>

            {/* right drawer — always openable; placeholder when the domain has none */}
            <AnimatePresence initial={false}>
              {rightOpen && (
                <motion.aside
                  initial={compact ? { x: RIGHT_W + 24 } : { width: 0 }}
                  animate={compact ? { x: 0 } : { width: RIGHT_W }}
                  exit={compact ? { x: RIGHT_W + 24 } : { width: 0 }}
                  transition={SPRING}
                  className={`box-content overflow-hidden border border-edge bg-surface-raised/85 print:hidden ${
                    compact
                      ? 'absolute inset-y-2 right-2 z-30 rounded-xl bg-surface-raised shadow-2xl'
                      : 'my-3 mr-3 rounded-xl shadow-vibe'
                  }`}
                >
                  <div className="flex h-full w-72 shrink-0 flex-col">
                    {right ? (
                      <DrawerShell app={app} side="right" def={right} />
                    ) : (
                      <>
                        {/* even empty, the right drawer keeps its Tools chrome */}
                        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-4">
                          <Wrench size={14} className="text-ink-muted" />
                          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                            Tools
                          </h2>
                        </div>
                        <div className="flex flex-1 items-center justify-center p-4 text-center text-sm italic text-ink-muted opacity-60">
                          No tools for this domain
                        </div>
                      </>
                    )}
                  </div>
                </motion.aside>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* FOOTER — full width, top layer: always available (the field toolbar) */}
      <div className="relative z-50 print:hidden">
        <ShellFooter app={app} />
      </div>
    </div>
  );
}
