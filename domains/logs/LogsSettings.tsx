// LogsSettings — settings sub-area body: what is read, where it is kept.
'use client';
import { Activity } from 'lucide-react';
import { useLogsStore } from '@/stores/domains/logsStore';

export function LogsSettings() {
  const count = useLogsStore((s) => s.logs.length);

  return (
    <div className="flex items-start gap-4">
      <div className="rounded-full bg-violet-100 p-3 dark:bg-violet-900/40">
        <Activity size={24} className="text-violet-600 dark:text-violet-400" />
      </div>
      <div className="min-w-0 flex-1 space-y-3 text-sm text-ink-muted">
        <h3 className="text-lg font-medium text-ink">Flight logs</h3>
        <p>
          {count} log{count === 1 ? '' : 's'} open. A copy of each is kept in this browser so it is
          still here next time. Closing a log removes the copy. The file on your disk is never
          changed.
        </p>
        <p>
          This version reads PX4 <span className="font-mono">.ulg</span> logs. ArduPilot{' '}
          <span className="font-mono">.bin</span> and MAVLink <span className="font-mono">.tlog</span>{' '}
          files are refused with a message rather than guessed at.
        </p>
        <p>
          Logs are read on this computer and are not uploaded anywhere. The app cannot fetch a log
          from the aircraft: copy it off the SD card, or download it with the ground station, and
          open the file here.
        </p>
      </div>
    </div>
  );
}
