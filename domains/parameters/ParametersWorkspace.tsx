// ParametersWorkspace — the center surface. Single-surface archetype:
//   HeaderWorkspace [ identity · view switch · open ]
//   → the chosen view. With no set open, the whole surface is the drop target.
// The app reads parameter files and writes them. It never sends a parameter to
// an aircraft: that is done by a person, in the ground station.
'use client';
import { useEffect, useState } from 'react';
import { FileText, FileUp, GitCompareArrows, GraduationCap, List, SlidersHorizontal, TriangleAlert, X } from 'lucide-react';
import { HeaderWorkspace } from '@/components/ui/HeaderWorkspace';
import { SegmentedTrack } from '@/components/ui/SegmentedTrack';
import { PARAM_FORMATS, paramFormatById } from '@/lib/params/codecs';
import { PARAM_SAMPLES, paramSampleById } from '@/lib/params/samples';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useShellStore } from '@/stores/core/shellStore';
import { useParamsStore, type ParamView } from '@/stores/domains/paramsStore';
import { ACCENT, autopilotName, TOOL_BTN, useFilePicker } from './ParametersParts';
import { ParametersCompare, ParametersFile, ParametersList } from './ParametersViews';

const VIEWS: { id: ParamView; label: string; short: string; icon: typeof List; title: string }[] = [
  { id: 'list', label: 'List', short: 'List', icon: List, title: 'Every parameter, in groups' },
  { id: 'compare', label: 'Compare', short: 'Comp', icon: GitCompareArrows, title: 'How this set differs from another' },
  { id: 'file', label: 'File', short: 'File', icon: FileText, title: 'The file itself, as the chosen format writes it' },
];

function Lesson() {
  const sampleId = useParamsStore((s) => s.sampleId);
  const learn = usePrefsStore((s) => s.learn);
  const compact = useShellStore((s) => s.tier === 'compact');
  const [chosen, setOpen] = useState<boolean | null>(null);
  const open = chosen ?? !compact;
  const sample = sampleId ? paramSampleById(sampleId) : undefined;
  if (!learn || !sample) return null;
  return (
    <aside className="shrink-0 border-b border-edge bg-control/50 px-4 py-2 text-xs text-ink print:hidden">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <GraduationCap size={14} className={`shrink-0 ${ACCENT.text}`} />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold">Example.</span> {sample.shows}
        </span>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
          {open ? 'Hide steps' : 'Show steps'}
        </span>
      </button>
      {open && (
        <ol className="mt-2 max-w-3xl list-decimal space-y-1 pb-1 pl-9 leading-snug text-ink-muted">
          {sample.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      )}
    </aside>
  );
}

function Welcome({ open }: { open: () => void }) {
  const learn = usePrefsStore((s) => s.learn);
  const openSample = useParamsStore((s) => s.openSample);
  const referenceState = useParamsStore((s) => s.referenceState);
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-4">
        <button
          onClick={open}
          className={`flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-edge p-8 text-center transition-colors ${ACCENT.drop}`}
        >
          <span className={`rounded-2xl p-4 ${ACCENT.chip}`}>
            <FileUp size={28} />
          </span>
          <span className="text-base font-semibold text-ink">Drop a parameter file here</span>
          <span className="text-sm text-ink-muted">
            or click to choose one. It reads{' '}
            {PARAM_FORMATS.filter((f) => f.loadable)
              .map((f) => `${f.label} (.${f.extensions[0]})`)
              .join(' and ')}
            . Drop two files together to compare them.
          </span>
          <span className="text-xs text-ink-muted">
            The file is read on this computer. Nothing is uploaded, and nothing is sent to an aircraft.
          </span>
        </button>

        <p className="text-center text-xs text-ink-muted">
          In QGroundControl: Vehicle Configuration, Parameters, Tools, Save to file.
        </p>

        {learn && (
          <section className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-ink-muted">
              <GraduationCap size={13} className={ACCENT.text} /> Examples to learn from
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PARAM_SAMPLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openSample(s.id)}
                  disabled={referenceState === 'failed'}
                  className="rounded-lg border border-edge bg-surface-raised p-3 text-left transition-colors hover:border-edge-strong/40 disabled:opacity-50"
                >
                  <span className="block text-sm font-semibold text-ink">{s.title}</span>
                  <span className="block text-xs leading-snug text-ink-muted">{s.shows}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-muted">
              The examples are made by this app from the defaults in PX4’s own parameter reference. None was read from
              an aircraft, and none is a configuration to load. Learn mode is switched off in Settings.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

export function ParametersWorkspace() {
  const set = useParamsStore((s) => s.set);
  const view = useParamsStore((s) => s.view);
  const notice = useParamsStore((s) => s.notice);
  const dirty = useParamsStore((s) => s.dirty);
  const restored = useParamsStore((s) => s.restored);
  const setView = useParamsStore((s) => s.setView);
  const openFiles = useParamsStore((s) => s.openFiles);
  const loadReference = useParamsStore((s) => s.loadReference);
  const restore = useParamsStore((s) => s.restore);
  const dismissNotice = useParamsStore((s) => s.dismissNotice);
  const { input, open } = useFilePicker((files) => void openFiles(files));
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void loadReference();
    void restore();
  }, [loadReference, restore]);

  const subtitle = set
    ? [
        autopilotName(set.autopilot),
        set.version ? `version ${set.version.trim()}` : null,
        set.vehicle,
        `${set.entries.length} parameters`,
        set.source ? `read from: ${paramFormatById(set.source).label}` : 'made in the app',
        dirty ? 'changed, not saved' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Open, compare, edit and write parameter files';

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) void openFiles(files);
      }}
    >
      {input}

      <HeaderWorkspace
        icon={SlidersHorizontal}
        iconClass={ACCENT.text}
        title={set ? set.name : 'Parameters'}
        subtitle={subtitle}
        center={set ? <SegmentedTrack ariaLabel="Parameter view" options={VIEWS} value={view} onChange={setView} /> : undefined}
        actions={
          <button onClick={open} className={TOOL_BTN} title="Open a parameter file">
            <FileUp size={13} /> <span className="hidden @md:inline">Open</span>
          </button>
        }
      />

      {notice && (
        <div role="status" className="flex shrink-0 items-start gap-2 border-b border-edge bg-amber-50/70 px-4 py-2 text-xs text-ink dark:bg-amber-950/30">
          <TriangleAlert size={14} className="mt-0.5 shrink-0 text-status-warning" />
          <span className="min-w-0 flex-1">{notice}</span>
          <button onClick={dismissNotice} className="rounded p-0.5 text-ink-muted hover:text-ink" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {set && <Lesson />}

      <div className={`min-h-0 flex-1 ${set ? '' : 'overflow-y-auto'}`}>
        {!set && restored && <Welcome open={open} />}
        {set && view === 'list' && <ParametersList />}
        {set && view === 'compare' && <ParametersCompare />}
        {set && view === 'file' && <ParametersFile />}
      </div>

      {dragging && (
        <div
          className={`pointer-events-none absolute inset-2 z-[600] flex items-center justify-center rounded-xl border-2 border-dashed text-base font-semibold text-ink ${ACCENT.dropping}`}
        >
          Drop to open. Two files are compared.
        </div>
      )}
    </div>
  );
}
