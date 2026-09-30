// The Live domain's views: Overview (now), Messages (what the board said),
// Traffic (what is being sent). Each reads the store; none takes a prop.
// Status is always an icon and a word; colour alone never carries it.
'use client';
import { CircleCheck, CircleSlash, Lock, LockOpen, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { fmtNum } from '@/lib/units';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useLiveStore } from '@/stores/domains/liveStore';

const n = (v: number | null | undefined, digits: number, unit: string): string => (v === null || v === undefined ? 'n/a' : `${fmtNum(v, digits)}${unit}`);

function Tile({ label, value, sub, learn }: { label: string; value: ReactNode; sub?: ReactNode; learn?: string }) {
  const show = usePrefsStore((s) => s.learn);
  return (
    <div className="rounded-xl border border-edge bg-surface-raised p-3">
      <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{label}</div>
      <div className="mt-0.5 truncate text-xl font-semibold text-ink">{value}</div>
      {sub && <div className="truncate text-[11px] text-ink-muted">{sub}</div>}
      {show && learn && <p className="mt-1.5 border-t border-edge pt-1.5 text-[11px] leading-snug text-ink-muted">{learn}</p>}
    </div>
  );
}

/**
 * The horizon as the aircraft sees it. The sky and ground turn and slide; the
 * aircraft's mark stays still. Leaning right turns the horizon to the left.
 */
export function Horizon({ rollDeg, pitchDeg }: { rollDeg: number; pitchDeg: number }) {
  const perDegree = 2.4;
  const slide = Math.max(-60, Math.min(60, pitchDeg)) * perDegree;
  return (
    <svg viewBox="-100 -100 200 200" role="img" aria-label={`Horizon: roll ${fmtNum(rollDeg, 1)} degrees, pitch ${fmtNum(pitchDeg, 1)} degrees`} className="h-full w-full">
      <defs>
        <clipPath id="live-horizon-face">
          <circle r="96" />
        </clipPath>
      </defs>
      <g clipPath="url(#live-horizon-face)">
        <g transform={`rotate(${-rollDeg}) translate(0 ${slide})`}>
          <rect x="-300" y="-300" width="600" height="300" className="fill-sky-300 dark:fill-sky-700" />
          <rect x="-300" y="0" width="600" height="300" className="fill-amber-700 dark:fill-amber-900" />
          <line x1="-300" x2="300" y1="0" y2="0" stroke="white" strokeWidth="1.5" />
          {[-20, -10, 10, 20].map((d) => (
            <g key={d}>
              <line x1={-22} x2={22} y1={-d * perDegree} y2={-d * perDegree} stroke="white" strokeWidth="1" />
              <text x={28} y={-d * perDegree + 3} fontSize="8" fill="white">
                {Math.abs(d)}
              </text>
            </g>
          ))}
          {[-5, 5, -15, 15].map((d) => (
            <line key={d} x1={-10} x2={10} y1={-d * perDegree} y2={-d * perDegree} stroke="white" strokeWidth="0.75" />
          ))}
        </g>
      </g>
      <circle r="96" fill="none" className="stroke-edge" strokeWidth="2" />
      {/* the aircraft: it does not move */}
      <path d="M -52 0 H -18 L -9 9 M 52 0 H 18 L 9 9" fill="none" stroke="#facc15" strokeWidth="3.5" strokeLinecap="round" />
      <circle r="2.5" fill="#facc15" />
    </svg>
  );
}

