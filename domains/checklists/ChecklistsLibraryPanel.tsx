// ChecklistsLibraryPanel — the per-domain LEFT-BOTTOM panel: the template
// library. Non-pageable, mounts between favorites and the AircraftDock, brings
// its own sticky mini-header (the inventory convention).
'use client';
import { ClipboardList, Copy, Lock, Plus, Trash2 } from 'lucide-react';
import { useChecklistsStore } from '@/stores/domains/checklistsStore';

export function ChecklistsLibraryPanel() {
  const templates = useChecklistsStore((s) => s.templates);
  const activeTemplateId = useChecklistsStore((s) => s.activeTemplateId);
  const setActiveTemplate = useChecklistsStore((s) => s.setActiveTemplate);
  const addTemplate = useChecklistsStore((s) => s.addTemplate);
  const duplicateTemplate = useChecklistsStore((s) => s.duplicateTemplate);
  const deleteTemplate = useChecklistsStore((s) => s.deleteTemplate);

  const action =
    'rounded p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink';

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-edge bg-surface-raised/95 px-3 py-2">
        <ClipboardList size={13} className="text-emerald-600 dark:text-emerald-400" />
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Checklists</h3>
        <span className="ml-auto font-mono text-[10px] text-ink-muted">{templates.length}</span>
      </div>
      <div className="space-y-1 p-2">
        {templates.map((t) => {
          const active = t.id === activeTemplateId;
          const items = t.sections.reduce((n, s) => n + s.items.length, 0);
          return (
            <div key={t.id} className="group relative">
              <button
                onClick={() => setActiveTemplate(t.id)}
                className={`flex w-full flex-col rounded-md border px-2.5 py-1.5 pr-14 text-left transition-colors ${
                  active
                    ? 'border-emerald-400 bg-emerald-50/70 dark:border-emerald-700 dark:bg-emerald-950/30'
                    : 'border-edge bg-surface-raised/60 hover:border-edge-strong/40'
                }`}
              >
                <span className="flex items-center gap-1.5 truncate text-xs font-medium text-ink">
                  {t.builtIn && <Lock size={10} className="shrink-0 text-ink-muted" />}
                  <span className="truncate">{t.name}</span>
                </span>
                <span className="truncate text-[10px] text-ink-muted">
                  {items} item{items === 1 ? '' : 's'}
                  {t.aircraft ? ` · ${t.aircraft}` : ''}
                </span>
              </button>
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                <button onClick={() => duplicateTemplate(t.id)} className={action} title="Duplicate">
                  <Copy size={13} />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`Delete the checklist "${t.name}"? Saved runs are kept.`)) {
                      deleteTemplate(t.id);
                    }
                  }}
                  disabled={templates.length <= 1}
                  className={`${action} hover:bg-red-50 hover:text-red-500 disabled:opacity-30 dark:hover:bg-red-950/30`}
                  title={templates.length <= 1 ? 'Keep at least one checklist' : 'Delete'}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          );
        })}
        <button
          onClick={addTemplate}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-edge p-2 text-xs text-ink-muted transition-colors hover:border-edge-strong/50 hover:text-ink"
        >
          <Plus size={13} /> New checklist
        </button>
      </div>
    </div>
  );
}
