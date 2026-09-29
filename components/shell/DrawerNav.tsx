// DrawerNav — the left drawer's top chrome: the domain PAGER
// (chevron cycler bar) with the FAVORITES section under it (label row +
// starred-domain rows: always-visible trash, drag-to-reorder w/ drop preview).
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { APP_REGISTRY, appByRoute } from '@/lib/registry';
import { useFavoritesStore } from '@/stores/core/favoritesStore';

export function DrawerNav() {
  const router = useRouter();
  const segment = usePathname()?.split('/').filter(Boolean)[0] ?? null;
  const active = appByRoute(segment);
  const favorites = useFavoritesStore((s) => s.favorites);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const reorderFavorites = useFavoritesStore((s) => s.reorderFavorites);
  const pruneFavorites = useFavoritesStore((s) => s.pruneFavorites);

  // drag-to-reorder state: which row is in flight, and the insertion gap under
  // the cursor (0..length). Preview = an accent line at the gap.
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const clearDrag = () => {
    setDragIndex(null);
    setDropIndex(null);
  };
  // a gap adjacent to the dragged row is a no-op — don't preview it
  const showGap = (gap: number) =>
    dragIndex !== null && dropIndex === gap && gap !== dragIndex && gap !== dragIndex + 1;

  const domains = APP_REGISTRY.filter((a) => a.navigation.showInSidebar);
  const index = domains.findIndex((a) => a.id === active.id);

  // stale favorite ids (renamed/removed domains) would render as invisible rows
  // and leave the section silently blank — prune them against the live registry
  useEffect(() => {
    const valid = new Set(domains.map((d) => d.id));
    if (favorites.some((id) => !valid.has(id))) {
      pruneFavorites([...valid]);
    }
  }, [favorites, domains, pruneFavorites]);

  const cycle = (dir: 1 | -1) => {
    const next = domains[(index + dir + domains.length) % domains.length];
    router.push(`/${next.route}`);
  };

  const chevronBtn =
    'p-1 rounded text-ink-muted transition-all border border-transparent hover:bg-surface-raised hover:shadow-sm hover:border-edge';

  return (
    <div className="shrink-0">
      {/* domain pager */}
      <div className="border-b border-edge p-4">
        <div className="flex items-center justify-between rounded-md border border-edge bg-control p-1 shadow-sm transition-colors duration-200">
          <button onClick={() => cycle(-1)} className={chevronBtn} aria-label="Previous domain">
            <ChevronLeft size={16} />
          </button>
          <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <active.icon size={14} className={active.theme.colorClass} />
            {active.name}
          </span>
          <button onClick={() => cycle(1)} className={chevronBtn} aria-label="Next domain">
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      {/* favorites */}
      <div className="border-b border-edge px-3 pb-4 pt-3">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            Your Favorites
          </span>
          {favorites.length > 3 && (
            <ChevronDown size={14} strokeWidth={3} className="animate-pulse text-primary" />
          )}
        </div>
        <div
          className="max-h-[104px] space-y-1 overflow-y-auto overflow-x-hidden pr-1"
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropIndex(null);
          }}
        >
          {favorites.length === 0 ? (
            // the section keeps its place in the stack; the empty state is a
            // clean modest text line (Jacob's pick over a dressed-up well)
            <div className="px-2 py-2 text-xs italic text-ink-muted opacity-60">
              No favorites yet
            </div>
          ) : (
            <>
              {favorites.map((favId, idx) => {
                const app = domains.find((d) => d.id === favId);
                if (!app) return null;
                return (
                  <div key={app.id}>
                    {showGap(idx) && (
                      <div className="mx-2 mb-1 h-0.5 rounded-full bg-primary/70" />
                    )}
                    <div
                      className={`group relative cursor-grab active:cursor-grabbing ${
                        dragIndex === idx ? 'opacity-40' : ''
                      }`}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('application/x-fc-favorite', app.id);
                        // drag preview = the row itself (not the browser's link-URL ghost),
                        // anchored at the grab point
                        const rect = e.currentTarget.getBoundingClientRect();
                        e.dataTransfer.setDragImage(
                          e.currentTarget,
                          e.clientX - rect.left,
                          e.clientY - rect.top,
                        );
                        setDragIndex(idx);
                      }}
                      onDragEnd={clearDrag}
                      onDragOver={(e) => {
                        if (dragIndex === null) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDropIndex(e.clientY < rect.top + rect.height / 2 ? idx : idx + 1);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (dragIndex !== null && dropIndex !== null) {
                          reorderFavorites(dragIndex, dropIndex);
                        }
                        clearDrag();
                      }}
                    >
                      <Link
                        href={`/${app.route}`}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 pr-8 text-left text-sm text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                      >
                        <app.icon size={14} className={app.theme.colorClass} />
                        {app.name}
                      </Link>
                      <button
                        onClick={() => toggleFavorite(app.id)}
                        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                        title="Remove from favorites"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
              {showGap(favorites.length) && (
                <div className="mx-2 h-0.5 rounded-full bg-primary/70" />
              )}
            </>
          )}
        </div>
        {/* inset hairline under the list content — with the block's full-width
            border-b below it, the section ends on a double crispy edge */}
        <div className="mx-1 mt-3 h-px bg-edge" />
      </div>
    </div>
  );
}
