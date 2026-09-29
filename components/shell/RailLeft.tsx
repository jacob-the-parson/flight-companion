// RailLeft — the COLLAPSED left unit: a slim icon toolbar (the drawer never
// just vanishes). Top→bottom: FC mark (opens drawer) · divider · active domain
// icon over its chevrons · favorites star + starred app icons (scrolls) ·
// aircraft · pilot initial · theme switcher.
'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight, Moon, Plane, Star, Sun } from 'lucide-react';
import { APP_REGISTRY, appByRoute } from '@/lib/registry';
import { useShellStore } from '@/stores/core/shellStore';
import { useFavoritesStore } from '@/stores/core/favoritesStore';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useThemeStore } from '@/stores/core/themeStore';
import { useActiveAircraft } from '@/stores/core/aircraftStore';

export function RailLeft() {
  const router = useRouter();
  const toggleDrawer = useShellStore((s) => s.toggleDrawer);
  const favorites = useFavoritesStore((s) => s.favorites);
  const pilotName = usePrefsStore((s) => s.pilotName);
  const isDark = useThemeStore((s) => s.isDark);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const aircraft = useActiveAircraft();

  const segment = usePathname()?.split('/').filter(Boolean)[0] ?? null;
  const active = appByRoute(segment);
  const domains = APP_REGISTRY.filter((a) => a.navigation.showInSidebar);
  const index = domains.findIndex((a) => a.id === active.id);
  const cycle = (dir: 1 | -1) => {
    const next = domains[(index + dir + domains.length) % domains.length];
    router.push(`/${next.route}`);
  };

  const open = () => toggleDrawer('left');
  const iconBtn =
    'flex h-8 w-8 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink';
  // chevrons sit side by side — w-8 ×2 = the full 64px rail, so hover pills hit the
  // rail edge; w-7 leaves a 4px gutter each side
  const chevBtn =
    'flex h-8 w-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink';

  return (
    <div className="flex h-full w-16 shrink-0 flex-col items-center gap-1 py-3">
      {/* brand = open button */}
      <button
        onClick={open}
        title="Open panel"
        className="mb-1 flex h-9 w-9 rotate-12 items-center justify-center rounded-lg bg-secondary shadow-sm transition-transform hover:scale-105"
      >
        <span className="-rotate-12 text-[10px] font-bold text-white">FC</span>
      </button>

      <div className="my-1 h-px w-8 bg-edge" />

      {/* domain switcher: active icon above, chevrons below */}
      <active.icon size={16} className={`${active.theme.colorClass} mb-1`} />
      <div className="flex items-center">
        <button onClick={() => cycle(-1)} className={chevBtn} title="Previous domain">
          <ChevronLeft size={15} />
        </button>
        <button onClick={() => cycle(1)} className={chevBtn} title="Next domain">
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="my-1 h-px w-8 bg-edge" />

      {/* favorites */}
      <button onClick={open} className={iconBtn} title="Favorites">
        <Star size={15} />
      </button>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto">
        {favorites.map((favId) => {
          const app = domains.find((d) => d.id === favId);
          if (!app) return null;
          return (
            <Link key={app.id} href={`/${app.route}`} className={iconBtn} title={app.name}>
              <app.icon size={15} className={app.theme.colorClass} />
            </Link>
          );
        })}
      </div>

      <div className="my-1 h-px w-8 bg-edge" />

      {/* aircraft */}
      <button onClick={open} className={iconBtn} title={`Aircraft: ${aircraft.name}`}>
        <Plane size={15} />
      </button>

      {/* pilot, then theme */}
      <button onClick={open} title={pilotName} className="relative mt-1">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary-high text-xs font-semibold text-secondary-shadow transition-transform hover:scale-105">
          {pilotName.charAt(0).toUpperCase() || 'P'}
        </div>
      </button>
      <button onClick={toggleTheme} className={iconBtn} title="Toggle theme">
        {isDark ? <Sun size={15} /> : <Moon size={15} />}
      </button>
    </div>
  );
}
