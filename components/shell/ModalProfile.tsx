// ModalProfile — the pilot's name and role. Kept in this browser only; written
// onto checklist runs so a saved run says who flew.
'use client';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { ModalBase } from '@/components/ui/ModalBase';
import { DrawerField } from '@/components/ui/DrawerSection';

interface ModalProfileProps {
  isOpen: boolean;
  onClose: () => void;
}

export const INPUT_CLASS =
  'w-full rounded-md border border-edge bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-secondary focus:ring-1 focus:ring-secondary';

export function ModalProfile({ isOpen, onClose }: ModalProfileProps) {
  const pilotName = usePrefsStore((s) => s.pilotName);
  const pilotRole = usePrefsStore((s) => s.pilotRole);
  const setPilotName = usePrefsStore((s) => s.setPilotName);
  const setPilotRole = usePrefsStore((s) => s.setPilotRole);

  return (
    <ModalBase isOpen={isOpen} onClose={onClose} title="Pilot profile">
      <div className="space-y-4">
        <DrawerField label="Name">
          <input value={pilotName} onChange={(e) => setPilotName(e.target.value)} className={INPUT_CLASS} />
        </DrawerField>
        <DrawerField label="Role">
          <input
            value={pilotRole}
            onChange={(e) => setPilotRole(e.target.value)}
            placeholder="Instructor, student, spotter"
            className={INPUT_CLASS}
          />
        </DrawerField>
        <p className="text-xs text-ink-muted">
          Stored in this browser only. There are no accounts and nothing is sent anywhere.
        </p>
        <button
          onClick={onClose}
          className="w-full rounded-md bg-secondary py-2 text-sm font-medium text-white transition-colors hover:bg-secondary-shadow"
        >
          Done
        </button>
      </div>
    </ModalBase>
  );
}