export function LiveOverview() {
  const view = useLiveStore((s) => s.view);
  const source = useLiveStore((s) => s.source);
  const learn = usePrefsStore((s) => s.learn);
  if (!view?.vehicle) return null;
  const v = view.vehicle;
  const lost = source === 'aircraft' && !view.heard;
  const unhealthy = view.sensors.filter((s) => s.enabled && !s.healthy);

  return (
    <div className="space-y-4 p-4 @container">
      {lost && (
        <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/70 p-3 text-xs text-ink dark:border-amber-800 dark:bg-amber-950/30">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-status-warning" />
          <span>
            Nothing has been heard for {n(view.lastPacketAgeS, 0, ' s')}. What is shown is the last that was heard, not
            what the aircraft is doing now.
          </span>
        </div>
      )}

      <div className="grid gap-4 @3xl:grid-cols-[260px_minmax(0,1fr)]">
        <section className="rounded-xl border border-edge bg-surface-raised p-3">
          <div className="mx-auto aspect-square w-full max-w-[236px]">
            {view.attitude ? <Horizon rollDeg={view.attitude.rollDeg} pitchDeg={view.attitude.pitchDeg} /> : <div className="flex h-full items-center justify-center text-xs text-ink-muted">No attitude heard</div>}
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-1 text-center">
            {[
              ['Roll', view.attitude?.rollDeg],
              ['Pitch', view.attitude?.pitchDeg],
              ['Heading', view.attitude?.yawDeg],
            ].map(([k, val]) => (
              <div key={String(k)}>
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{k}</dt>
                <dd className="font-mono text-sm text-ink">{n(val as number | undefined, 1, '°')}</dd>
              </div>
            ))}
          </dl>
          {learn && (
            <p className="mt-2 border-t border-edge pt-2 text-[11px] leading-snug text-ink-muted">
              Roll is the lean to one side, pitch is nose up or down, heading is where the nose points, from north. The
              yellow mark is the aircraft; the line behind it is the horizon.
            </p>
          )}
        </section>

        <div className="grid content-start gap-3 @md:grid-cols-2 @4xl:grid-cols-3">
          <Tile
            label="Armed"
            value={
              <span className="flex items-center gap-1.5">
                {v.armed ? <LockOpen size={18} className="text-status-warning" /> : <Lock size={18} className="text-ink-muted" />}
                {v.armed ? 'Armed' : 'Disarmed'}
              </span>
            }
            sub={`${v.type} · ${v.autopilot} · ${v.state}`}
            learn="Armed means the motors will turn if the throttle is raised. Keep clear of the propellers."
          />
          <Tile label="Flight mode" value={v.mode} sub={`Heartbeat ${n(v.heartbeatAgeS, 1, ' s')} ago`} learn="The mode decides what the sticks do and what the aircraft does by itself. The heartbeat is the aircraft saying it is there, once a second." />
          <Tile
            label="Height"
            value={n(view.flight?.heightM, 1, ' m')}
            sub={`Climb ${n(view.flight?.climbMs, 1, ' m/s')} · ${n(view.flight?.altM, 0, ' m')} above sea level`}
            learn="Height above where it took off. Below it, how fast it is rising or sinking, and the height above sea level."
          />
          <Tile label="Speed over the ground" value={n(view.flight?.groundspeedMs, 1, ' m/s')} sub={`Throttle ${n(view.flight?.throttlePct, 0, ' %')}`} learn="How fast it moves across the ground. In a hover this is close to nothing." />
          <Tile
            label="Battery"
            value={n(view.battery?.volts, 2, ' V')}
            sub={`${n(view.battery?.percent, 0, ' %')} · ${n(view.battery?.amps, 1, ' A')}${view.battery && view.battery.cellsMv.length > 0 ? ` · ${view.battery.cellsMv.length} cells` : ''}`}
            learn="The voltage drops while the motors pull current and comes back when they stop. The percentage is the aircraft's own estimate."
          />
          <Tile label="GPS" value={view.gps ? `${view.gps.satellites} satellites` : 'n/a'} sub={view.gps ? `${view.gps.fix} · HDOP ${n(view.gps.hdop, 1, '')}` : undefined} learn="More satellites and a lower HDOP mean a better fix. Where the aircraft is, is not shown on this screen." />
        </div>
      </div>

      <section className="rounded-xl border border-edge bg-surface-raised p-3">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          {unhealthy.length > 0 ? <TriangleAlert size={14} className="text-status-warning" /> : <CircleCheck size={14} className="text-status-good" />}
          Sensors: {unhealthy.length > 0 ? `${unhealthy.length} not healthy` : view.sensors.length > 0 ? 'all that are on are healthy' : 'none heard'}
        </h2>
        <ul className="mt-2 grid gap-x-4 gap-y-1 text-xs @md:grid-cols-2 @4xl:grid-cols-3">
          {view.sensors.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5 text-ink">
              {!s.enabled ? <CircleSlash size={12} className="shrink-0 text-ink-muted" /> : s.healthy ? <CircleCheck size={12} className="shrink-0 text-status-good" /> : <TriangleAlert size={12} className="shrink-0 text-status-warning" />}
              <span className="truncate">{s.name}</span>
              <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-ink-muted">{!s.enabled ? 'Off' : s.healthy ? 'Healthy' : 'Not healthy'}</span>
            </li>
          ))}
        </ul>
      </section>

      {view.messages.length > 0 && (
        <section className="rounded-xl border border-edge bg-surface-raised p-3">
          <h2 className="text-xs font-semibold text-ink">The last thing the board said</h2>
          <p className="mt-1 text-sm text-ink">
            <span className="mr-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-muted">{view.messages[0].severity}</span>
            {view.messages[0].text}
          </p>
        </section>
      )}
    </div>
  );
}

