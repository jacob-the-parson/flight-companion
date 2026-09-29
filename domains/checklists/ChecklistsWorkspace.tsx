// ChecklistsWorkspace — the center surface. Single-surface archetype:
//   HeaderWorkspace [ identity · phase switch · run/edit + print ]
//   → go/no-go banner → the active phase's sections.
// RUN mode is built for a tablet in a field: the whole row is the tick target.
// EDIT mode turns the same rows into inputs.
'use client';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  ClipboardCheck,
  Eye,
  Minus,
  Pencil,
  Play,
  Plus,
  Printer,
  ShieldAlert,
  StickyNote,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { HeaderWorkspace } from '@/components/ui/HeaderWorkspace';
import { SegmentedTrack } from '@/components/ui/SegmentedTrack';
import {
  PHASES,
  phaseProgress,
  type ChecklistItem,
  type ChecklistSection,
  type ItemResult,
  type PhaseId,
} from '@/lib/checklists/types';
import { useActiveTemplate, useChecklistsStore, useShownRun } from '@/stores/domains/checklistsStore';

const FIELD =
  'w-full rounded-md border border-edge bg-surface-raised px-2.5 py-1.5 text-sm text-ink outline-none transition-colors focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500';

function timeOf(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ---------------------------------------------------------------- run rows

function RunItem({
  item,
  result,
  readOnly,
}: {
  item: ChecklistItem;
  result: ItemResult | undefined;
  readOnly: boolean;
}) {
  const setResult = useChecklistsStore((s) => s.setResult);
  const setNote = useChecklistsStore((s) => s.setNote);
  const [noteOpen, setNoteOpen] = useState(false);
  const state = result?.state;

  const tone =
    state === 'ok'
      ? 'border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30'
      : state === 'fail'
        ? 'border-red-300 bg-red-50/70 dark:border-red-900 dark:bg-red-950/30'
        : state === 'na'
          ? 'border-edge bg-control/50'
          : 'border-edge bg-surface-raised';

  const small = (active: boolean, activeClass: string) =>
    `flex h-9 w-9 shrink-0 items-center justify-center rounded-md border transition-colors print:hidden ${
      active ? activeClass : 'border-edge bg-surface-raised text-ink-muted hover:text-ink'
    } ${readOnly ? 'cursor-default' : ''}`;

  return (
    <li className={`print-break-avoid rounded-lg border transition-colors ${tone}`}>
      <div className="flex items-stretch gap-2 p-2">
        {/* the big target: tick / untick */}
        <button
          onClick={() => setResult(item.id, 'ok')}
          disabled={readOnly}
          aria-pressed={state === 'ok'}
          aria-label={`${state === 'ok' ? 'Untick' : 'Tick'}: ${item.text}`}
          className={`flex min-w-0 flex-1 items-start gap-3 rounded-md p-1.5 text-left ${
            readOnly ? 'cursor-default' : 'cursor-pointer'
          }`}
        >
          <span
            className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 ${
              state === 'ok'
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : state === 'fail'
                  ? 'border-red-600 bg-red-600 text-white'
                  : state === 'na'
                    ? 'border-ink-muted/50 bg-control text-ink-muted'
                    : 'border-ink-muted/50'
            }`}
          >
            {state === 'ok' && <Check size={15} strokeWidth={3} />}
            {state === 'fail' && <X size={15} strokeWidth={3} />}
            {state === 'na' && <Minus size={15} strokeWidth={3} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block text-sm leading-snug text-ink ${state === 'na' ? 'opacity-60' : ''}`}>
              {item.text}
              {item.critical && (
                <span
                  className="ml-2 inline-flex items-center gap-1 rounded-full border border-edge-strong/25 px-1.5 py-px align-middle text-[9px] font-bold uppercase tracking-wider text-ink-muted"
                  title="A failed go/no-go item stops the flight"
                >
                  <ShieldAlert size={10} /> go/no-go
                </span>
              )}
            </span>
            {item.expect && (
              <span className="mt-0.5 block text-xs leading-snug text-ink-muted">Expect: {item.expect}</span>
            )}
            {result && (
              <span className="mt-1 block font-mono text-[10px] text-ink-muted">
                {result.state === 'ok' ? 'OK' : result.state === 'fail' ? 'FAILED' : 'N/A'} at{' '}
                {timeOf(result.at)}
                {result.note ? ` · ${result.note}` : ''}
              </span>
            )}
          </span>
        </button>

        <div className="flex shrink-0 items-start gap-1">
          <button
            onClick={() => setResult(item.id, 'fail')}
            disabled={readOnly}
            aria-pressed={state === 'fail'}
            title="Failed"
            className={small(state === 'fail', 'border-red-600 bg-red-600 text-white')}
          >
            <X size={16} />
          </button>
          <button
            onClick={() => setResult(item.id, 'na')}
            disabled={readOnly}
            aria-pressed={state === 'na'}
            title="Does not apply to this flight"
            className={small(state === 'na', 'border-ink-muted bg-control text-ink')}
          >
            <Minus size={16} />
          </button>
          <button
            onClick={() => setNoteOpen((o) => !o)}
            disabled={!result || readOnly}
            title={result ? 'Add a note' : 'Mark the item first, then add a note'}
            className={`${small(!!result?.note, 'border-secondary bg-secondary-high/30 text-ink')} ${
              !result ? 'opacity-40' : ''
            }`}
          >
            <StickyNote size={15} />
          </button>
        </div>
      </div>
      {noteOpen && result && !readOnly && (
        <div className="border-t border-edge p-2 print:hidden">
          <input
            autoFocus
            value={result.note ?? ''}
            onChange={(e) => setNote(item.id, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && setNoteOpen(false)}
            placeholder="What was seen, what was measured"
            className={FIELD}
          />
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------- edit rows

function EditItem({
  section,
  item,
  index,
}: {
  section: ChecklistSection;
  item: ChecklistItem;
  index: number;
}) {
  const updateItem = useChecklistsStore((s) => s.updateItem);
  const removeItem = useChecklistsStore((s) => s.removeItem);
  const moveItem = useChecklistsStore((s) => s.moveItem);
  const btn =
    'flex h-8 w-8 items-center justify-center rounded-md border border-edge bg-surface-raised text-ink-muted transition-colors hover:text-ink disabled:opacity-30';

  return (
    <li className="rounded-lg border border-edge bg-surface-raised p-2">
      <div className="flex items-start gap-2">
        <span className="mt-2 w-5 shrink-0 text-right font-mono text-[10px] text-ink-muted">{index + 1}</span>
        <div className="min-w-0 flex-1 space-y-1.5">
          <input
            value={item.text}
            onChange={(e) => updateItem(section.id, item.id, { text: e.target.value })}
            placeholder="What to check"
            aria-label="Item text"
            className={FIELD}
          />
          <input
            value={item.expect ?? ''}
            onChange={(e) => updateItem(section.id, item.id, { expect: e.target.value })}
            placeholder="Expected result (optional)"
            aria-label="Expected result"
            className={`${FIELD} text-xs`}
          />
          <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={!!item.critical}
              onChange={(e) => updateItem(section.id, item.id, { critical: e.target.checked })}
              className="h-3.5 w-3.5 accent-emerald-600"
            />
            Go/no-go item: a failure stops the flight
          </label>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <div className="flex gap-1">
            <button
              onClick={() => moveItem(section.id, item.id, -1)}
              disabled={index === 0}
              className={btn}
              title="Move up"
            >
              <ArrowUp size={14} />
            </button>
            <button
              onClick={() => moveItem(section.id, item.id, 1)}
              disabled={index === section.items.length - 1}
              className={btn}
              title="Move down"
            >
              <ArrowDown size={14} />
            </button>
          </div>
          <button
            onClick={() => removeItem(section.id, item.id)}
            className={`${btn} w-full hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30`}
            title="Delete item"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------- workspace

export function ChecklistsWorkspace() {
  const template = useActiveTemplate();
  const { run, sections, readOnly } = useShownRun();
  const activePhase = useChecklistsStore((s) => s.activePhase);
  const mode = useChecklistsStore((s) => s.mode);
  const setPhase = useChecklistsStore((s) => s.setPhase);
  const setMode = useChecklistsStore((s) => s.setMode);
  const viewRun = useChecklistsStore((s) => s.viewRun);
  const addSection = useChecklistsStore((s) => s.addSection);
  const addItem = useChecklistsStore((s) => s.addItem);
  const updateSection = useChecklistsStore((s) => s.updateSection);
  const removeSection = useChecklistsStore((s) => s.removeSection);

  const editing = mode === 'edit' && !readOnly;
  const overall = phaseProgress(sections, run.results);
  const phaseSections = sections.filter((s) => s.phase === activePhase);
  const phaseIndex = PHASES.findIndex((p) => p.id === activePhase);
  const thisPhase = phaseProgress(sections, run.results, activePhase);
  const phaseDone = thisPhase.total > 0 && thisPhase.done === thisPhase.total;
  const nextPhase = PHASES[phaseIndex + 1];

  const phaseOptions = PHASES.map((p) => {
    const pr = phaseProgress(sections, run.results, p.id);
    const complete = pr.total > 0 && pr.done === pr.total;
    return {
      id: p.id,
      label: p.label,
      short: p.short,
      title: `${p.label}: ${pr.done} of ${pr.total} done${pr.failed ? `, ${pr.failed} failed` : ''}`,
      trailing: editing ? (
        <span className="font-mono text-[10px] text-ink-muted">{pr.total}</span>
      ) : pr.failed > 0 ? (
        <TriangleAlert size={12} className="text-status-critical" />
      ) : complete ? (
        <Check size={12} className="text-emerald-600 dark:text-emerald-400" />
      ) : (
        <span className="font-mono text-[10px] text-ink-muted">
          {pr.done}/{pr.total}
        </span>
      ),
    };
  });

  return (
    <div className="flex h-full flex-col print:h-auto">
      <HeaderWorkspace
        icon={ClipboardCheck}
        iconClass="text-emerald-600 dark:text-emerald-400"
        title={template.name}
        subtitle={`${template.aircraft || 'No aircraft named'}${
          readOnly && run.savedAt ? ` · saved run of ${new Date(run.savedAt).toLocaleString()}` : ''
        }`}
        fit="wide"
        center={
          <SegmentedTrack
            ariaLabel="Checklist phase"
            options={phaseOptions}
            value={activePhase}
            onChange={(id: PhaseId) => setPhase(id)}
          />
        }
        actions={
          <>
            {readOnly ? (
              <button
                onClick={() => viewRun(null)}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-md border border-edge bg-control px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken"
              >
                <Play size={13} /> Back to the live run
              </button>
            ) : (
              <SegmentedTrack
                ariaLabel="Mode"
                size="sm"
                options={[
                  { id: 'run', label: 'Run', icon: Play },
                  { id: 'edit', label: 'Edit', icon: Pencil },
                ]}
                value={mode}
                onChange={setMode}
              />
            )}
            <button
              onClick={() => window.print()}
              className="rounded-md border border-edge bg-control p-1.5 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
              title="Print this checklist"
              aria-label="Print this checklist"
            >
              <Printer size={15} />
            </button>
          </>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto print:overflow-visible">
        <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 print:max-w-none print:p-0">
          {/* paper header */}
          <div className="hidden print:block">
            <h1 className="text-lg font-semibold">
              {template.name} · {PHASES[phaseIndex].label}
            </h1>
            <p className="text-xs">
              Aircraft: {run.aircraft || template.aircraft} · Pilot: {run.pilot || '________'} · Site:{' '}
              {run.site || '________'} · {new Date(run.startedAt).toLocaleDateString()}
            </p>
          </div>

          {readOnly && (
            <div className="flex items-center gap-2 rounded-lg border border-edge bg-control/60 px-3 py-2 text-xs text-ink-muted print:hidden">
              <Eye size={14} /> You are looking at a saved run. It cannot be changed.
            </div>
          )}

          {/* go / no-go: state is an icon + words, never colour alone */}
          {!editing && overall.criticalFailed > 0 && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border-2 border-status-critical bg-red-50 p-3 dark:bg-red-950/30"
            >
              <TriangleAlert size={20} className="mt-0.5 shrink-0 text-status-critical" />
              <div>
                <p className="text-sm font-semibold text-ink">
                  NO-GO. {overall.criticalFailed} go/no-go item{overall.criticalFailed > 1 ? 's' : ''} failed.
                </p>
                <p className="text-xs text-ink-muted">
                  Do not fly. Fix the cause, then tick the item again. Failed items are marked in every
                  phase above.
                </p>
              </div>
            </div>
          )}

          {phaseSections.length === 0 && (
            <div className="rounded-lg border border-dashed border-edge p-6 text-center text-sm text-ink-muted">
              {editing
                ? 'This phase has no sections yet. Add one below.'
                : 'Nothing to check in this phase. Switch to Edit to add items.'}
            </div>
          )}

          {phaseSections.map((section) => {
            const done = section.items.filter((i) => run.results[i.id]).length;
            return (
              <section key={section.id} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  {editing ? (
                    <input
                      value={section.title}
                      onChange={(e) => updateSection(section.id, e.target.value)}
                      aria-label="Section title"
                      className={`${FIELD} font-semibold`}
                    />
                  ) : (
                    <h2 className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">
                      {section.title}
                    </h2>
                  )}
                  {editing ? (
                    <button
                      onClick={() => removeSection(section.id)}
                      className="flex shrink-0 items-center gap-1.5 rounded-md border border-edge px-2 py-1.5 text-xs text-ink-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                      title="Delete this section and its items"
                    >
                      <Trash2 size={13} /> Section
                    </button>
                  ) : (
                    <span className="shrink-0 font-mono text-[11px] text-ink-muted print:hidden">
                      {done}/{section.items.length}
                    </span>
                  )}
                </div>

                <ul className="space-y-2">
                  {section.items.map((item, i) =>
                    editing ? (
                      <EditItem key={item.id} section={section} item={item} index={i} />
                    ) : (
                      <RunItem key={item.id} item={item} result={run.results[item.id]} readOnly={readOnly} />
                    ),
                  )}
                </ul>

                {editing && (
                  <button
                    onClick={() => addItem(section.id)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-edge p-2 text-xs text-ink-muted transition-colors hover:border-edge-strong/50 hover:text-ink"
                  >
                    <Plus size={13} /> Add item
                  </button>
                )}
              </section>
            );
          })}

          {editing && (
            <button
              onClick={() => addSection(activePhase)}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-edge p-3 text-sm text-ink-muted transition-colors hover:border-edge-strong/50 hover:text-ink"
            >
              <Plus size={14} /> Add a section to {PHASES[phaseIndex].label}
            </button>
          )}

          {!editing && !readOnly && phaseDone && nextPhase && overall.criticalFailed === 0 && (
            <button
              onClick={() => setPhase(nextPhase.id)}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 p-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 print:hidden"
            >
              {PHASES[phaseIndex].label} complete. Go to {nextPhase.label}
              <ChevronRight size={16} />
            </button>
          )}
          {!editing && !readOnly && phaseDone && !nextPhase && (
            <p className="rounded-lg border border-edge bg-control/60 p-3 text-center text-sm text-ink-muted print:hidden">
              Every phase is done. Save the run from the footer to keep it.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
