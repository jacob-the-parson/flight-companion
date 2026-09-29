// Checklists right-drawer pages (zero-prop, store-connected):
//   ChecklistsRunPage      — who, where, notes, progress by phase, go/no-go
//   ChecklistsHistoryPage  — saved runs: open, export, delete
//   ChecklistsTemplatePage — name the template, import/export, restore built-in
'use client';
import { useRef, useState } from 'react';
import {
  Check,
  Download,
  Eye,
  FileUp,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { DrawerField, DrawerSection, DrawerStat } from '@/components/ui/DrawerSection';
import { INPUT_CLASS } from '@/components/shell/ModalProfile';
import { PHASES, phaseProgress, type ChecklistRun } from '@/lib/checklists/types';
import { downloadFile, slug } from '@/lib/units';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useActiveTemplate, useChecklistsStore, useShownRun } from '@/stores/domains/checklistsStore';

const BTN =
  'flex w-full items-center justify-center gap-1.5 rounded-md border border-edge bg-control py-2 text-xs font-medium text-ink transition-colors hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40';

/** A run as plain text, for pasting into a build log. */
export function runAsText(run: ChecklistRun): string {
  const lines: string[] = [];
  lines.push(`Checklist run: ${run.templateName}`);
  lines.push(`Aircraft: ${run.aircraft || 'not named'}`);
  lines.push(`Pilot: ${run.pilot || 'not named'}   Site: ${run.site || 'not named'}`);
  lines.push(`Started: ${new Date(run.startedAt).toLocaleString()}`);
  if (run.savedAt) lines.push(`Saved: ${new Date(run.savedAt).toLocaleString()}`);
  if (run.notes) lines.push(`Notes: ${run.notes}`);
  for (const phase of PHASES) {
    const sections = (run.sections ?? []).filter((s) => s.phase === phase.id);
    if (sections.length === 0) continue;
    lines.push('', `== ${phase.label}`);
    for (const s of sections) {
      lines.push(`-- ${s.title}`);
      for (const item of s.items) {
        const r = run.results[item.id];
        const mark = !r ? '[    ]' : r.state === 'ok' ? '[ OK ]' : r.state === 'fail' ? '[FAIL]' : '[ NA ]';
        const when = r ? ` (${new Date(r.at).toLocaleTimeString()})` : '';
        lines.push(`${mark} ${item.text}${item.critical ? ' {go/no-go}' : ''}${when}`);
        if (r?.note) lines.push(`       note: ${r.note}`);
      }
    }
  }
  return lines.join('\n') + '\n';
}

