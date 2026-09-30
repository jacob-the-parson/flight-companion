// Dashboard — where things stand (one line per domain, from its own store),
// then the domain cards in the order of a flying day: plan, field, review.
'use client';
import Link from 'next/link';
import { ChevronRight, House, Star } from 'lucide-react';
import { APP_REGISTRY } from '@/lib/registry';
import type { AppCategory } from '@/lib/registry.types';
import { BadgeCategory, CATEGORY_TEXT } from '@/components/ui/BadgeCategory';
import type { AppDefinition } from '@/lib/registry.types';
import { phaseProgress } from '@/lib/checklists/types';
import { fmtDuration, fmtNum } from '@/lib/units';
import { enduranceMinutes, useActiveAircraft } from '@/stores/core/aircraftStore';
import { useFavoritesStore } from '@/stores/core/favoritesStore';
import { useActiveTemplate, useChecklistsStore } from '@/stores/domains/checklistsStore';
import { liveLine, useLiveStore } from '@/stores/domains/liveStore';
import { useLogsStore } from '@/stores/domains/logsStore';
import { useMissionsStore } from '@/stores/domains/missionsStore';
import { useParamsStore } from '@/stores/domains/paramsStore';
import { usePlannerStore, usePlanResult } from '@/stores/domains/plannerStore';

// the order of a flying day
const DAY: AppCategory[] = ['plan', 'field', 'review'];
const WHEN: Record<AppCategory, string> = {
  plan: 'Before the field',
  field: 'At the field',
  review: 'After the flight',
};

