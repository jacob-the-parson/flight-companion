// DrawerShell — the ONE drawer chrome every domain gets (Jacob's convention):
//   [ TOOLS TITLE BAR — Wrench + 'Tools' by default, manifest-overridable ]
//   [ optional 3-col subheader ] [ pager (tabs ≤4, cycler beyond) ]
//   [ scrollable active page ]  [ optional 3-col subfooter ]
// Mirrors the left unit's segmented rhythm. Domains declare pages; pagination
// memory lives in shellStore per app+side.
'use client';
import { ChevronLeft, ChevronRight, Wrench } from 'lucide-react';
import type { AppDefinition, DrawerDefinition, DrawerSide } from '@/lib/registry.types';
import { useShellStore } from '@/stores/core/shellStore';

interface DrawerShellProps {
  app: AppDefinition;
  side: DrawerSide;
  def: DrawerDefinition;
}

export function DrawerShell({ app, side, def }: DrawerShellProps) {
  const activeDrawerPage = useShellStore((s) => s.activeDrawerPage);
  const setDrawerPage = useShellStore((s) => s.setDrawerPage);

  const key = `${app.id}:${side}`;
  const page = def.pages.find((p) => p.id === activeDrawerPage[key]) ?? def.pages[0];
  const pageIndex = def.pages.indexOf(page);
  const Content = page.content;

  const TitleIcon = def.icon ?? Wrench;
  const title = def.title ?? 'Tools';

  const cycle = (dir: 1 | -1) => {
    const next = def.pages[(pageIndex + dir + def.pages.length) % def.pages.length];
    setDrawerPage(app.id, side, next.id);
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col text-sm">
      {/* the TOOLS title bar — the drawer announces itself */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-edge px-4">
        <TitleIcon size={14} className="text-ink-muted" />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{title}</h2>
      </div>

      {/* optional 3-col subheader */}
      {def.header && (
        <div className="grid h-10 shrink-0 grid-cols-3 items-center border-b border-edge px-2 text-xs">
          {def.header.concat([undefined, undefined, undefined]).slice(0, 3).map((Slot, i) => (
            <div key={i} className="flex items-center justify-center">{Slot ? <Slot /> : null}</div>
          ))}
        </div>
      )}

      {/* pager strip */}
      {def.pages.length > 1 && (
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-edge px-2">
          {def.pages.length <= 4 ? (
            <div className="flex w-full items-center justify-center gap-1">
              {def.pages.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setDrawerPage(app.id, side, p.id)}
                  className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors ${
                    p.id === page.id
                      ? 'bg-control font-semibold text-ink'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {p.icon ? <p.icon size={12} /> : null}
                  {p.title}
                </button>
              ))}
            </div>
          ) : (
            <>
              <button onClick={() => cycle(-1)} className="rounded p-1 text-ink-muted hover:bg-surface-sunken">
                <ChevronLeft size={14} />
              </button>
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                {page.icon ? <page.icon size={12} /> : null}
                {page.title}
                <span className="font-normal text-ink-muted">
                  {pageIndex + 1}/{def.pages.length}
                </span>
              </span>
              <button onClick={() => cycle(1)} className="rounded p-1 text-ink-muted hover:bg-surface-sunken">
                <ChevronRight size={14} />
              </button>
            </>
          )}
        </div>
      )}

      {/* active page — only this page is mounted */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Content />
      </div>

      {/* optional 3-col subfooter */}
      {def.footer && (
        <div className="grid h-9 shrink-0 grid-cols-3 items-center border-t border-edge px-2 text-xs">
          {def.footer.concat([undefined, undefined, undefined]).slice(0, 3).map((Slot, i) => (
            <div key={i} className="flex items-center justify-center">{Slot ? <Slot /> : null}</div>
          ))}
        </div>
      )}
    </div>
  );
}
