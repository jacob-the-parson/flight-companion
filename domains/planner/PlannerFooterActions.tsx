// PlannerFooterActions — THE FOOTER SHAPE (all domains):
//   [ domain status ] [ domain action ] [ CENTER reserved ] [ Clear (red) ] [ Save (green) ]
// Status = is this plan flyable on one battery. Action = write the plan file.
'use client';
import { CircleCheck, FileDown, OctagonAlert, Save, Trash2, TriangleAlert } from 'lucide-react';
import { KeycapAction } from '@/components/ui/KeycapAction';
import { toQgcPlan } from '@/lib/planner/export';
import { downloadFile, fmtDuration } from '@/lib/units';
import { usePlannerStore, usePlanResult } from '@/stores/domains/plannerStore';
import { planFileName, useMissionInput } from './PlannerDrawerPages';

export function PlannerStatusAction() {
  const result = usePlanResult();
  if (!result.ok) {
    return (
      <div className="flex h-full w-full items-center justify-center gap-1.5 opacity-60" title={result.reason}>
        <span className="font-medium uppercase tracking-wide">No plan</span>
      </div>
    );
  }
  const critical = result.checks.some((c) => c.level === 'critical');
  const warning = result.checks.some((c) => c.level === 'warning');
  const Icon = critical ? OctagonAlert : warning ? TriangleAlert : CircleCheck;
  const tone = critical ? 'text-status-critical' : warning ? 'text-status-warning' : 'text-status-good';
  return (
    <div
      className="flex h-full w-full items-center justify-center gap-1.5 text-ink"
      title={
        critical
          ? 'A check says stop. Open Results in the tools drawer.'
          : warning
            ? 'A check needs a look. Open Results in the tools drawer.'
            : 'Every check passed'
      }
    >
      <Icon size={13} className={tone} />
      <span className="font-medium uppercase tracking-wide">{fmtDuration(result.flightTime)}</span>
    </div>
  );
}

export function PlannerExportAction() {
  const name = usePlannerStore((s) => s.name);
  const mission = useMissionInput();
  return (
    <button
      onClick={() => mission && downloadFile(planFileName(name, 'plan'), toQgcPlan(mission), 'application/json')}
      disabled={!mission}
      className={`group flex h-full w-full items-center justify-center gap-1.5 outline-none transition-colors ${
        mission
          ? 'cursor-pointer hover:bg-control hover:text-sky-600 dark:hover:text-sky-400'
          : 'cursor-not-allowed opacity-40'
      }`}
      title={mission ? 'Download a QGroundControl plan file' : 'Draw a plan and set the takeoff point first'}
    >
      <FileDown size={13} className={mission ? 'transition-transform group-hover:-translate-y-0.5' : ''} />
      <span className="font-medium uppercase tracking-wide">.plan</span>
    </button>
  );
}

export function PlannerClearAction() {
  const clearPlan = usePlannerStore((s) => s.clearPlan);
  const empty = usePlannerStore(
    (s) => s.shapes.area.length + s.shapes.line.length + s.shapes.centre.length === 0 && s.home === null,
  );
  return (
    <KeycapAction
      icon={Trash2}
      label="Clear"
      tone="red"
      disabled={empty}
      title="Remove the drawn points and the takeoff point. Saved plans are kept."
      onClick={() => {
        if (window.confirm('Remove the drawn points and the takeoff point? Saved plans are kept.')) clearPlan();
      }}
    />
  );
}

export function PlannerSaveAction() {
  const savePlan = usePlannerStore((s) => s.savePlan);
  const empty = usePlannerStore((s) => s.shapes.area.length + s.shapes.line.length + s.shapes.centre.length === 0);
  return (
    <KeycapAction
      icon={Save}
      label="Save"
      tone="green"
      disabled={empty}
      title="Save this plan to the list in the left drawer"
      onClick={savePlan}
    />
  );
}
