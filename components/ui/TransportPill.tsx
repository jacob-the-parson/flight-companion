// TransportPill — the media-transport primitive (animator viewer heritage):
// rounded-full 5-button cluster with a round accent PLAY center.
// Serves sprite-anim previews now, 3D turntables later. Spec: TransportPill.md
'use client';
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react';

interface TransportPillProps {
  playing?: boolean;
  disabled?: boolean;
  /** Tailwind bg class for the play button (domain accent). */
  accentClass?: string;
  onPrevSequence?: () => void;
  onPrevFrame?: () => void;
  onTogglePlay?: () => void;
  onNextFrame?: () => void;
  onNextSequence?: () => void;
}

export function TransportPill({
  playing = false,
  disabled = false,
  accentClass = 'bg-amber-500',
  onPrevSequence,
  onPrevFrame,
  onTogglePlay,
  onNextFrame,
  onNextSequence,
}: TransportPillProps) {
  const side = `flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
    disabled ? 'cursor-not-allowed text-ink-muted opacity-45' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
  }`;
  return (
    <div className="flex items-center justify-center gap-1.5 rounded-full border border-edge bg-surface-raised p-1.5 shadow-sm">
      <button type="button" disabled={disabled} onClick={onPrevSequence} title="Previous sequence" className={side}>
        <SkipBack size={14} />
      </button>
      <button type="button" disabled={disabled} onClick={onPrevFrame} title="Previous frame" className={side}>
        <ChevronLeft size={14} />
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onTogglePlay}
        title={playing ? 'Pause' : 'Play'}
        className={`flex h-10 w-10 items-center justify-center rounded-full text-white shadow-sm transition-transform ${accentClass} ${
          disabled ? 'cursor-not-allowed opacity-45' : 'hover:scale-105'
        }`}
      >
        {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
      </button>
      <button type="button" disabled={disabled} onClick={onNextFrame} title="Next frame" className={side}>
        <ChevronRight size={14} />
      </button>
      <button type="button" disabled={disabled} onClick={onNextSequence} title="Next sequence" className={side}>
        <SkipForward size={14} />
      </button>
    </div>
  );
}
