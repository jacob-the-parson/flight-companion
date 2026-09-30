// LiveSettings — settings sub-area body: what is heard, what is kept.
'use client';
import { RadioTower } from 'lucide-react';
import { useLiveStore } from '@/stores/domains/liveStore';

export function LiveSettings() {
  const desktop = useLiveStore((s) => s.desktop);
  const port = useLiveStore((s) => s.port);

  return (
    <div className="flex items-start gap-4">
      <div className="rounded-full bg-sky-100 p-3 dark:bg-sky-900/40">
        <RadioTower size={24} className="text-sky-600 dark:text-sky-400" />
      </div>
      <div className="min-w-0 flex-1 space-y-3 text-sm text-ink-muted">
        <h3 className="text-lg font-medium text-ink">Live</h3>
        <p>
          The Live screen hears a copy of what the aircraft tells QGroundControl, when QGroundControl is told to
          forward it. It listens on this computer only, port {port}, and only while listening is switched on. It is off
          each time the app starts.
        </p>
        <p>
          It cannot send. There is nothing in this app that makes a MAVLink message, and the part that listens refuses
          to send.
        </p>
        <p>
          Nothing that is heard is kept. Closing the screen or pressing Stop forgets it. The Report button writes a
          text file of what is heard at that moment, without the aircraft&apos;s position.
        </p>
        <p>
          {desktop === false
            ? 'This is a page in a browser, so only the practice flight is available here. Listening for an aircraft needs the desktop app.'
            : 'One port has one listener: if an assistant’s own observer is running on this computer, close it before listening here, or use that one.'}
        </p>
      </div>
    </div>
  );
}
