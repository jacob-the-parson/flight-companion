// ChecklistsFooterActions — THE FOOTER SHAPE (all domains):
//   [ domain status ] [ domain action ] [ CENTER reserved ] [ Reset (red) ] [ Save (green) ]
// Status = progress of the whole run. Tick = mark the next open item OK, so a
// gloved thumb never has to hunt for the row.
'use client';
import { CheckCircle2, ListChecks, Save, Trash2, TriangleAlert } from 'lucide-react';
import { KeycapAction } from '@/components/ui/KeycapAction';
import { phaseProgress } from '@/lib/checklists/types';
import { useChecklistsStore, useShownRun } from '@/stores/domains/checklistsStore';

export function ChecklistsStatusAction() {
  const { run, sections } = useShownRun();
  const p = phaseProgress(sections, run.results);
  const noGo = p.criticalFailed > 0;

  return (
    <div
      className="flex h-full w-full items-center justify-center gap-1.5 text-ink"
      title={noGo ? 'A go/no-go item has failed' : `${p.done} of ${p.total} items marked`}
    >
      {noGo ? (
        <TriangleAlert size={13} className="text-status-critical" />
      ) : (
        <CheckCircle2 size={13} className="text-emerald-600 dark:text-emerald-400" />
      )}
      <span className="font-medium uppercase tracking-wide">
        {noGo ? 'No-go' : `${p.done}/${p.total}`}
      </span>
    </div>
  );
}

export function ChecklistsTickAction() {
  const { run, sections, readOnly } = useShownRun();
  const mode = useChecklistsStore((s) => s.mode);
  const tickNext = useChecklistsStore((s) => s.tickNext);
  const p = phaseProgress(sections, run.results);
  const enabled = !readOnly && mode === 'run' && p.done < p.total;

  return (
    <button
      onClick={tickNext}
      disabled={!enabled}
      className={`group flex h-full w-full items-center justify-center gap-1.5 outline-none transition-colors ${
        enabled
          ? 'cursor-pointer hover:bg-control hover:text-emerald-600 dark:hover:text-emerald-400'
          : 'cursor-not-allowed opacity-40'
      }`}
      title={enabled ? 'Mark the next open item OK' : 'Nothing to tick'}
    >
      <ListChecks size={13} className={enabled ? 'transition-transform group-hover:-translate-y-0.5' : ''} />
      <span className="font-medium uppercase tracking-wide">Tick</span>
    </button>
  );
}

export function ChecklistsResetAction() {
  const resetRun = useChecklistsStore((s) => s.resetRun);
  const marked = useChecklistsStore((s) => Object.keys(s.run.results).length);
  const viewing = useChecklistsStore((s) => s.viewingRunId !== null);

  return (
    <KeycapAction
      icon={Trash2}
      label="Reset"
      tone="red"
      disabled={viewing || marked === 0}
      title="Clear every mark and start the run again"
      onClick={() => {
        if (window.confirm(`Clear all ${marked} marks and start this run again?`)) resetRun();
      }}
    />
  );
}

export function ChecklistsSaveAction() {
  const saveRun = useChecklistsStore((s) => s.saveRun);
  const marked = useChecklistsStore((s) => Object.keys(s.run.results).length);
  const viewing = useChecklistsStore((s) => s.viewingRunId !== null);

  return (
    <KeycapAction
      icon={Save}
      label="Save"
      tone="green"
      disabled={viewing || marked === 0}
      title="Save this run to the history and start a fresh one"
      onClick={saveRun}
    />
  );
}
