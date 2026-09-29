// MissionsWorkspace — the center surface. Single-surface archetype:
//   HeaderWorkspace [ identity · view switch · open, new, map tools ]
//   → the chosen view. With no mission open, the whole surface is the drop target.
// Files never leave this computer, and nothing here talks to an aircraft: the
// app reads mission files and writes them.
'use client';
import { useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  FilePlus2,
  FileText,
  FileUp,
  GraduationCap,
  ListOrdered,
  Map as MapIcon,
  Maximize2,
  TriangleAlert,
  Undo2,
  Waypoints,
  X,
} from 'lucide-react';
import { HeaderWorkspace } from '@/components/ui/HeaderWorkspace';
import { SegmentedTrack } from '@/components/ui/SegmentedTrack';
import { formatById, FORMATS } from '@/lib/mission/formats';
import { MISSION_SAMPLES, sampleById } from '@/lib/mission/samples';
import { useHandoffStore } from '@/stores/core/handoffStore';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useShellStore } from '@/stores/core/shellStore';
import { useMissionsStore, type MissionView } from '@/stores/domains/missionsStore';
import { ACCENT, TOOL_BTN, useOpenMissionFiles } from './MissionsParts';
import { MissionsConvert, MissionsFile, MissionsItems, MissionsMap } from './MissionsViews';

const VIEWS: { id: MissionView; label: string; short: string; icon: typeof MapIcon; title: string }[] = [
  { id: 'map', label: 'Map', short: 'Map', icon: MapIcon, title: 'The route on the map' },
  { id: 'items', label: 'Items', short: 'Items', icon: ListOrdered, title: 'Every item, in the order flown' },
  { id: 'file', label: 'File', short: 'File', icon: FileText, title: 'The file itself, as the chosen format writes it' },
  { id: 'convert', label: 'Convert', short: 'Conv', icon: ArrowLeftRight, title: 'What each format keeps and drops' },
];

