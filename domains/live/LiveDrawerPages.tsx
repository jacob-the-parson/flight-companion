// The Live domain's drawer pages: Link (where the data comes from), Aircraft
// (what it says it is), Rules (what this screen can and cannot do).
'use client';
import { FORWARDING_STEPS } from '@/lib/observer/bridge';
import { fmtNum } from '@/lib/units';
import { useLiveStore } from '@/stores/domains/liveStore';

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="contents">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="truncate font-mono text-ink">{v}</dd>
    </div>
  );
}

const SOURCE_WORDS = { off: 'Nothing is switched on', practice: 'The practice flight: made-up data', aircraft: 'The desktop app, listening on this computer' } as const;

export function LiveLinkPage() {
  const source = useLiveStore((s) => s.source);
  const view = useLiveStore((s) => s.view);
  const bound = useLiveStore((s) => s.bound);
  const port = useLiveStore((s) => s.port);
  const desktop = useLiveStore((s) => s.desktop);
  return (
    <div className="space-y-4 p-4 text-xs">
      <section>
        <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted">Where this comes from</h3>
        <p className="text-sm text-ink">{SOURCE_WORDS[source]}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {source === 'aircraft' && <Row k="Port" v={`127.0.0.1:${port}, ${bound ? 'held' : 'held by another program'}`} />}
          {view && <Row k="Data arriving" v={view.heard ? 'yes' : 'no'} />}
          {view && <Row k="Last packet" v={view.lastPacketAgeS === null ? 'none' : `${fmtNum(view.lastPacketAgeS, 1)} s ago`} />}
          {view && <Row k="Heard" v={`${fmtNum(view.bytes / 1024, 1)} KB, ${view.kinds} kinds`} />}
        </dl>
        {view && view.errors.length > 0 && <p className="mt-2 rounded-md border border-amber-300 bg-amber-50/70 p-2 text-ink dark:border-amber-800 dark:bg-amber-950/30">{view.errors[view.errors.length - 1]}</p>}
      </section>

      <section>
        <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted">To hear an aircraft</h3>
        <ol className="list-decimal space-y-1 pl-4 text-ink-muted">
          {FORWARDING_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        {desktop === false && <p className="mt-2 text-ink-muted">This is a page in a browser, which cannot open the port. The desktop app can.</p>}
      </section>

      <section>
        <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted">Parameters</h3>
        <p className="text-ink-muted">
          Parameters are heard only while QGroundControl downloads them. To hear them all, press Refresh in
          QGroundControl&apos;s Parameters view. If they do not arrive over a telemetry radio, connect the USB cable
          and press Refresh again.
        </p>
      </section>
    </div>
  );
}

export function LiveAircraftPage() {
  const view = useLiveStore((s) => s.view);
  if (!view?.vehicle) return <p className="p-4 text-xs text-ink-muted">No aircraft has been heard.</p>;
  const v = view.vehicle;
  return (
    <div className="space-y-4 p-4 text-xs">
      <section>
        <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted">What it says it is</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <Row k="Type" v={v.type} />
          <Row k="Autopilot" v={v.autopilot} />
          <Row k="Firmware" v={view.firmware ?? 'not heard'} />
          <Row k="State" v={v.state} />
          <Row k="Mode" v={v.mode} />
          <Row k="Parameters held" v={`${view.params.received}${view.params.expected !== null ? ` of ${view.params.expected}` : ''}`} />
        </dl>
      </section>
      {view.battery && view.battery.cellsMv.length > 0 && (
        <section>
          <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-muted">Cells</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            {view.battery.cellsMv.map((mv, i) => (
              <Row key={i} k={`Cell ${i + 1}`} v={`${fmtNum(mv / 1000, 3)} V`} />
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}

export function LiveRulesPage() {
  return (
    <div className="space-y-3 p-4 text-xs text-ink-muted">
      <h3 className="text-[10px] font-bold uppercase tracking-widest">What this screen can and cannot do</h3>
      <ul className="list-disc space-y-1.5 pl-4">
        <li>
          <span className="font-semibold text-ink">It listens. It cannot send.</span> The part that hears has its ways of
          sending replaced with one that raises an error, and the reader has no function that makes a message.
        </li>
        <li>
          <span className="font-semibold text-ink">QGroundControl stays in charge.</span> Every change to the aircraft is
          made there, by a person.
        </li>
        <li>
          <span className="font-semibold text-ink">This computer only.</span> It listens on 127.0.0.1, so nothing else on
          the network can feed it made-up data.
        </li>
        <li>
          <span className="font-semibold text-ink">No position.</span> Where the aircraft is, is left off this screen and
          out of what an assistant is told.
        </li>
        <li>
          <span className="font-semibold text-ink">It is not a flight instrument.</span> It is a moment behind the
          aircraft and shows the last thing heard. Fly by looking at the aircraft and the ground station.
        </li>
      </ul>
    </div>
  );
}