export function ChecklistsRunPage() {
  const { run, sections, readOnly } = useShownRun();
  const setRunField = useChecklistsStore((s) => s.setRunField);
  const pilotName = usePrefsStore((s) => s.pilotName);
  const overall = phaseProgress(sections, run.results);

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="This run" first>
        <DrawerField label="Pilot">
          <input
            value={run.pilot}
            onChange={(e) => setRunField('pilot', e.target.value)}
            placeholder={pilotName}
            disabled={readOnly}
            className={INPUT_CLASS}
          />
        </DrawerField>
        <DrawerField label="Site">
          <input
            value={run.site}
            onChange={(e) => setRunField('site', e.target.value)}
            placeholder="Field name or address"
            disabled={readOnly}
            className={INPUT_CLASS}
          />
        </DrawerField>
        <DrawerField label="Notes">
          <textarea
            value={run.notes}
            onChange={(e) => setRunField('notes', e.target.value)}
            rows={3}
            placeholder="Wind, pack used, anything odd"
            disabled={readOnly}
            className={INPUT_CLASS}
          />
        </DrawerField>
      </DrawerSection>

      <DrawerSection title="Go / no-go">
        {overall.criticalFailed > 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-status-critical bg-red-50 p-3 text-xs dark:bg-red-950/30">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-status-critical" />
            <span className="text-ink">
              <strong>No-go.</strong> {overall.criticalFailed} go/no-go item
              {overall.criticalFailed > 1 ? 's have' : ' has'} failed.
            </span>
          </div>
        ) : overall.total > 0 && overall.done === overall.total ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-400 bg-emerald-50 p-3 text-xs dark:border-emerald-800 dark:bg-emerald-950/30">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-status-good" />
            <span className="text-ink">
              <strong>Complete.</strong> Every item is marked and no go/no-go item failed.
            </span>
          </div>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-edge bg-control/60 p-3 text-xs text-ink-muted">
            <Check size={16} className="mt-0.5 shrink-0" />
            <span>
              In progress. {overall.total - overall.done} item{overall.total - overall.done === 1 ? '' : 's'}{' '}
              still open.
            </span>
          </div>
        )}
      </DrawerSection>

      <DrawerSection title="Progress by phase">
        <div className="space-y-2">
          {PHASES.map((p) => {
            const pr = phaseProgress(sections, run.results, p.id);
            const pct = pr.total ? (pr.done / pr.total) * 100 : 0;
            return (
              <div key={p.id} className="space-y-1">
                <DrawerStat
                  label={p.label}
                  value={`${pr.done}/${pr.total}${pr.failed ? ` · ${pr.failed} failed` : ''}`}
                />
                {/* meter: fill carries progress, track is a lighter step of the same hue */}
                <div className="h-1.5 overflow-hidden rounded-full bg-emerald-100 dark:bg-emerald-950">
                  <div
                    className={`h-full rounded-full ${pr.failed ? 'bg-status-critical' : 'bg-emerald-600'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </DrawerSection>
    </div>
  );
}

export function ChecklistsHistoryPage() {
  const history = useChecklistsStore((s) => s.history);
  const viewingRunId = useChecklistsStore((s) => s.viewingRunId);
  const viewRun = useChecklistsStore((s) => s.viewRun);
  const deleteRun = useChecklistsStore((s) => s.deleteRun);
  const icon = 'rounded p-1 text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink';

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title={`Saved runs (${history.length})`} first>
        {history.length === 0 ? (
          <p className="text-xs italic text-ink-muted opacity-70">
            No saved runs yet. Save a run from the footer when a flight is finished.
          </p>
        ) : (
          <div className="space-y-2">
            {history.map((r) => {
              const pr = phaseProgress(r.sections ?? [], r.results);
              const active = r.id === viewingRunId;
              return (
                <div
                  key={r.id}
                  className={`rounded-md border p-2 text-xs ${
                    active ? 'border-secondary bg-secondary-high/20' : 'border-edge bg-surface-raised/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{r.templateName}</div>
                      <div className="truncate text-[10px] text-ink-muted">
                        {new Date(r.savedAt ?? r.startedAt).toLocaleString()}
                      </div>
                      <div className="truncate text-[10px] text-ink-muted">
                        {r.pilot || 'no pilot'} · {r.site || 'no site'}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button onClick={() => viewRun(active ? null : r.id)} className={icon} title="Open">
                        <Eye size={13} />
                      </button>
                      <button
                        onClick={() =>
                          downloadFile(
                            `${new Date(r.savedAt ?? r.startedAt).toISOString().slice(0, 10)}-checklist-${slug(r.templateName)}.txt`,
                            runAsText(r),
                          )
                        }
                        className={`${icon} hover:text-green-600`}
                        title="Download as text"
                      >
                        <Download size={13} />
                      </button>
                      <button
                        onClick={() => deleteRun(r.id)}
                        className={`${icon} hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30`}
                        title="Delete"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-muted">
                    <span className="font-mono text-ink">
                      {pr.done}/{pr.total}
                    </span>
                    {pr.criticalFailed > 0 ? (
                      <span className="flex items-center gap-1">
                        <TriangleAlert size={11} className="text-status-critical" /> no-go
                      </span>
                    ) : pr.failed > 0 ? (
                      <span>{pr.failed} failed</span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <Check size={11} className="text-status-good" /> no failures
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DrawerSection>
    </div>
  );
}

export function ChecklistsTemplatePage() {
  const template = useActiveTemplate();
  const updateTemplate = useChecklistsStore((s) => s.updateTemplate);
  const importTemplate = useChecklistsStore((s) => s.importTemplate);
  const restoreBuiltIn = useChecklistsStore((s) => s.restoreBuiltIn);
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const error = importTemplate(await file.text());
    setMessage(error ?? `Imported "${file.name}".`);
    if (fileRef.current) fileRef.current.value = '';
  };

  const total = template.sections.reduce((n, s) => n + s.items.length, 0);
  const critical = template.sections.reduce((n, s) => n + s.items.filter((i) => i.critical).length, 0);

  return (
    <div className="space-y-6 p-4">
      <DrawerSection title="Template" first>
        <DrawerField label="Name">
          <input
            value={template.name}
            onChange={(e) => updateTemplate({ name: e.target.value })}
            className={INPUT_CLASS}
          />
        </DrawerField>
        <DrawerField label="Aircraft">
          <input
            value={template.aircraft}
            onChange={(e) => updateTemplate({ aircraft: e.target.value })}
            className={INPUT_CLASS}
          />
        </DrawerField>
        <DrawerField label="Description">
          <textarea
            value={template.description}
            onChange={(e) => updateTemplate({ description: e.target.value })}
            rows={2}
            className={INPUT_CLASS}
          />
        </DrawerField>
        <DrawerStat label="Items" value={total} />
        <DrawerStat label="Go/no-go items" value={critical} />
      </DrawerSection>

      <DrawerSection title="Share">
        <button
          onClick={() =>
            downloadFile(
              `checklist-${slug(template.name)}.json`,
              JSON.stringify(
                {
                  name: template.name,
                  aircraft: template.aircraft,
                  description: template.description,
                  sections: template.sections.map((s) => ({
                    phase: s.phase,
                    title: s.title,
                    items: s.items.map(({ text, expect, critical: c }) => ({
                      text,
                      ...(expect ? { expect } : null),
                      ...(c ? { critical: true } : null),
                    })),
                  })),
                },
                null,
                2,
              ),
              'application/json',
            )
          }
          className={BTN}
        >
          <Download size={13} className="text-green-600 dark:text-green-500" /> Export template
        </button>
        <button onClick={() => fileRef.current?.click()} className={BTN}>
          <FileUp size={13} /> Import template
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        {message && <p className="text-xs text-ink-muted">{message}</p>}
      </DrawerSection>

      {template.builtIn && (
        <DrawerSection title="Built-in">
          <p className="text-xs text-ink-muted">
            This checklist ships with the app. You can edit it, and put it back the way it shipped.
          </p>
          <button
            onClick={() => {
              if (window.confirm('Put this checklist back to the way it shipped? Your edits to it are lost.')) {
                restoreBuiltIn(template.id);
              }
            }}
            className={BTN}
          >
            <RotateCcw size={13} /> Restore shipped version
          </button>
        </DrawerSection>
      )}
    </div>
  );
}
