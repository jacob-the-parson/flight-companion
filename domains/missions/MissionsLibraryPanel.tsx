// MissionsLibraryPanel — the per-domain LEFT-BOTTOM panel: saved missions, and
// in Learn mode the examples. Non-pageable, with its own sticky mini-header
// (the inventory convention).
'use client';
import { FolderOpen, GraduationCap, Trash2 } from 'lucide-react';
import { formatById } from '@/lib/mission/formats';
import { MISSION_SAMPLES } from '@/lib/mission/samples';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useMissionsStore } from '@/stores/domains/missionsStore';
import { ACCENT } from './MissionsParts';

const ROW = 'flex w-full flex-col rounded-md border px-2.5 py-1.5 text-left transition-colors';
const IDLE = 'border-edge bg-surface-raised/60 hover:border-edge-strong/40';

export function MissionsLibraryPanel() {
  const saved = useMissionsStore((s) => s.saved);
  const loadedId = useMissionsStore((s) => s.loadedId);
  const sampleId = useMissionsStore((s) => s.sampleId);
  const load = useMissionsStore((s) => s.load);
  const deleteSaved = useMissionsStore((s) => s.deleteSaved);
  const openSample = useMissionsStore((s) => s.openSample);
  const learn = usePrefsStore((s) => s.learn);

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-edge bg-surface-raised/95 px-3 py-2">
        <FolderOpen size={13} className={ACCENT.text} />
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Saved missions</h3>
        <span className="ml-auto font-mono text-[10px] text-ink-muted">{saved.length}</span>
      </div>
      <div className="space-y-1 p-2">
        {saved.length === 0 && (
          <p className="px-2 py-2 text-xs italic text-ink-muted opacity-60">
            None yet. Open or make a mission and press Save in the footer.
          </p>
        )}
        {saved.map((entry) => {
          const m = entry.mission;
          const waypoints = m.items.filter((i) => i.kind === 'waypoint').length;
          return (
            <div key={entry.id} className="group relative">
              <button onClick={() => load(entry.id)} className={`${ROW} pr-8 ${entry.id === loadedId ? ACCENT.active : IDLE}`}>
                <span className="truncate text-xs font-medium text-ink">{m.name}</span>
                <span className="truncate text-[10px] text-ink-muted">
                  {m.source ? formatById(m.source).label : 'Made here'} · {waypoints} waypoint{waypoints === 1 ? '' : 's'} ·{' '}
                  {new Date(entry.savedAt).toLocaleDateString()}
                </span>
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Delete the saved mission "${m.name}"? Files on disk are not touched.`)) deleteSaved(entry.id);
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
                title="Delete"
                aria-label={`Delete the saved mission ${m.name}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>

      {learn && (
        <>
          <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-y border-edge bg-surface-raised/95 px-3 py-2">
            <GraduationCap size={13} className={ACCENT.text} />
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Examples</h3>
            <span className="ml-auto font-mono text-[10px] text-ink-muted">{MISSION_SAMPLES.length}</span>
          </div>
          <div className="space-y-1 p-2">
            {MISSION_SAMPLES.map((s) => (
              <button key={s.id} onClick={() => openSample(s.id)} className={`${ROW} ${s.id === sampleId ? ACCENT.active : IDLE}`} title={s.shows}>
                <span className="truncate text-xs font-medium text-ink">{s.title}</span>
                <span className="truncate text-[10px] text-ink-muted">Look at: {formatById(s.lookAt).label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
