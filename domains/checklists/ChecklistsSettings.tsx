// ChecklistsSettings — settings sub-area body: what is stored, and a way to
// take it all away with you.
'use client';
import { ClipboardCheck, Download } from 'lucide-react';
import { downloadFile } from '@/lib/units';
import { useChecklistsStore } from '@/stores/domains/checklistsStore';

export function ChecklistsSettings() {
  const templates = useChecklistsStore((s) => s.templates);
  const history = useChecklistsStore((s) => s.history);

  return (
    <div className="flex items-start gap-4">
      <div className="rounded-full bg-emerald-100 p-3 dark:bg-emerald-900/40">
        <ClipboardCheck size={24} className="text-emerald-600 dark:text-emerald-400" />
      </div>
      <div className="min-w-0 flex-1 space-y-4">
        <div>
          <h3 className="mb-1 text-lg font-medium text-ink">Checklists</h3>
          <p className="text-sm text-ink-muted">
            {templates.length} checklist{templates.length === 1 ? '' : 's'} and {history.length} saved run
            {history.length === 1 ? '' : 's'} are stored in this browser. Clearing the browser&apos;s site
            data removes them, so export a backup before doing that.
          </p>
        </div>
        <button
          onClick={() =>
            downloadFile(
              `${new Date().toISOString().slice(0, 10)}-checklists-backup.json`,
              JSON.stringify({ templates, history }, null, 2),
              'application/json',
            )
          }
          className="vibe-btn bg-surface-raised text-ink hover:bg-surface-sunken"
        >
          <Download size={14} className="text-green-600 dark:text-green-500" /> Export everything
        </button>
      </div>
    </div>
  );
}
