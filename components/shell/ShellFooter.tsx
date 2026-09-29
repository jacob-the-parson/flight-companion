// ShellFooter — the global 5-column action bar (future mobile toolbar).
// Shape: a rounded-top tray; each of the 5 slots is its own subtle tab with
// divot gaps between them. Domains declare columns via manifest.shellFooter.
'use client';
import { X } from 'lucide-react';
import type { AppDefinition } from '@/lib/registry.types';

function FooterNA() {
  return (
    <div className="flex select-none items-center justify-center gap-1 opacity-30 transition-opacity group-hover:opacity-60">
      <X size={11} />
      <span className="text-[10px] font-medium uppercase tracking-wide">N/A</span>
    </div>
  );
}

export function ShellFooter({ app }: { app: AppDefinition }) {
  return (
    <footer className="mx-2 grid h-10 shrink-0 grid-cols-5 gap-1.5 rounded-t-xl border-x border-t border-edge bg-surface-raised/85 px-1.5 pt-1.5 text-[11px] text-ink-muted shadow-vibe">
      {[0, 1, 2, 3, 4].map((i) => {
        const Slot = app.shellFooter?.[i] ?? null;
        return (
          <div
            key={i}
            className="group flex h-full items-center justify-center truncate rounded-t-lg border border-b-0 border-edge-strong/30 bg-control/60 transition-colors hover:bg-control hover:text-ink"
          >
            {Slot ? <Slot /> : <FooterNA />}
          </div>
        );
      })}
    </footer>
  );
}