export function LiveMessages() {
  const messages = useLiveStore((s) => s.view?.messages);
  const learn = usePrefsStore((s) => s.learn);
  if (!messages) return null;
  return (
    <div className="space-y-3 p-4">
      {learn && (
        <p className="rounded-lg border border-edge bg-control/50 p-3 text-xs text-ink-muted">
          These are the aircraft&apos;s own words, newest first: why it will not arm, what a sensor reported, what it is
          about to do. The word in capitals is how serious the aircraft says it is.
        </p>
      )}
      {messages.length === 0 ? (
        <p className="text-sm text-ink-muted">The board has said nothing yet.</p>
      ) : (
        <ul className="divide-y divide-edge rounded-xl border border-edge bg-surface-raised">
          {messages.map((m, i) => {
            const serious = /emergency|alert|critical|error/i.test(m.severity);
            const warn = /warning/i.test(m.severity);
            return (
              <li key={`${i}-${m.text}`} className="flex items-start gap-2 px-3 py-2 text-sm">
                {serious || warn ? <TriangleAlert size={14} className={`mt-0.5 shrink-0 ${serious ? 'text-status-critical' : 'text-status-warning'}`} /> : <CircleCheck size={14} className="mt-0.5 shrink-0 text-ink-muted" />}
                <span className="w-16 shrink-0 pt-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-muted">{m.severity}</span>
                <span className="min-w-0 flex-1 break-words text-ink">{m.text}</span>
                <span className="shrink-0 font-mono text-[11px] text-ink-muted">{n(m.ageS, 0, ' s')}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function LiveTraffic() {
  const view = useLiveStore((s) => s.view);
  const learn = usePrefsStore((s) => s.learn);
  if (!view) return null;
  return (
    <div className="space-y-3 p-4">
      {learn && (
        <p className="rounded-lg border border-edge bg-control/50 p-3 text-xs text-ink-muted">
          An aircraft talks in messages, each of one kind, each sent at its own rate. This is every kind heard so far.
          The names are MAVLink&apos;s own. ATTITUDE is how the aircraft is leaning; HEARTBEAT is it saying it is there.
        </p>
      )}
      <p className="text-xs text-ink-muted">
        {view.kinds} kinds of message · {fmtNum(view.bytes / 1024, 1)} KB heard · parameters held: {view.params.received}
        {view.params.expected !== null ? ` of ${view.params.expected}` : ''}
      </p>
      <div className="overflow-x-auto rounded-xl border border-edge bg-surface-raised">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase tracking-wider text-ink-muted">
            <tr className="border-b border-edge">
              <th className="px-3 py-2 font-semibold">Message</th>
              <th className="px-3 py-2 text-right font-semibold">Heard</th>
              <th className="px-3 py-2 text-right font-semibold">Each second</th>
              <th className="px-3 py-2 text-right font-semibold">Last</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {view.traffic.map((m) => (
              <tr key={m.type}>
                <td className="px-3 py-1.5 font-mono text-ink">{m.type}</td>
                <td className="px-3 py-1.5 text-right font-mono text-ink">{m.count}</td>
                <td className="px-3 py-1.5 text-right font-mono text-ink">{n(m.rateHz, 1, '')}</td>
                <td className="px-3 py-1.5 text-right font-mono text-ink-muted">{n(m.ageS, 1, ' s')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
