// Settings — chevron-cycler tab bar; GLOBAL sub-area (units, theme, vibe, what
// is stored) + one sub-area per domain that declares manifest.settingsBody.
'use client';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Globe, Moon, Settings, Sun } from 'lucide-react';
import { APP_REGISTRY } from '@/lib/registry';
import { SegmentedTrack } from '@/components/ui/SegmentedTrack';
import { usePrefsStore, type UnitSystem } from '@/stores/core/prefsStore';
import { useThemeStore, type Vibe } from '@/stores/core/themeStore';

const VIBES: { id: Vibe; label: string; title: string }[] = [
  { id: 'soft', label: 'Soft', title: 'Soft shadows, soft edges' },
  { id: 'toon', label: 'Toon', title: 'Ink outlines, stepped shadows' },
];

const UNITS: { id: UnitSystem; label: string; title: string }[] = [
  { id: 'metric', label: 'Metric', title: 'Metres, metres per second, hectares' },
  { id: 'imperial', label: 'Imperial', title: 'Feet, miles per hour, acres' },
];

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-xs text-ink-muted">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function GlobalSettings() {
  const isDark = useThemeStore((s) => s.isDark);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const vibe = useThemeStore((s) => s.vibe);
  const setVibe = useThemeStore((s) => s.setVibe);
  const units = usePrefsStore((s) => s.units);
  const setUnits = usePrefsStore((s) => s.setUnits);
  const learn = usePrefsStore((s) => s.learn);
  const setLearn = usePrefsStore((s) => s.setLearn);

  return (
    <div className="space-y-6">
      <section className="vibe-card space-y-4 p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">Units</h2>
        <Row
          title="Distances and speeds"
          hint="How results are shown. Planner inputs stay in metres, as the mission file stores them."
        >
          <SegmentedTrack ariaLabel="Units" options={UNITS} value={units} onChange={setUnits} />
        </Row>
      </section>

      <section className="vibe-card space-y-4 p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">Learning</h2>
        <Row
          title="Learn mode"
          hint="Shows example files in each library and explanations beside the tools. The same switch is in the header."
        >
          <SegmentedTrack
            ariaLabel="Learn mode"
            options={[
              { id: 'on', label: 'On', title: 'Examples and explanations are shown' },
              { id: 'off', label: 'Off', title: 'Only your own files and the tools' },
            ]}
            value={learn ? 'on' : 'off'}
            onChange={(id: 'on' | 'off') => setLearn(id === 'on')}
          />
        </Row>
      </section>

      <section className="vibe-card space-y-4 p-5">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">Interface</h2>
        <Row title="Theme" hint="Light reads better in sunlight. Dark is easier indoors.">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-2 rounded-md border border-edge px-3 py-1.5 text-xs text-ink shadow-sm transition-colors hover:bg-surface-sunken"
          >
            {isDark ? <Moon size={13} /> : <Sun size={13} />}
            {isDark ? 'Dark' : 'Light'}
          </button>
        </Row>
        <Row title="Vibe" hint="Treatment: shadows, edges, outlines">
          <SegmentedTrack ariaLabel="Vibe" options={VIBES} value={vibe} onChange={setVibe} />
        </Row>
      </section>

      <section className="vibe-card space-y-3 p-5 text-sm text-ink-muted">
        <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">What this app does and does not do</h2>
        <p>
          Everything is stored in this browser on this computer: checklists, plans, aircraft profiles
          and copies of the logs you open. There are no accounts and no server. Map tiles are the one
          thing fetched from the internet.
        </p>
        <p>
          The app never connects to an aircraft. It has no serial, radio or network link to a flight
          controller. It reads log and mission files you give it and writes mission files you take to
          your ground station.
        </p>
        <p>
          One optional part is set up separately: the observer, for an assistant on your own
          computer. It is a separate program that hears a copy of what the aircraft tells
          QGroundControl. It listens and cannot send. The Assistant screen explains it.
        </p>
      </section>
    </div>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<string>('global');

  const domainTabs = APP_REGISTRY.filter((a) => a.navigation.showInSettings);
  const tabs = [
    { id: 'global', label: 'Global', icon: <Globe size={14} className="text-ink-muted" /> },
    ...domainTabs.map((app) => ({
      id: app.id,
      label: app.name,
      icon: <app.icon size={14} className={app.theme.colorClass} />,
    })),
  ];

  const index = Math.max(0, tabs.findIndex((t) => t.id === activeTab));
  const cycle = (dir: 1 | -1) => setActiveTab(tabs[(index + dir + tabs.length) % tabs.length].id);

  const ActiveBody = domainTabs.find((a) => a.id === activeTab)?.settingsBody;

  return (
    <main className="h-full w-full overflow-y-auto p-6 transition-colors duration-200 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center gap-3 text-2xl font-semibold text-ink">
            <Settings size={22} className="text-ink-muted" />
            Settings
          </h1>

          {/* the tab cycler */}
          <div className="flex items-center gap-3 rounded-lg border border-edge bg-surface-raised p-1 shadow-sm transition-colors duration-200">
            <button
              onClick={() => cycle(-1)}
              className="rounded p-1 text-ink-muted transition-colors hover:bg-surface-sunken"
              aria-label="Previous settings area"
            >
              <ChevronLeft size={18} />
            </button>
            <span className="flex min-w-32 select-none items-center justify-center gap-2 text-sm font-medium text-ink">
              {tabs[index].icon}
              {tabs[index].label}
            </span>
            <button
              onClick={() => cycle(1)}
              className="rounded p-1 text-ink-muted transition-colors hover:bg-surface-sunken"
              aria-label="Next settings area"
            >
              <ChevronRight size={18} />
            </button>
          </div>
        </div>

        {activeTab === 'global' ? (
          <GlobalSettings />
        ) : (
          <div className="vibe-card p-5">{ActiveBody ? <ActiveBody /> : null}</div>
        )}
      </div>
    </main>
  );
}