/** The example that is open, and what to do with it. Learn mode only. */
function Lesson() {
  const sampleId = useMissionsStore((s) => s.sampleId);
  const learn = usePrefsStore((s) => s.learn);
  // on a phone the steps start folded, so the map is what is seen first
  const compact = useShellStore((s) => s.tier === 'compact');
  const [chosen, setOpen] = useState<boolean | null>(null);
  const open = chosen ?? !compact;
  const sample = sampleId ? sampleById(sampleId) : undefined;
  if (!learn || !sample) return null;
  return (
    <aside className="shrink-0 border-b border-edge bg-control/50 px-4 py-2 text-xs text-ink print:hidden">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
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
  const newMission = useMissionsStore((s) => s.newMission);
  const openSample = useMissionsStore((s) => s.openSample);
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
          <span className="text-base font-semibold text-ink">Drop a mission file here</span>
          <span className="text-sm text-ink-muted">
            or click to choose one. It reads{' '}
            {FORMATS.filter((f) => f.id !== 'fc-mission' && f.id !== 'csv')
              .map((f) => `${f.label} (.${f.extensions[0]})`)
              .join(', ')}
            , tables and its own mission document.
          </span>
          <span className="text-xs text-ink-muted">
            The file is read on this computer. Nothing is uploaded, and nothing is sent to an aircraft.
          </span>
        </button>

        <div className="flex justify-center">
          <button onClick={newMission} className={TOOL_BTN}>
            <FilePlus2 size={13} /> Start a new mission on the map
          </button>
        </div>

        {learn && (
          <section className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-ink-muted">
              <GraduationCap size={13} className={ACCENT.text} /> Examples to learn from
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {MISSION_SAMPLES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => openSample(s.id)}
                  className="rounded-lg border border-edge bg-surface-raised p-3 text-left transition-colors hover:border-edge-strong/40"
                >
                  <span className="block text-sm font-semibold text-ink">{s.title}</span>
                  <span className="block text-xs leading-snug text-ink-muted">{s.shows}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-ink-muted">
              The examples are made by this app, around the default home of PX4&apos;s simulator near Zurich.
              None is a recording of a real flight. Learn mode is switched off in Settings.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

export function MissionsWorkspace() {
  const mission = useMissionsStore((s) => s.mission);
  const view = useMissionsStore((s) => s.view);
  const notice = useMissionsStore((s) => s.notice);
  const dirty = useMissionsStore((s) => s.dirty);
  const canUndo = useMissionsStore((s) => s.past.length > 0);
  const setView = useMissionsStore((s) => s.setView);
  const undo = useMissionsStore((s) => s.undo);
  const requestFit = useMissionsStore((s) => s.requestFit);
  const openFiles = useMissionsStore((s) => s.openFiles);
  const openBytes = useMissionsStore((s) => s.openBytes);
  const newMission = useMissionsStore((s) => s.newMission);
  const dismissNotice = useMissionsStore((s) => s.dismissNotice);
  const take = useHandoffStore((s) => s.take);
  const { input, open } = useOpenMissionFiles();
  const [dragging, setDragging] = useState(false);

  // a file another domain left for this one is opened like any other file
  useEffect(() => {
    const file = take('missions');
    if (file) openBytes(new TextEncoder().encode(file.text), file.fileName, file.from);
  }, [take, openBytes]);

  const from = mission?.source ? formatById(mission.source).label : null;
  const subtitle = mission
    ? [
        from ? `Read from a ${from.toLowerCase()}` : 'Made in the app',
        mission.vehicle,
        mission.firmware === 'px4' ? 'PX4' : mission.firmware === 'ardupilot' ? 'ArduPilot' : null,
        dirty ? 'changed, not saved' : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Open, edit, make and convert mission files';

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
        icon={Waypoints}
        iconClass={ACCENT.text}
        title={mission ? mission.name : 'Missions'}
        subtitle={subtitle}
        fit="wide"
        center={mission ? <SegmentedTrack ariaLabel="Mission view" options={VIEWS} value={view} onChange={setView} /> : undefined}
        actions={
          <>
            {mission && (
              <>
                <button onClick={undo} disabled={!canUndo} className={TOOL_BTN} title="Undo the last change" aria-label="Undo">
                  <Undo2 size={13} />
                </button>
                {view === 'map' && (
                  <button onClick={requestFit} className={TOOL_BTN} title="Frame the mission" aria-label="Frame the mission">
                    <Maximize2 size={13} />
                  </button>
                )}
                <button onClick={newMission} className={TOOL_BTN} title="Start a new mission" aria-label="New mission">
                  <FilePlus2 size={13} />
                </button>
              </>
            )}
            <button onClick={open} className={TOOL_BTN} title="Open a mission file">
              <FileUp size={13} /> <span className="hidden @md:inline">Open</span>
            </button>
          </>
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

      {mission && <Lesson />}

      {mission && mission.notes.length > 0 && view !== 'map' && (
        <details className="shrink-0 border-b border-edge px-4 py-2 text-xs text-ink-muted">
          <summary className="cursor-pointer select-none font-medium text-ink">
            {mission.notes.length} note{mission.notes.length > 1 ? 's' : ''} from reading the file
          </summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 leading-snug">
            {mission.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </details>
      )}

      <div className={`min-h-0 flex-1 ${mission ? '' : 'overflow-y-auto'}`}>
        {!mission && <Welcome open={open} />}
        {mission && view === 'map' && <MissionsMap />}
        {mission && view === 'items' && <MissionsItems />}
        {mission && view === 'file' && <MissionsFile />}
        {mission && view === 'convert' && <MissionsConvert />}
      </div>

      {dragging && (
        <div
          className={`pointer-events-none absolute inset-2 z-[600] flex items-center justify-center rounded-xl border-2 border-dashed text-base font-semibold text-ink ${ACCENT.dropping}`}
        >
          Drop to open
        </div>
      )}
    </div>
  );
}
