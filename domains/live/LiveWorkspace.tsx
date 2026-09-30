// LiveWorkspace — the center surface. Single-surface archetype:
//   HeaderWorkspace [ identity · view switch · listen / practice ]
//   → the chosen view. With nothing switched on, the surface says what each
//   source is and how to start it.
// What is shown was heard, not asked for: the app sends nothing to an aircraft.
'use client';
import { useEffect } from 'react';
import { Ear, GraduationCap, LayoutGrid, ListOrdered, MessageSquareText, RadioTower, Square, TriangleAlert, X } from 'lucide-react';
import { HeaderWorkspace } from '@/components/ui/HeaderWorkspace';
import { SegmentedTrack } from '@/components/ui/SegmentedTrack';
import { FORWARDING_STEPS } from '@/lib/observer/bridge';
import { useLiveStore, type LiveTab } from '@/stores/domains/liveStore';
import { LiveMessages, LiveOverview, LiveTraffic } from './LiveViews';

const TABS: { id: LiveTab; label: string; short: string; icon: typeof RadioTower }[] = [
  { id: 'overview', label: 'Overview', short: 'Now', icon: LayoutGrid },
  { id: 'messages', label: 'Messages', short: 'Said', icon: MessageSquareText },
  { id: 'traffic', label: 'Traffic', short: 'Sent', icon: ListOrdered },
];

const BUTTON =
  'flex items-center gap-1.5 whitespace-nowrap rounded-md border border-edge bg-control px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-50';

export function LiveWorkspace() {
  const source = useLiveStore((s) => s.source);
  const tab = useLiveStore((s) => s.tab);
  const desktop = useLiveStore((s) => s.desktop);
  const bound = useLiveStore((s) => s.bound);
  const port = useLiveStore((s) => s.port);
  const notice = useLiveStore((s) => s.notice);
  const heard = useLiveStore((s) => s.view?.vehicle != null);
  const look = useLiveStore((s) => s.look);
  const setTab = useLiveStore((s) => s.setTab);
  const listen = useLiveStore((s) => s.listen);
  const startPractice = useLiveStore((s) => s.startPractice);
  const stop = useLiveStore((s) => s.stop);
  const dismissNotice = useLiveStore((s) => s.dismissNotice);

  // whether this is the desktop app is only known once the page is in the window
  useEffect(() => look(), [look]);

  const subtitle =
    source === 'practice'
      ? 'Practice: a made-up flight, played round and round. No aircraft is involved.'
      : source === 'aircraft'
        ? bound
          ? `Listening on this computer, port ${port}. It hears; it cannot send.`
          : `Port ${port} is held by another program`
        : 'What a connected aircraft is reporting now';

  return (
    <div className="flex h-full flex-col">
      <HeaderWorkspace
        icon={RadioTower}
        iconClass="text-sky-600 dark:text-sky-400"
        title="Live"
        subtitle={subtitle}
        center={source !== 'off' ? <SegmentedTrack ariaLabel="Live view" options={TABS} value={tab} onChange={setTab} /> : undefined}
        actions={
          source === 'off' ? (
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => void startPractice()} className={BUTTON}>
                <GraduationCap size={13} /> Practice flight
              </button>
              <button
                onClick={() => void listen()}
                disabled={desktop === false}
                title={desktop === false ? 'Needs the desktop app: a page in a browser cannot open the port' : 'Listen on this computer for what QGroundControl forwards'}
                className={BUTTON}
              >
                <Ear size={13} /> Listen for the aircraft
              </button>
            </div>
          ) : (
            <button onClick={() => void stop()} className={BUTTON}>
              <Square size={13} /> Stop
            </button>
          )
        }
      />

      {notice && (
        <div role="status" className="flex shrink-0 items-start gap-2 border-b border-edge bg-amber-50/70 px-4 py-2 text-xs text-ink dark:bg-amber-950/30">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-status-warning" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button onClick={dismissNotice} className="rounded p-0.5 text-ink-muted hover:text-ink" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {source === 'off' && (
          <div className="mx-auto grid max-w-4xl gap-4 p-6 @container md:grid-cols-2">
            <section className="rounded-2xl border border-edge bg-surface-raised p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <GraduationCap size={16} className="text-sky-600 dark:text-sky-400" /> Practice flight
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                One minute of made-up telemetry: the aircraft arms, climbs to five metres, hovers while its battery
                sags, lands and disarms. It is read by the same reader that reads an aircraft, so every screen here
                works as it will in the field.
              </p>
              <button onClick={() => void startPractice()} className={`${BUTTON} mt-4`}>
                <GraduationCap size={13} /> Start the practice flight
              </button>
            </section>

            <section className="rounded-2xl border border-edge bg-surface-raised p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Ear size={16} className="text-sky-600 dark:text-sky-400" /> Listen for the aircraft
              </h2>
              <p className="mt-2 text-sm text-ink-muted">
                QGroundControl can send a copy of everything the aircraft tells it to this computer. The app listens
                for that copy. QGroundControl stays the only program that talks to the aircraft.
              </p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-muted">
                {FORWARDING_STEPS.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <button onClick={() => void listen()} disabled={desktop === false} className={`${BUTTON} mt-4`}>
                <Ear size={13} /> Listen for the aircraft
              </button>
              {desktop === false && (
                <p className="mt-2 text-xs text-ink-muted">
                  This needs the desktop app. A page in a browser is not allowed to open the port that QGroundControl
                  forwards to.
                </p>
              )}
            </section>
          </div>
        )}

        {source === 'aircraft' && !bound && (
          <div className="mx-auto max-w-2xl p-6">
            <div className="rounded-xl border border-amber-300 bg-amber-50/70 p-5 text-sm dark:border-amber-800 dark:bg-amber-950/30">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <TriangleAlert size={16} className="text-status-warning" /> Port {port} is held by another program
              </p>
              <p className="mt-1 text-ink-muted">
                One port has one listener. Another observer is probably running: one started by an assistant&apos;s
                session, or a second copy of this app. Close it, and this screen takes the port by itself within a
                few seconds.
              </p>
            </div>
          </div>
        )}

        {source === 'aircraft' && bound && !heard && (
          <div className="mx-auto max-w-2xl p-6">
            <div className="rounded-xl border border-edge bg-surface-raised p-5 text-sm">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <Ear size={16} className="text-sky-600 dark:text-sky-400" /> Listening. Nothing heard yet.
              </p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-ink-muted">
                {FORWARDING_STEPS.slice(0, 4).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {source !== 'off' && heard && tab === 'overview' && <LiveOverview />}
        {source !== 'off' && heard && tab === 'messages' && <LiveMessages />}
        {source !== 'off' && heard && tab === 'traffic' && <LiveTraffic />}
      </div>
    </div>
  );
}
