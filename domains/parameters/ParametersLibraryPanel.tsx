// ParametersLibraryPanel — the per-domain LEFT-BOTTOM panel: saved sets, and in
// Learn mode the examples. Non-pageable, with its own sticky mini-header.
'use client';
import { FolderOpen, GraduationCap, Trash2 } from 'lucide-react';
import { PARAM_SAMPLES } from '@/lib/params/samples';
import { usePrefsStore } from '@/stores/core/prefsStore';
import { useParamsStore } from '@/stores/domains/paramsStore';
import { ACCENT, autopilotName } from './ParametersParts';

const ROW = 'flex w-full flex-col rounded-md border px-2.5 py-1.5 text-left transition-colors';
const IDLE = 'border-edge bg-surface-raised/60 hover:border-edge-strong/40';

export function ParametersLibraryPanel() {
  const saved = useParamsStore((s) => s.saved);
  const loadedId = useParamsStore((s) => s.loadedId);
  const sampleId = useParamsStore((s) => s.sampleId);
  const hasSet = useParamsStore((s) => s.set !== null);
  const load = useParamsStore((s) => s.load);
  const deleteSaved = useParamsStore((s) => s.deleteSaved);
  const openSample = useParamsStore((s) => s.openSample);
  const learn = usePrefsStore((s) => s.learn);

  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-b border-edge bg-surface-raised/95 px-3 py-2">
        <FolderOpen size={13} className={ACCENT.text} />
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Saved sets</h3>
        <span className="ml-auto font-mono text-[10px] text-ink-muted">{saved.length}</span>
      </div>
      <div className="space-y-1 p-2">
        {saved.length === 0 && (
          <p className="px-2 py-2 text-xs italic text-ink-muted opacity-60">
            None yet. Open a parameter file and press Save in the footer.
          </p>
        )}
        {saved.map((m) => (
          <div key={m.id} className="group relative">
            <button onClick={() => void load(m.id)} className={`${ROW} pr-8 ${m.id === loadedId && hasSet ? ACCENT.active : IDLE}`}>
              <span className="truncate text-xs font-medium text-ink">{m.name}</span>
              <span className="truncate text-[10px] text-ink-muted">
                {autopilotName(m.autopilot)}
                {m.version ? ` ${m.version.trim()}` : ''} · {m.count} · {new Date(m.savedAt).toLocaleDateString()}
              </span>
            </button>
            <button
              onClick={() => {
                if (window.confirm(`Delete the saved set "${m.name}"? Files on disk are not touched.`)) deleteSaved(m.id);
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-muted transition-colors hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"
              title="Delete"
              aria-label={`Delete the saved set ${m.name}`}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>

      {learn && (
        <>
          <div className="sticky top-0 z-10 flex shrink-0 items-center gap-2 border-y border-edge bg-surface-raised/95 px-3 py-2">
            <GraduationCap size={13} className={ACCENT.text} />
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Examples</h3>
            <span className="ml-auto font-mono text-[10px] text-ink-muted">{PARAM_SAMPLES.length}</span>
          </div>
          <div className="space-y-1 p-2">
            {PARAM_SAMPLES.map((s) => (
              <button key={s.id} onClick={() => openSample(s.id)} className={`${ROW} ${s.id === sampleId && hasSet ? ACCENT.active : IDLE}`} title={s.shows}>
                <span className="truncate text-xs font-medium text-ink">{s.title}</span>
                <span className="truncate text-[10px] text-ink-muted">{s.compareWith ? 'A comparison' : 'A set to read'}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
