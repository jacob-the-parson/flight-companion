// PlannerPlansPanel — the per-domain LEFT-BOTTOM panel: saved plans.
// Non-pageable, with its own sticky mini-header (the inventory convention).
'use client';
import { FolderOpen, Trash2 } from 'lucide-react';
import { SURVEY_TYPES } from '@/lib/planner/survey';
import { usePlannerStore } from '@/stores/domains/plannerStore';

export function PlannerPlansPanel() {
  const saved = usePlannerStore((s) => s.saved);
  const loadedId = usePlannerStore((s) => s.loadedId);
  const loadPlan = usePlannerStore((s) => s.loadPlan);
  const deletePlan = usePlannerStore((s) => s.deletePlan);

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-edge bg-surface-raised/95 px-3 py-2">
        <FolderOpen size={13} className="text-sky-600 dark:text-sky-400" />
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Saved plans</h3>
        <span className="ml-auto font-mono text-[10px] text-ink-muted">{saved.length}</span>
      </div>
      <div className="space-y-1 p-2">
        {saved.length === 0 && (
          <p className="px-2 py-2 text-xs italic text-ink-muted opacity-60">
            No saved plans yet. Draw one and press Save in the footer.
          </p>
        )}
        {saved.map((p) => {
          const active = p.id === loadedId;
          const type = SURVEY_TYPES.find((t) => t.id === p.surveyType);
          return (
            <div key={p.id} className="group relative">
              <button
                onClick={() => loadPlan(p.id)}
                className={`flex w-full flex-col rounded-md border px-2.5 py-1.5 pr-8 text-left transition-colors ${
                  active
                    ? 'border-sky-400 bg-sky-50/70 dark:border-sky-700 dark:bg-sky-950/30'
                    : 'border-edge bg-surface-raised/60 hover:border-edge-strong/40'
                }`}
              >
                <span className="truncate text-xs font-medium text-ink">{p.name}</span>
                <span className="truncate text-[10px] text-ink-muted">
                  {type?.label ?? p.surveyType} · {p.params.altitude} m ·{' '}
                  {new Date(p.savedAt).toLocaleDateString()}
                </span>
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Delete the saved plan "${p.name}"?`)) deletePlan(p.id);
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                title="Delete"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