function Standing({ href, label, value, sub }: { href: string; label: string; value: string; sub: string }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-edge bg-surface-raised p-4 shadow-sm transition-colors hover:border-edge-strong/40"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
        <div className="truncate text-lg font-semibold text-ink">{value}</div>
        <div className="truncate text-xs text-ink-muted">{sub}</div>
      </div>
      <ChevronRight size={16} className="shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

export default function DashboardPage() {
  const favorites = useFavoritesStore((s) => s.favorites);
  const toggleFavorite = useFavoritesStore((s) => s.toggleFavorite);
  const cards = APP_REGISTRY.filter((a) => a.navigation.showInDashboard);

  const aircraft = useActiveAircraft();
  const template = useActiveTemplate();
  const run = useChecklistsStore((s) => s.run);
  const savedRuns = useChecklistsStore((s) => s.history.length);
  const planName = usePlannerStore((s) => s.name);
  const savedPlans = usePlannerStore((s) => s.saved.length);
  const plan = usePlanResult();
  const logCount = useLogsStore((s) => s.logs.length);
  const activeLog = useLogsStore((s) => s.logs.find((l) => l.id === s.activeId) ?? null);

  const mission = useMissionsStore((s) => s.mission);
  const savedMissions = useMissionsStore((s) => s.saved.length);
  const savedParams = useParamsStore((s) => s.saved);
  const liveSource = useLiveStore((s) => s.source);
  const liveNow = useLiveStore((s) => s.view);
  const liveBound = useLiveStore((s) => s.bound);

  const progress = phaseProgress(template.sections, run.results);
  const worst = activeLog?.summary?.findings[0];

  return (
    <main className="h-full w-full overflow-y-auto p-6 transition-colors duration-200 sm:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-1 flex items-center gap-3 text-2xl font-semibold text-ink">
          <House size={22} className="text-ink-muted" />
          Dashboard
        </h1>
        <p className="mb-6 text-sm text-ink-muted">
          {aircraft.name} · {aircraft.cells}S {fmtNum(aircraft.capacityMah, 0)} mAh · about{' '}
          {fmtNum(enduranceMinutes(aircraft), 0)} min of planned endurance
        </p>

        <section className="mb-8">
          <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-ink-muted">Where things stand</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Standing
              href="/planner"
              label="Plan"
              value={plan.ok ? fmtDuration(plan.flightTime) : 'No plan drawn'}
              sub={plan.ok ? `${planName} · ${plan.waypoints.length} waypoints · ${savedPlans} saved` : `${savedPlans} saved`}
            />
            <Standing
              href="/missions"
              label="Mission"
              value={mission ? `${mission.items.length} item${mission.items.length === 1 ? '' : 's'}` : 'None open'}
              sub={mission ? `${mission.name} · ${savedMissions} saved` : `${savedMissions} saved · open a mission file to see or convert it`}
            />
            <Standing
              href="/parameters"
              label="Parameters"
              value={savedParams.length > 0 ? `${savedParams.length} saved set${savedParams.length === 1 ? '' : 's'}` : 'None saved'}
              sub={savedParams[0] ? `Last: ${savedParams[0].name} · ${savedParams[0].count} parameters` : 'Open a parameter file to read or compare it'}
            />
            <Standing
              href="/checklists"
              label="Checklist"
              value={progress.criticalFailed > 0 ? 'No-go' : `${progress.done} of ${progress.total}`}
              sub={`${template.name} · ${savedRuns} saved run${savedRuns === 1 ? '' : 's'}`}
            />
            <Standing
              href="/live"
              label="Live"
              value={liveLine(liveSource, liveNow, liveBound)}
              sub={
                liveSource === 'off'
                  ? 'Listen for a connected aircraft, or play the practice flight'
                  : liveNow?.battery?.volts != null
                    ? `Battery ${fmtNum(liveNow.battery.volts, 2)} V${liveSource === 'practice' ? ' · made-up data' : ''}`
                    : 'Nothing heard yet'
              }
            />
            <Standing
              href="/logs"
              label="Last log"
              value={
                activeLog?.summary
                  ? `${fmtDuration(activeLog.summary.stats.airborneS)} in the air`
                  : logCount > 0
                    ? `${logCount} stored`
                    : 'None open'
              }
              sub={worst ? worst.title : activeLog ? activeLog.name : 'Open a .ulg file to review a flight'}
            />
          </div>
        </section>

        {(
          [
            {
              label: 'A flying day',
              grid: 'md:grid-cols-3',
              apps: DAY.flatMap((c) => cards.filter((a) => a.category === c)),
            },
            { label: 'Platform', grid: 'md:grid-cols-3', apps: cards.filter((a) => !a.category) },
          ] as { label: string; grid: string; apps: AppDefinition[] }[]
        ).map((section) =>
          section.apps.length === 0 ? null : (
            <section key={section.label} className="mb-8">
              <h2 className="mb-3 text-[11px] font-bold uppercase tracking-widest text-ink-muted">
                {section.label}
              </h2>
              <div className={`grid grid-cols-1 gap-4 ${section.grid}`}>
                {section.apps.map((app) => {
                  const isFavorite = favorites.includes(app.id);
                  return (
                    <Link
                      key={app.id}
                      href={`/${app.route}`}
                      className={`group relative flex cursor-pointer flex-col items-center gap-3 rounded-xl border border-edge bg-surface-raised p-5 pt-10 text-center shadow-sm transition-all hover:shadow-md ${app.theme.hoverBorder}`}
                    >
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          toggleFavorite(app.id);
                        }}
                        className={`absolute right-3 top-3 rounded-full p-1.5 transition-colors ${
                          isFavorite
                            ? 'text-yellow-500 hover:bg-yellow-50 hover:text-yellow-600 dark:hover:bg-yellow-500/10'
                            : 'text-ink-muted/40 hover:bg-surface-sunken hover:text-yellow-500'
                        }`}
                        title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <Star size={18} fill={isFavorite ? 'currentColor' : 'none'} />
                      </button>

                      {app.category && (
                        <span className="absolute left-3 top-3 flex items-center gap-1.5">
                          <BadgeCategory category={app.category} className="px-2" />
                          <span className={`text-[10px] font-medium ${CATEGORY_TEXT[app.category]}`}>
                            {WHEN[app.category]}
                          </span>
                        </span>
                      )}

                      <div
                        className={`flex h-14 w-14 items-center justify-center rounded-2xl transition-transform group-hover:scale-105 ${app.theme.bgClass}`}
                      >
                        <app.icon size={28} className={app.theme.colorClass} />
                      </div>
                      <div>
                        <h3 className="mb-1 text-base font-semibold text-ink">{app.name}</h3>
                        <p className="text-sm leading-snug text-ink-muted">{app.description}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ),
        )}

        <p className="pb-4 text-center text-xs text-ink-muted">
          Flight Companion works beside your ground station. It reads logs, missions and parameter files, and writes missions and parameter files.
          It never sends anything to an aircraft.
        </p>
      </div>
    </main>
  );
}
